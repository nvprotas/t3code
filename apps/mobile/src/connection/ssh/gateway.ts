import type {
  bootstrapRemoteBearerSession,
  fetchRemoteSessionState,
  RemoteEnvironmentAuthError,
} from "@t3tools/client-runtime/authorization";
import {
  ConnectionBlockedError,
  ConnectionTransientError,
  environmentMismatchError,
  mapRemoteEnvironmentError,
  sshTargetKey,
  type ConnectionAttemptError,
} from "@t3tools/client-runtime/connection";
import type { ClientCapabilities } from "@t3tools/client-runtime/platform";
import type {
  DesktopSshEnvironmentTarget,
  EnvironmentId,
  ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { extractJsonObject, fromLenientJson } from "@t3tools/shared/schemaJson";
import { buildMobilePairingScript, REMOTE_RUNTIME_DISCOVERY_SCRIPT } from "@t3tools/ssh/scripts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import type { readSshCredentials, updateSshCredentials, SshTargetCredentials } from "./credentials";
import { sshNativeErrorCode, type T3SshNativeModule } from "./native";
import type { requestHostKeyConfirmation, requestPassphrase } from "./prompts";

export type MobileSshTransport = Pick<
  T3SshNativeModule,
  "connect" | "confirmHostKey" | "cancel" | "exec" | "forward" | "isOpen" | "close" | "addListener"
>;

export interface MobileSshGatewayDeps {
  readonly transport: MobileSshTransport;
  readonly readSshCredentials: typeof readSshCredentials;
  readonly updateSshCredentials: typeof updateSshCredentials;
  readonly requestHostKeyConfirmation: typeof requestHostKeyConfirmation;
  readonly requestPassphrase: typeof requestPassphrase;
  readonly fetchRemoteEnvironmentDescriptor: (input: {
    readonly httpBaseUrl: string;
  }) => Effect.Effect<
    Pick<ExecutionEnvironmentDescriptor, "environmentId" | "label" | "serverVersion">,
    RemoteEnvironmentAuthError
  >;
  readonly fetchRemoteSessionState: (
    input: Parameters<typeof fetchRemoteSessionState>[0],
  ) => Effect.Effect<{ readonly authenticated: boolean }, RemoteEnvironmentAuthError>;
  readonly bootstrapRemoteBearerSession: (
    input: Parameters<typeof bootstrapRemoteBearerSession>[0],
  ) => Effect.Effect<{ readonly access_token: string }, RemoteEnvironmentAuthError>;
}

interface Tunnel {
  readonly sessionId: string;
  readonly localPort: number;
  readonly remotePort: number;
  readonly removeClosedListener: () => void;
}

const RuntimeDiscovery = Schema.Struct({
  runtime: Schema.NullOr(
    Schema.Struct({
      pid: Schema.Int.check(Schema.isGreaterThan(0)),
      port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
      origin: Schema.String,
    }),
  ),
  alive: Schema.Boolean,
});
const decodeDiscovery = Schema.decodeEffect(fromLenientJson(RuntimeDiscovery));
const decodePairing = Schema.decodeEffect(
  fromLenientJson(Schema.Struct({ credential: Schema.String.check(Schema.isMinLength(1)) })),
);

function pairingStateKey(target: DesktopSshEnvironmentTarget): string {
  let hash = 0x811c9dc5;
  for (const char of sshTargetKey(target)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  return `mobile-${hash.toString(16)}`;
}

function credentialRejected(error: RemoteEnvironmentAuthError): boolean {
  return (
    error._tag === "EnvironmentAuthInvalidError" ||
    error._tag === "EnvironmentScopeRequiredError" ||
    error._tag === "EnvironmentOperationForbiddenError" ||
    (error._tag === "RemoteEnvironmentAuthUndeclaredStatusError" &&
      (error.status === 401 || error.status === 403))
  );
}

let attemptSequence = 0;

export function makeMobileSshGateway(
  deps: MobileSshGatewayDeps,
): ClientCapabilities.SshEnvironmentGateway["Service"] {
  const native = deps.transport;
  const tunnels = new Map<string, Tunnel>();
  const passphrases = new Map<string, string>();
  const secrets = new Set<string>();
  const lock = Effect.runSync(KeyedLock.make<string>());

  const rememberSecret = (secret: string | null) => {
    if (secret) secrets.add(secret);
  };
  const redact = (detail: string) => {
    for (const secret of secrets) detail = detail.replaceAll(secret, "[redacted]");
    return detail;
  };
  const nativeError = (cause: unknown): ConnectionAttemptError => {
    const code = sshNativeErrorCode(cause);
    const message =
      typeof cause === "object" &&
      cause !== null &&
      "message" in cause &&
      typeof cause.message === "string"
        ? redact(cause.message)
        : "SSH operation failed.";
    switch (code) {
      case "SSH_HOST_KEY_CHANGED":
        return new ConnectionBlockedError({
          reason: "authentication",
          detail: `The SSH host key has changed. Verify the new key independently, then remove and add this connection again. ${message}`,
        });
      case "SSH_AUTH_FAILED":
      case "SSH_KEY_INVALID":
      case "SSH_HOST_KEY_REJECTED":
      case "SSH_PASSPHRASE_REQUIRED":
      case "SSH_CANCELLED":
        return new ConnectionBlockedError({ reason: "authentication", detail: message });
      case "SSH_TIMEOUT":
        return new ConnectionTransientError({ reason: "timeout", detail: message });
      case "SSH_EXEC_FAILED":
        return new ConnectionTransientError({ reason: "remote-unavailable", detail: message });
      default:
        return new ConnectionTransientError({ reason: "network", detail: message });
    }
  };
  const call = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({ try: operation, catch: nativeError });
  const isOpen = (sessionId: string) =>
    Effect.try({ try: () => native.isOpen(sessionId), catch: nativeError });
  const remoteError = (error: RemoteEnvironmentAuthError) => {
    const mapped = mapRemoteEnvironmentError(error, "ssh");
    return mapped._tag === "ConnectionBlockedError"
      ? new ConnectionBlockedError({ ...mapped, detail: redact(mapped.detail) })
      : new ConnectionTransientError({ ...mapped, detail: redact(mapped.detail) });
  };
  const close = (sessionId: string) => call(() => native.close(sessionId));

  const connect = (target: DesktopSshEnvironmentTarget, credentials: SshTargetCredentials) =>
    Effect.gen(function* () {
      const destination = `${target.username ?? ""}@${target.hostname}:${target.port ?? 22}`;
      let passphrase = passphrases.get(credentials.keyRef) ?? null;
      let retry = passphrase !== null;
      while (true) {
        attemptSequence += 1;
        const attemptId = `mobile-ssh-${Date.now()}-${attemptSequence}`;
        const connected = yield* Effect.tryPromise({
          try: async (signal) => {
            let active = true;
            let prompting = false;
            const cancel = () => {
              void native.cancel(attemptId).catch(() => undefined);
            };
            const subscription = native.addListener("onHostKey", (event) => {
              if (event.attemptId !== attemptId || !active || prompting) return;
              prompting = true;
              void deps
                .requestHostKeyConfirmation({ destination, fingerprint: event.fingerprint })
                .then((accept) => {
                  if (active) return native.confirmHostKey(attemptId, accept);
                })
                .catch(cancel);
            });
            signal.addEventListener("abort", cancel, { once: true });
            try {
              const session = await native.connect({
                attemptId,
                hostname: target.hostname,
                port: target.port ?? 22,
                username: target.username ?? "",
                keyRef: credentials.keyRef,
                passphrase,
                hostKey: credentials.hostKey,
              });
              if (signal.aborted) {
                await native.close(session.sessionId);
                throw new ConnectionBlockedError({
                  reason: "authentication",
                  detail: "SSH connection cancelled.",
                });
              }
              return session;
            } finally {
              active = false;
              signal.removeEventListener("abort", cancel);
              subscription.remove();
            }
          },
          catch: (cause) => cause,
        }).pipe(
          Effect.matchEffect({
            onSuccess: (session) => Effect.succeed(session),
            onFailure: (cause) =>
              sshNativeErrorCode(cause) === "SSH_PASSPHRASE_REQUIRED"
                ? Effect.succeed(null)
                : Effect.fail(nativeError(cause)),
          }),
        );
        if (connected !== null) {
          if (passphrase !== null) passphrases.set(credentials.keyRef, passphrase);
          return connected;
        }
        passphrases.delete(credentials.keyRef);
        passphrase = yield* call(() => deps.requestPassphrase({ destination, retry }));
        if (passphrase === null) {
          return yield* new ConnectionBlockedError({
            reason: "authentication",
            detail: "SSH passphrase entry was cancelled.",
          });
        }
        rememberSecret(passphrase);
        retry = true;
      }
    });

  const open = (target: DesktopSshEnvironmentTarget, credentials: SshTargetCredentials) =>
    Effect.gen(function* () {
      const key = sshTargetKey(target);
      const session = yield* connect(target, credentials);
      const subscription = native.addListener("onClosed", (event) => {
        if (event.sessionId !== session.sessionId) return;
        if (tunnels.get(key)?.sessionId === session.sessionId) tunnels.delete(key);
        subscription.remove();
      });
      return yield* Effect.gen(function* () {
        if (credentials.hostKey === null) {
          yield* call(() => deps.updateSshCredentials(target, { hostKey: session.hostKey }));
        }
        const discovery = yield* call(() =>
          native.exec(session.sessionId, "sh -s", REMOTE_RUNTIME_DISCOVERY_SCRIPT, 15_000),
        );
        if (discovery.exitCode !== 0) {
          return yield* new ConnectionTransientError({
            reason: "remote-unavailable",
            detail: "Could not discover the remote T3 Code server.",
          });
        }
        const { runtime, alive } = yield* decodeDiscovery(extractJsonObject(discovery.stdout)).pipe(
          Effect.mapError(() =>
            new ConnectionTransientError({
              reason: "remote-unavailable",
              detail: "The remote T3 Code runtime state is invalid.",
            }),
          ),
        );
        if (runtime === null || !alive) {
          return yield* new ConnectionTransientError({
            reason: "remote-unavailable",
            detail: `T3 Code is not running on ${target.hostname}. Start it there (for example \`npx t3\`) and retry.`,
          });
        }
        const remoteHost = yield* Effect.try({
          try: () => {
            const hostname = runtime.origin === "" ? "" : new URL(runtime.origin).hostname;
            return ["", "0.0.0.0", "::", "[::]"].includes(hostname)
              ? "127.0.0.1"
              : hostname.replace(/^\[|\]$/gu, "");
          },
          catch: () =>
            new ConnectionTransientError({
              reason: "remote-unavailable",
              detail: "The remote T3 Code origin is invalid.",
            }),
        });
        const { localPort } = yield* call(() =>
          native.forward(session.sessionId, remoteHost, runtime.port),
        );
        if (!(yield* isOpen(session.sessionId))) {
          return yield* new ConnectionTransientError({
            reason: "network",
            detail: "The SSH session closed.",
          });
        }
        const tunnel: Tunnel = {
          sessionId: session.sessionId,
          localPort,
          remotePort: runtime.port,
          removeClosedListener: () => subscription.remove(),
        };
        tunnels.set(key, tunnel);
        return tunnel;
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? close(session.sessionId).pipe(
                Effect.ignore,
                Effect.ensuring(Effect.sync(() => subscription.remove())),
              )
            : Effect.void,
        ),
      );
    });

  const provision = (target: DesktopSshEnvironmentTarget, expectedEnvironmentId?: EnvironmentId) =>
    lock.withLock(
      sshTargetKey(target),
      Effect.gen(function* () {
        const credentials = yield* call(() => deps.readSshCredentials(target));
        if (credentials === null) {
          return yield* new ConnectionBlockedError({
            reason: "configuration",
            detail: "No SSH key is saved for this connection. Remove it and add it again.",
          });
        }
        rememberSecret(credentials.bearerToken);
        let cachedTunnel = tunnels.get(sshTargetKey(target));
        if (cachedTunnel !== undefined && !(yield* isOpen(cachedTunnel.sessionId))) {
          tunnels.delete(sshTargetKey(target));
          cachedTunnel.removeClosedListener();
          yield* close(cachedTunnel.sessionId).pipe(Effect.ignore);
          cachedTunnel = undefined;
        }
        const tunnel = cachedTunnel ?? (yield* open(target, credentials));
        const httpBaseUrl = `http://127.0.0.1:${tunnel.localPort}`;
        const wsBaseUrl = `ws://127.0.0.1:${tunnel.localPort}`;
        const descriptor = yield* deps.fetchRemoteEnvironmentDescriptor({ httpBaseUrl }).pipe(
          Effect.mapError(remoteError),
        );
        if (expectedEnvironmentId !== undefined && descriptor.environmentId !== expectedEnvironmentId) {
          return yield* environmentMismatchError({
            expected: expectedEnvironmentId,
            actual: descriptor.environmentId,
          });
        }
        let bearerToken = credentials.bearerToken;
        if (bearerToken !== null) {
          const valid = yield* deps.fetchRemoteSessionState({ httpBaseUrl, bearerToken }).pipe(
            Effect.map((session) => session.authenticated),
            Effect.catch((error) =>
              credentialRejected(error) ? Effect.succeed(false) : Effect.fail(remoteError(error)),
            ),
          );
          if (!valid) {
            bearerToken = null;
            yield* call(() => deps.updateSshCredentials(target, { bearerToken: null }));
          }
        }
        if (bearerToken === null) {
          const result = yield* call(() =>
            native.exec(
              tunnel.sessionId,
              "sh -s",
              buildMobilePairingScript({
                stateKey: pairingStateKey(target),
                archiveVersion: descriptor.serverVersion,
              }),
              900_000,
            ),
          );
          if (result.exitCode !== 0) {
            return yield* new ConnectionTransientError({
              reason: "remote-unavailable",
              detail: "The remote T3 Code server could not issue a pairing credential.",
            });
          }
          const { credential } = yield* decodePairing(extractJsonObject(result.stdout)).pipe(
            Effect.mapError(() =>
              new ConnectionTransientError({
                reason: "remote-unavailable",
                detail: "The remote T3 Code pairing response is invalid.",
              }),
            ),
          );
          rememberSecret(credential);
          const access = yield* deps.bootstrapRemoteBearerSession({ httpBaseUrl, credential }).pipe(
            Effect.mapError(remoteError),
          );
          bearerToken = access.access_token;
          rememberSecret(bearerToken);
          yield* call(() => deps.updateSshCredentials(target, { bearerToken }));
        }
        return {
          environmentId: descriptor.environmentId,
          label: descriptor.label,
          bootstrap: {
            target,
            httpBaseUrl,
            wsBaseUrl,
            pairingToken: null,
            remotePort: tunnel.remotePort,
            remoteServerKind: "external" as const,
          },
          bearerToken,
        };
      }),
    );

  return {
    provision,
    prepare: ({ target, expectedEnvironmentId }) => provision(target, expectedEnvironmentId),
    disconnect: (target) =>
      lock.withLock(
        sshTargetKey(target),
        Effect.gen(function* () {
          const key = sshTargetKey(target);
          const tunnel = tunnels.get(key);
          if (tunnel === undefined) return;
          tunnels.delete(key);
          tunnel.removeClosedListener();
          yield* close(tunnel.sessionId);
        }),
      ),
  };
}
