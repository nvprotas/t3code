import { describe, expect, it } from "@effect/vitest";
import { RemoteEnvironmentAuthUndeclaredStatusError } from "@t3tools/client-runtime/authorization";
import { EnvironmentAuthInvalidError, EnvironmentId } from "@t3tools/contracts";
import { buildMobilePairingScript, REMOTE_RUNTIME_DISCOVERY_SCRIPT } from "@t3tools/ssh/scripts";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

vi.mock("expo", () => ({ requireOptionalNativeModule: () => null }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import type { SshTargetCredentials } from "./credentials";
import { makeMobileSshGateway, type MobileSshGatewayDeps, type MobileSshTransport } from "./gateway";
import type { SshClosedEvent, SshHostKeyEvent } from "./native";

const target = { alias: "server", hostname: "example.test", username: "alice", port: 22 };
const environmentId = EnvironmentId.makeUnsafe("remote-environment");
const prepareInput = { connectionId: "ssh-connection", expectedEnvironmentId: environmentId, target };
const running = {
  runtime: { pid: 123, port: 3773, origin: "http://0.0.0.0:3773" },
  alive: true,
};
const result = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  let credentials: SshTargetCredentials = {
    keyRef: "key-1",
    hostKey: "ssh-ed25519 pinned",
    bearerToken: "cached-bearer",
  };
  const hostKeyListeners = new Set<(event: SshHostKeyEvent) => void>();
  const closedListeners = new Set<(event: SshClosedEvent) => void>();
  const sessions = new Set<string>();
  let sequence = 0;
  const transport = {
    connect: vi.fn<MobileSshTransport["connect"]>(async () => {
      const sessionId = `session-${++sequence}`;
      sessions.add(sessionId);
      return { sessionId, hostKey: "ssh-ed25519 accepted" };
    }),
    confirmHostKey: vi.fn<MobileSshTransport["confirmHostKey"]>(async () => undefined),
    cancel: vi.fn<MobileSshTransport["cancel"]>(async () => undefined),
    exec: vi.fn<MobileSshTransport["exec"]>(async (_sessionId, _command, script) =>
      result(
        script === REMOTE_RUNTIME_DISCOVERY_SCRIPT
          ? JSON.stringify(running)
          : 'Downloading archive...\n{"credential":"pairing-secret",}\n',
      ),
    ),
    forward: vi.fn<MobileSshTransport["forward"]>(async () => ({ localPort: 41234 })),
    isOpen: vi.fn<MobileSshTransport["isOpen"]>((sessionId) => sessions.has(sessionId)),
    close: vi.fn<MobileSshTransport["close"]>(async (sessionId) => {
      sessions.delete(sessionId);
    }),
    addListener: vi.fn<MobileSshTransport["addListener"]>((event, listener) => {
      if (event === "onHostKey") {
        const callback = listener as (value: SshHostKeyEvent) => void;
        hostKeyListeners.add(callback);
        return { remove: () => { hostKeyListeners.delete(callback); } };
      }
      const callback = listener as (value: SshClosedEvent) => void;
      closedListeners.add(callback);
      return { remove: () => { closedListeners.delete(callback); } };
    }),
  };
  const deps = {
    transport,
    readSshCredentials: vi.fn<MobileSshGatewayDeps["readSshCredentials"]>(async () => credentials),
    updateSshCredentials: vi.fn<MobileSshGatewayDeps["updateSshCredentials"]>(async (_target, patch) => {
      credentials = { ...credentials, ...patch };
    }),
    requestHostKeyConfirmation: vi.fn<MobileSshGatewayDeps["requestHostKeyConfirmation"]>(
      async () => true,
    ),
    requestPassphrase: vi.fn<MobileSshGatewayDeps["requestPassphrase"]>(
      async () => "correct-passphrase",
    ),
    fetchRemoteEnvironmentDescriptor: vi.fn<MobileSshGatewayDeps["fetchRemoteEnvironmentDescriptor"]>(
      () => Effect.succeed({ environmentId, label: "Remote", serverVersion: "1.2.3" }),
    ),
    fetchRemoteSessionState: vi.fn<MobileSshGatewayDeps["fetchRemoteSessionState"]>(() =>
      Effect.succeed({ authenticated: true }),
    ),
    bootstrapRemoteBearerSession: vi.fn<MobileSshGatewayDeps["bootstrapRemoteBearerSession"]>(
      () => Effect.succeed({ access_token: "new-bearer" }),
    ),
  } satisfies MobileSshGatewayDeps;
  return {
    deps,
    transport,
    sessions,
    hostKeyListeners,
    closedListeners,
    gateway: makeMobileSshGateway(deps),
    credentials: () => credentials,
    closeRemotely(sessionId: string) {
      sessions.delete(sessionId);
      for (const listener of closedListeners) {
        listener({ sessionId, code: "SSH_SESSION_CLOSED", message: "Network changed." });
      }
    },
  };
}

describe("mobile SSH gateway", () => {
  it("serializes parallel prepares and reuses one tunnel", async () => {
    const f = fixture();
    const prepared = await Effect.runPromise(
      Effect.all([f.gateway.prepare(prepareInput), f.gateway.prepare(prepareInput)], {
        concurrency: "unbounded",
      }),
    );
    expect(prepared[0]).toEqual(prepared[1]);
    expect(prepared[0]?.bootstrap).toEqual({
      target,
      httpBaseUrl: "http://127.0.0.1:41234",
      wsBaseUrl: "ws://127.0.0.1:41234",
      pairingToken: null,
      remotePort: 3773,
      remoteServerKind: "external",
    });
    expect(f.transport.connect).toHaveBeenCalledTimes(1);
    expect(f.transport.forward).toHaveBeenCalledExactlyOnceWith("session-1", "127.0.0.1", 3773);
    expect(f.transport.exec).toHaveBeenCalledExactlyOnceWith("session-1", "sh -s", REMOTE_RUNTIME_DISCOVERY_SCRIPT, 15_000);
  });

  it("reopens after onClosed and ignores a late close for an old session", async () => {
    const f = fixture();
    await Effect.runPromise(f.gateway.prepare(prepareInput));
    f.closeRemotely("session-1");
    expect(f.closedListeners.size).toBe(0);
    expect(f.transport.connect).toHaveBeenCalledTimes(1);
    await Effect.runPromise(f.gateway.prepare(prepareInput));
    f.closeRemotely("session-1");
    await Effect.runPromise(f.gateway.prepare(prepareInput));
    expect(f.transport.connect).toHaveBeenCalledTimes(2);
    expect(f.closedListeners.size).toBe(1);
  });

  it("checks isOpen before reusing a session", async () => {
    const f = fixture();
    await Effect.runPromise(f.gateway.prepare(prepareInput));
    f.sessions.clear();
    await Effect.runPromise(f.gateway.prepare(prepareInput));
    expect(f.transport.connect).toHaveBeenCalledTimes(2);
    expect(f.closedListeners.size).toBe(1);
  });

  it("confirms and pins a new host key before using the session", async () => {
    const f = fixture();
    await f.deps.updateSshCredentials(target, { hostKey: null });
    const confirmed = deferred<boolean>();
    f.transport.confirmHostKey.mockImplementationOnce(async (_attemptId, accept) => { confirmed.resolve(accept); });
    f.transport.connect.mockImplementationOnce(async (options) => {
      for (const listener of f.hostKeyListeners) {
        listener({ attemptId: "another-attempt", hostKey: "ignored", fingerprint: "ignored" });
        listener({ attemptId: options.attemptId, hostKey: "ssh-ed25519 accepted", fingerprint: "SHA256:test" });
      }
      expect(await confirmed.promise).toBe(true);
      f.sessions.add("session-1");
      return { sessionId: "session-1", hostKey: "ssh-ed25519 accepted" };
    });
    await Effect.runPromise(f.gateway.provision(target));
    expect(f.deps.requestHostKeyConfirmation).toHaveBeenCalledExactlyOnceWith({ destination: "alice@example.test:22", fingerprint: "SHA256:test" });
    expect(f.credentials().hostKey).toBe("ssh-ed25519 accepted");
    expect(f.hostKeyListeners.size).toBe(0);
    expect(f.transport.connect.mock.calls[0]?.[0].hostKey).toBeNull();
  });

  it("asks again for a wrong passphrase and keeps the successful one in memory", async () => {
    const f = fixture();
    f.transport.connect
      .mockRejectedValueOnce({ code: "SSH_PASSPHRASE_REQUIRED", message: "Encrypted key." })
      .mockRejectedValueOnce({ code: "SSH_PASSPHRASE_REQUIRED", message: "Incorrect passphrase." });
    f.deps.requestPassphrase.mockResolvedValueOnce("wrong-passphrase");
    await Effect.runPromise(f.gateway.prepare(prepareInput));
    expect(f.deps.requestPassphrase.mock.calls).toEqual([
      [{ destination: "alice@example.test:22", retry: false }],
      [{ destination: "alice@example.test:22", retry: true }],
    ]);
    expect(f.transport.connect.mock.calls.map(([options]) => options.passphrase)).toEqual([
      null, "wrong-passphrase", "correct-passphrase",
    ]);
    f.closeRemotely("session-1");
    await Effect.runPromise(f.gateway.prepare(prepareInput));
    expect(f.transport.connect.mock.calls[3]?.[0].passphrase).toBe("correct-passphrase");
    expect(f.deps.updateSshCredentials).not.toHaveBeenCalled();
  });

  it("blocks when the passphrase prompt is cancelled", async () => {
    const f = fixture();
    f.transport.connect.mockRejectedValueOnce({ code: "SSH_PASSPHRASE_REQUIRED" });
    f.deps.requestPassphrase.mockResolvedValueOnce(null);
    const error = await Effect.runPromise(Effect.flip(f.gateway.prepare(prepareInput)));
    expect(error).toMatchObject({ _tag: "ConnectionBlockedError", reason: "authentication" });
    expect(f.hostKeyListeners.size).toBe(0);
  });

  it.each([
    { runtime: null, alive: false },
    { runtime: running.runtime, alive: false },
  ])("reports a stopped remote server and closes the SSH session: %j", async (discovery) => {
    const f = fixture();
    f.transport.exec.mockResolvedValueOnce(result(JSON.stringify(discovery)));
    const error = await Effect.runPromise(Effect.flip(f.gateway.prepare(prepareInput)));
    expect(error).toMatchObject({ _tag: "ConnectionTransientError", reason: "remote-unavailable" });
    expect(error.detail).toContain("T3 Code is not running on example.test");
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith("session-1");
    expect(f.closedListeners.size).toBe(0);
    expect(f.transport.forward).not.toHaveBeenCalled();
  });

  it("checks environment identity before validating or issuing credentials", async () => {
    const f = fixture();
    const error = await Effect.runPromise(Effect.flip(f.gateway.provision(target, EnvironmentId.makeUnsafe("other-environment"))));
    expect(error).toMatchObject({ _tag: "ConnectionBlockedError", reason: "configuration" });
    expect(f.deps.fetchRemoteSessionState).not.toHaveBeenCalled();
    expect(f.deps.bootstrapRemoteBearerSession).not.toHaveBeenCalled();
    expect(f.transport.exec).toHaveBeenCalledTimes(1);
  });

  it("uses a valid cached bearer without issuing another pairing credential", async () => {
    const f = fixture();
    const provisioned = await Effect.runPromise(f.gateway.provision(target, environmentId));
    expect(provisioned).toMatchObject({ environmentId, label: "Remote", bearerToken: "cached-bearer" });
    expect(f.deps.fetchRemoteSessionState).toHaveBeenCalledExactlyOnceWith({ httpBaseUrl: "http://127.0.0.1:41234", bearerToken: "cached-bearer" });
    expect(f.deps.bootstrapRemoteBearerSession).not.toHaveBeenCalled();
    expect(f.transport.exec).toHaveBeenCalledTimes(1);
  });

  it.each([
    new EnvironmentAuthInvalidError({ code: "auth_invalid", reason: "invalid_credential", traceId: "test-trace" }),
    new RemoteEnvironmentAuthUndeclaredStatusError("http://127.0.0.1:41234/api/auth/session", 401),
    new RemoteEnvironmentAuthUndeclaredStatusError("http://127.0.0.1:41234/api/auth/session", 403),
  ])("replaces a rejected cached bearer: %s", async (rejection) => {
    const f = fixture();
    f.deps.fetchRemoteSessionState.mockReturnValueOnce(Effect.fail(rejection));
    const prepared = await Effect.runPromise(f.gateway.prepare(prepareInput));
    expect(prepared.bearerToken).toBe("new-bearer");
    expect(f.deps.updateSshCredentials.mock.calls).toEqual([
      [target, { bearerToken: null }], [target, { bearerToken: "new-bearer" }],
    ]);
    expect(f.deps.bootstrapRemoteBearerSession).toHaveBeenCalledExactlyOnceWith({ httpBaseUrl: "http://127.0.0.1:41234", credential: "pairing-secret" });
    const pairingCall = f.transport.exec.mock.calls[1];
    expect(pairingCall?.[3]).toBe(900_000);
    expect(pairingCall?.[2]).toContain("mobile-");
    expect(f.credentials().bearerToken).toBe("new-bearer");
  });

  it("pairs when no bearer is saved and uses a stable state key", async () => {
    const f = fixture();
    await f.deps.updateSshCredentials(target, { bearerToken: null });
    await Effect.runPromise(f.gateway.provision(target));
    const script = f.transport.exec.mock.calls[1]?.[2];
    const stateKey = script?.match(/mobile-[a-z0-9-]+/u)?.[0];
    expect(stateKey).toBeDefined();
    expect(script).toBe(buildMobilePairingScript({ stateKey: stateKey!, archiveVersion: "1.2.3" }));
    await Effect.runPromise(f.gateway.disconnect(target));
    await f.deps.updateSshCredentials(target, { bearerToken: null });
    await Effect.runPromise(f.gateway.provision(target));
    expect(f.transport.exec.mock.calls[3]?.[2]).toBe(script);
    expect(f.deps.fetchRemoteSessionState).not.toHaveBeenCalled();
  });

  it("replaces a bearer when the session endpoint returns authenticated false", async () => {
    const f = fixture();
    f.deps.fetchRemoteSessionState.mockReturnValueOnce(Effect.succeed({ authenticated: false }));
    const prepared = await Effect.runPromise(f.gateway.prepare(prepareInput));
    expect(prepared.bearerToken).toBe("new-bearer");
    expect(f.deps.bootstrapRemoteBearerSession).toHaveBeenCalledTimes(1);
  });

  it("disconnects without deleting saved credentials", async () => {
    const f = fixture();
    await Effect.runPromise(f.gateway.prepare(prepareInput));
    await Effect.runPromise(f.gateway.disconnect(target));
    await Effect.runPromise(f.gateway.disconnect(target));
    expect(f.transport.close).toHaveBeenCalledExactlyOnceWith("session-1");
    expect(f.closedListeners.size).toBe(0);
    expect(f.deps.updateSshCredentials).not.toHaveBeenCalled();
    await Effect.runPromise(f.gateway.prepare(prepareInput));
    expect(f.transport.connect).toHaveBeenCalledTimes(2);
  });

  it("blocks a connection with no saved key", async () => {
    const f = fixture();
    f.deps.readSshCredentials.mockResolvedValueOnce(null);
    const error = await Effect.runPromise(Effect.flip(f.gateway.provision(target)));
    expect(error).toMatchObject({ _tag: "ConnectionBlockedError", reason: "configuration" });
    expect(f.transport.connect).not.toHaveBeenCalled();
  });

  it.each([
    ["SSH_AUTH_FAILED", "ConnectionBlockedError", "authentication"],
    ["SSH_KEY_INVALID", "ConnectionBlockedError", "authentication"],
    ["SSH_HOST_KEY_CHANGED", "ConnectionBlockedError", "authentication"],
    ["SSH_HOST_KEY_REJECTED", "ConnectionBlockedError", "authentication"],
    ["SSH_TIMEOUT", "ConnectionTransientError", "timeout"],
    ["SSH_OPEN_FAILED", "ConnectionTransientError", "network"],
    ["SSH_SESSION_CLOSED", "ConnectionTransientError", "network"],
    ["SSH_FORWARD_FAILED", "ConnectionTransientError", "network"],
    ["SSH_EXEC_FAILED", "ConnectionTransientError", "remote-unavailable"],
  ])("maps %s and redacts saved credentials", async (code, tag, reason) => {
    const f = fixture();
    f.transport.connect.mockRejectedValueOnce({ code, message: "Native failure cached-bearer" });
    const error = await Effect.runPromise(Effect.flip(f.gateway.provision(target)));
    expect(error).toMatchObject({ _tag: tag, reason });
    expect(error.detail).toContain("Native failure");
    expect(error.detail).not.toContain("cached-bearer");
  });
});
