// @effect-diagnostics nodeBuiltinImport:off - The scripts run through a real sh in a temporary HOME.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { satisfiesSemverRange } from "@t3tools/shared/semver";

import {
  buildMobilePairingScript,
  buildRemoteNodeEnvScript,
  REMOTE_RUNTIME_DISCOVERY_SCRIPT,
} from "./scripts.ts";

function withHome(test: (home: string) => void) {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-ssh-scripts-"));
  try {
    test(home);
  } finally {
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
}

function runScript(script: string, home: string, path = "/usr/bin:/bin") {
  return NodeChildProcess.spawnSync("/bin/sh", ["-s"], {
    input: script,
    env: { HOME: home, PATH: path },
    encoding: "utf8",
    timeout: 10_000,
  });
}

function writeRuntime(home: string, pid: number, multiline = false) {
  const runtime = {
    version: 1,
    pid,
    port: 3773,
    origin: "http://127.0.0.1:3773",
    serverVersion: "1.2.3",
  };
  NodeFS.mkdirSync(NodePath.join(home, ".t3/userdata"), { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(home, ".t3/userdata/server-runtime.json"),
    JSON.stringify(runtime, null, multiline ? 2 : undefined) + "\n",
  );
  return runtime;
}

function writeFakeT3(path: string, credential: string) {
  NodeFS.writeFileSync(
    path,
    `#!/bin/sh
[ "$#" -eq 6 ] && [ "$1 $2 $3" = "auth pairing create" ] &&
  [ "$4" = "--base-dir" ] && [ "$5" = "$HOME/.t3" ] && [ "$6" = "--json" ] || exit 2
printf '%s\\n' '${JSON.stringify({ credential })}'
`,
    { mode: 0o700 },
  );
}

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")("remote runtime discovery", () => {
  it("reports a missing runtime file without failing", () => {
    withHome((home) => {
      const result = runScript(REMOTE_RUNTIME_DISCOVERY_SCRIPT, home);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '{"runtime":null,"alive":false}\n');
    });
  });

  it.each([false, true])("reports a live pid (multiline: %s)", (multiline) => {
    withHome((home) => {
      const runtime = writeRuntime(home, process.pid, multiline);
      const result = runScript(REMOTE_RUNTIME_DISCOVERY_SCRIPT, home);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { runtime, alive: true });
      assert.equal(result.stdout.trim().split("\n").length, 1);
    });
  });

  it("reports a dead pid while preserving the runtime record", () => {
    withHome((home) => {
      const exited = NodeChildProcess.spawnSync("/bin/sh", ["-c", "exit 0"]);
      assert.equal(exited.status, 0);
      const runtime = writeRuntime(home, exited.pid);
      const result = runScript(REMOTE_RUNTIME_DISCOVERY_SCRIPT, home);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { runtime, alive: false });
    });
  });
});

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")("mobile pairing script", () => {
  it.each([null, "dev", "1.2.3"])("uses t3 on PATH for version %s", (archiveVersion) => {
    withHome((home) => {
      const bin = NodePath.join(home, "bin");
      NodeFS.mkdirSync(bin);
      writeFakeT3(NodePath.join(bin, "t3"), "path-token");
      const result = runScript(
        buildMobilePairingScript({ stateKey: "test", archiveVersion }),
        home,
        bin,
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { credential: "path-token" });
    });
  });

  it("prefers the completed pinned runtime over t3 on PATH", () => {
    withHome((home) => {
      const bin = NodePath.join(home, "bin");
      const runtime = NodePath.join(home, ".t3/runtime/versions/1.2.3");
      NodeFS.mkdirSync(bin);
      NodeFS.mkdirSync(runtime, { recursive: true });
      writeFakeT3(NodePath.join(bin, "t3"), "path-token");
      writeFakeT3(NodePath.join(runtime, "t3"), "archive-token");
      NodeFS.writeFileSync(NodePath.join(runtime, ".install-complete"), "1.2.3\n");
      const result = runScript(
        buildMobilePairingScript({ stateKey: "test", archiveVersion: "1.2.3" }),
        home,
        `${bin}:/usr/bin:/bin`,
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { credential: "archive-token" });
    });
  });

  it("discovers t3 through the non-interactive login shell PATH", () => {
    withHome((home) => {
      const bin = NodePath.join(home, "bin");
      const loginBin = NodePath.join(home, "login-bin");
      NodeFS.mkdirSync(bin);
      NodeFS.mkdirSync(loginBin);
      writeFakeT3(NodePath.join(loginBin, "t3"), "login-token");
      NodeFS.writeFileSync(
        NodePath.join(bin, "sh"),
        `#!/bin/sh
[ "$1" = "-lc" ] || exit 2
printf '%s' "$HOME/login-bin"
`,
        { mode: 0o700 },
      );
      const result = runScript(
        buildMobilePairingScript({ stateKey: "test", archiveVersion: null }),
        home,
        bin,
      );
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { credential: "login-token" });
    });
  });

  it.each([null, "dev'$(exit 42)"])("fails clearly without t3 or an archive (%s)", (version) => {
    withHome((home) => {
      const result = runScript(
        buildMobilePairingScript({ stateKey: "test", archiveVersion: version }),
        home,
        home,
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.include(
        result.stderr,
        `t3 is not on PATH and the server version ${version ?? "unknown"} has no release archive`,
      );
    });
  });

  it("rejects shell syntax in state keys", () => {
    assert.throws(() =>
      buildMobilePairingScript({ stateKey: '$(exit 42)"', archiveVersion: "1.2.3" }),
    );
  });
});

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "embedded Node engine check",
  () => {
    it.each(["^22.16 || ^23.11 || >=24.10", ">=999", "<999", "invalid"])(
      "agrees with the shared checker for %s",
      (range) => {
        withHome((home) => {
          NodeFS.symlinkSync(process.execPath, NodePath.join(home, "node"));
          const result = runScript(
            `${buildRemoteNodeEnvScript({ nodeEngineRange: range })}\nremote_node_satisfies_engine\n`,
            home,
            home,
          );
          assert.equal(result.status, satisfiesSemverRange(process.versions.node, range) ? 0 : 1);
        });
      },
    );
  },
);
