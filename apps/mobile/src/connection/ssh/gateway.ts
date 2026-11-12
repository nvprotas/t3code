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
import * as Clock from "effect/Clock";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import type { readSshCredentials, updateSshCredentials, SshTargetCredentials } from "./credentials";
import { sshNativeErrorCode, type T3SshNativeModule } from "./native";
import { startSshDiagnostics, type SshStage } from "./diagnostics";
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
  readonly sessionIds: ReadonlyArray<string>;
  readonly close: Effect.Effect<void>;
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

  const connect = Effect.fn("mobile/ssh.connect")(function* (
    target: DesktopSshEnvironmentTarget,
    credentials: Pick<SshTargetCredentials, "keyRef" | "hostKey">,
    trace: ReturnType<typeof startSshDiagnostics>,
    stage: "bastion SSH" | "target SSH",
    routeSignal: AbortSignal,
    localPort?: number,
  ) {
    const destination = `${target.username ?? ""}@${target.hostname}:${target.port ?? 22}`;
    let passphrase = passphrases.get(credentials.keyRef) ?? null;
    let retry = passphrase !== null;
    while (true) {
      attemptSequence += 1;
      const attemptId = `mobile-ssh-${yield* Clock.currentTimeMillis}-${attemptSequence}`;
      const connected = yield* Effect.tryPromise({
        try: async (signal) => {
          let active = true;
          let prompting = false;
          const promptController = new AbortController();
          const cancel = () => {
            if (!active) return;
            active = false;
            signal.removeEventListener("abort", cancel);
            routeSignal.removeEventListener("abort", cancel);
            subscription.remove();
            promptController.abort();
            void native.cancel(attemptId).catch(() => undefined);
          };
          const subscription = native.addListener("onHostKey", (event) => {
            if (event.attemptId !== attemptId || !active || prompting) return;
            prompting = true;
            void deps
              .requestHostKeyConfirmation({
                destination,
                fingerprint: event.fingerprint,
                signal: promptController.signal,
              })
              .then((accept) => {
                if (active) return native.confirmHostKey(attemptId, accept);
              })
              .catch(cancel);
          });
          signal.addEventListener("abort", cancel, { once: true });
          routeSignal.addEventListener("abort", cancel, { once: true });
          try {
            if (signal.aborted || routeSignal.aborted) throw { code: "SSH_CANCELLED" };
            const session = await native.connect({
              attemptId,
              hostname: localPort === undefined ? target.hostname : "127.0.0.1",
              port: localPort ?? target.port ?? 22,
              username: target.username ?? "",
              keyRef: credentials.keyRef,
              passphrase,
              hostKey: credentials.hostKey,
            });
            if (signal.aborted || routeSignal.aborted) {
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
            routeSignal.removeEventListener("abort", cancel);
            promptController.abort();
            subscription.remove();
          }
        },
        catch: (cause) => {
          const code = sshNativeErrorCode(cause);
          trace(stage, "failed", code);
          return { code, error: nativeError(cause) };
        },
      }).pipe(
        Effect.matchEffect({
          onSuccess: (session) => Effect.succeed(session),
          onFailure: (cause) =>
            cause.code === "SSH_PASSPHRASE_REQUIRED"
              ? Effect.succeed(null)
              : Effect.fail(cause.error),
        }),
      );
      if (connected !== null) {
        if (passphrase !== null) passphrases.set(credentials.keyRef, passphrase);
        return connected;
      }
      passphrases.delete(credentials.keyRef);
      passphrase = yield* Effect.tryPromise({
        try: (signal) => {
          const controller = new AbortController();
          const cancel = () => controller.abort();
          signal.addEventListener("abort", cancel, { once: true });
          routeSignal.addEventListener("abort", cancel, { once: true });
          if (signal.aborted || routeSignal.aborted) cancel();
          return deps
            .requestPassphrase({ destination, retry, signal: controller.signal })
            .finally(() => {
              signal.removeEventListener("abort", cancel);
              routeSignal.removeEventListener("abort", cancel);
            });
        },
        catch: nativeError,
      });
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

  const atStage = Effect.fn("mobile/ssh.stage")(function* <A, R>(
    trace: ReturnType<typeof startSshDiagnostics>,
    stage: SshStage,
    operation: Effect.Effect<A, ConnectionAttemptError, R>,
  ) {
    trace(stage, "started");
    const value = yield* operation.pipe(
      Effect.mapError((error) => {
        trace(stage, "failed", error.reason);
        const detail = `${stage}: ${error.detail}`;
        return error._tag === "ConnectionBlockedError"
          ? new ConnectionBlockedError({ ...error, detail })
          : new ConnectionTransientError({ ...error, detail });
      }),
    );
    trace(stage, "ok");
    return value;
  });

  const open = Effect.fn("mobile/ssh.open")(function* (
    target: DesktopSshEnvironmentTarget,
    credentials: SshTargetCredentials,
    trace: ReturnType<typeof startSshDiagnostics>,
  ) {
    const key = sshTargetKey(target);
    const scope = yield* Scope.make();
    const routeSignal = yield* Effect.abortSignal.pipe(Scope.provide(scope));
    const runFork = Effect.runForkWith(yield* Effect.context<never>());
    const sessionIds: string[] = [];
    const subscription = native.addListener("onClosed", (event) => {
      if (!sessionIds.includes(event.sessionId)) return;
      trace(
        event.sessionId === sessionIds[0] && target.bastion ? "bastion SSH" : "target SSH",
        "closed",
        event.code,
      );
      if (tunnels.get(key)?.sessionIds === sessionIds) tunnels.delete(key);
      runFork(closeRoute);
    });
    const closeRoute = Effect.sync(() => {
      subscription.remove();
    }).pipe(Effect.andThen(Scope.close(scope, Exit.void)));
    const acquire = (
      endpoint: DesktopSshEnvironmentTarget,
      secret: Pick<SshTargetCredentials, "keyRef" | "hostKey">,
      stage: "bastion SSH" | "target SSH",
      localPort?: number,
    ) =>
      Effect.acquireRelease(
        Effect.interruptible(
          atStage(trace, stage, connect(endpoint, secret, trace, stage, routeSignal, localPort)),
        ),
        (session) => close(session.sessionId).pipe(Effect.ignore),
      ).pipe(
        Scope.provide(scope),
        Effect.tap((session) => Effect.sync(() => sessionIds.push(session.sessionId))),
      );
    return yield* Effect.gen(function* () {
      let bridgePort: number | undefined;
      if (target.bastion !== undefined) {
        if (credentials.bastion === undefined) {
          return yield* new ConnectionBlockedError({
            reason: "configuration",
            detail: "No SSH key is saved for the bastion.",
          });
        }
        const bastion = yield* acquire(target.bastion, credentials.bastion, "bastion SSH");
        if (credentials.bastion.hostKey === null) {
          yield* call(() =>
            deps.updateSshCredentials(target, {
              bastion: { ...credentials.bastion!, hostKey: bastion.hostKey },
            }),
          );
        }
        const forward = yield* atStage(
          trace,
          "bastion forwarding",
          call(() => native.forward(bastion.sessionId, target.hostname, target.port ?? 22)),
        );
        bridgePort = forward.localPort;
      }
      const session = yield* acquire(target, credentials, "target SSH", bridgePort);
      if (credentials.hostKey === null) {
        yield* call(() => deps.updateSshCredentials(target, { hostKey: session.hostKey }));
      }
      const { runtime } = yield* atStage(
        trace,
        "discovery",
        Effect.gen(function* () {
          const discovery = yield* call(() =>
            native.exec(session.sessionId, "sh -s", REMOTE_RUNTIME_DISCOVERY_SCRIPT, 15_000),
          );
          if (discovery.exitCode !== 0) {
            return yield* new ConnectionTransientError({
              reason: "remote-unavailable",
              detail: "Could not discover the remote T3 Code server.",
            });
          }
          const { runtime, alive } = yield* decodeDiscovery(
            extractJsonObject(discovery.stdout),
          ).pipe(
            Effect.mapError(
              () =>
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
          return { runtime };
        }),
      );
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
      const { localPort } = yield* atStage(
        trace,
        "T3 forwarding",
        call(() => native.forward(session.sessionId, remoteHost, runtime.port)),
      );
      if (
        routeSignal.aborted ||
        !(yield* Effect.forEach(sessionIds, isOpen).pipe(
          Effect.map((states) => states.every(Boolean)),
        ))
      ) {
        return yield* new ConnectionTransientError({
          reason: "network",
          detail: "The SSH session closed.",
        });
      }
      const tunnel: Tunnel = {
        sessionId: session.sessionId,
        localPort,
        remotePort: runtime.port,
        sessionIds,
        close: closeRoute,
      };
      tunnels.set(key, tunnel);
      return tunnel;
    }).pipe(
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) return Effect.void;
        trace("connection", "failed");
        return closeRoute;
      }),
    );
  });

  const provision = (target: DesktopSshEnvironmentTarget, expectedEnvironmentId?: EnvironmentId) =>
    lock.withLock(
      sshTargetKey(target),
      Effect.gen(function* () {
        const trace = startSshDiagnostics(target);
        const credentials = yield* atStage(
          trace,
          "credentials",
          call(() => deps.readSshCredentials(target)),
        );
        if (credentials === null) {
          trace("credentials", "failed", "configuration");
          return yield* new ConnectionBlockedError({
            reason: "configuration",
            detail: "No SSH key is saved for this connection. Remove it and add it again.",
          });
        }
        rememberSecret(credentials.bearerToken);
        let cachedTunnel = tunnels.get(sshTargetKey(target));
        if (
          cachedTunnel !== undefined &&
          !(yield* Effect.forEach(cachedTunnel.sessionIds, isOpen).pipe(
            Effect.map((states) => states.every(Boolean)),
          ))
        ) {
          tunnels.delete(sshTargetKey(target));
          yield* cachedTunnel.close;
          cachedTunnel = undefined;
        }
        const tunnel = cachedTunnel ?? (yield* open(target, credentials, trace));
        return yield* Effect.gen(function* () {
          const httpBaseUrl = `http://127.0.0.1:${tunnel.localPort}`;
          const wsBaseUrl = `ws://127.0.0.1:${tunnel.localPort}`;
          const descriptor = yield* atStage(
            trace,
            "environment identity",
            deps
              .fetchRemoteEnvironmentDescriptor({ httpBaseUrl })
              .pipe(Effect.mapError(remoteError)),
          );
          if (
            expectedEnvironmentId !== undefined &&
            descriptor.environmentId !== expectedEnvironmentId
          ) {
            trace("environment identity", "failed", "configuration");
            return yield* environmentMismatchError({
              expected: expectedEnvironmentId,
              actual: descriptor.environmentId,
            });
          }
          let bearerToken = credentials.bearerToken;
          if (bearerToken !== null) {
            const valid = yield* atStage(
              trace,
              "T3 authentication",
              deps.fetchRemoteSessionState({ httpBaseUrl, bearerToken }).pipe(
                Effect.map((session) => session.authenticated),
                Effect.catch((error) =>
                  credentialRejected(error)
                    ? Effect.succeed(false)
                    : Effect.fail(remoteError(error)),
                ),
              ),
            );
            if (!valid) {
              bearerToken = null;
              yield* call(() => deps.updateSshCredentials(target, { bearerToken: null }));
            }
          }
          if (bearerToken === null) {
            bearerToken = yield* atStage(
              trace,
              "pairing",
              Effect.gen(function* () {
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
                  Effect.mapError(
                    () =>
                      new ConnectionTransientError({
                        reason: "remote-unavailable",
                        detail: "The remote T3 Code pairing response is invalid.",
                      }),
                  ),
                );
                rememberSecret(credential);
                const access = yield* deps
                  .bootstrapRemoteBearerSession({ httpBaseUrl, credential })
                  .pipe(Effect.mapError(remoteError));
                rememberSecret(access.access_token);
                yield* call(() =>
                  deps.updateSshCredentials(target, { bearerToken: access.access_token }),
                );
                return access.access_token;
              }),
            );
          }
          trace("connection", "ok");
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
        }).pipe(
          Effect.onError(() => {
            if (tunnels.get(sshTargetKey(target)) === tunnel) tunnels.delete(sshTargetKey(target));
            trace("connection", "failed");
            return tunnel.close;
          }),
        );
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
          yield* tunnel.close;
        }),
      ),
  };
}
