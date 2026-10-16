import {
  BearerConnectionTarget,
  SshConnectionProfile,
  SshConnectionTarget,
  type ConnectionCatalogEntry,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { isSshKeyReferenced, parseSshTarget, savedSshTargets } from "./sshTarget";

describe("parseSshTarget", () => {
  it("normalizes separate fields and the default port", () => {
    expect(parseSshTarget({ host: " server.example ", username: " alice ", port: "22" })).toEqual({
      alias: "alice@server.example",
      hostname: "server.example",
      username: "alice",
      port: null,
    });
  });

  it("uses the username and port from a pasted destination", () => {
    expect(parseSshTarget({ host: "alice@server.example:2222", username: "bob", port: "22" })).toEqual({
      alias: "alice@server.example:2222",
      hostname: "server.example",
      username: "alice",
      port: 2222,
    });
  });

  it("keeps IPv6 brackets in the label but not the native hostname", () => {
    expect(parseSshTarget({ host: "alice@[2001:db8::1]:2222", username: "", port: "" })).toEqual({
      alias: "alice@[2001:db8::1]:2222",
      hostname: "2001:db8::1",
      username: "alice",
      port: 2222,
    });
  });

  it.each([
    "",
    "ssh://server",
    "server/path",
    "user@@server",
    "server:abc",
    "2001:db8::1",
    "[bad host]",
    "[server",
    "server]",
    "[server]",
  ])("rejects an invalid host: %s", (host) => {
    expect(() => parseSshTarget({ host, username: "alice", port: "22" })).toThrow();
  });

  it.each(["0", "65536", "22.5", "-1", "22abc"])("rejects an invalid port: %s", (port) => {
    expect(() => parseSshTarget({ host: "server", username: "alice", port })).toThrow();
  });

  it("requires a username and defaults an empty port to 22", () => {
    expect(() => parseSshTarget({ host: "server", username: "", port: "" })).toThrow("username");
    expect(parseSshTarget({ host: "alice@server", username: "", port: "" }).port).toBeNull();
  });
});

describe("SSH key references", () => {
  it("includes disabled environments and alternate SSH routes", () => {
    const environmentId = EnvironmentId.make("ssh-test");
    const target = parseSshTarget({ host: "alice@server", username: "", port: "" });
    const entry: ConnectionCatalogEntry = {
      enabled: false,
      target: new BearerConnectionTarget({ environmentId, label: "Server", connectionId: "direct" }),
      profile: Option.none(),
      alternateRoutes: [
        {
          target: new SshConnectionTarget({ environmentId, label: "Server", connectionId: "ssh" }),
          profile: Option.some(new SshConnectionProfile({
            environmentId,
            label: "Server",
            connectionId: "ssh",
            target,
          })),
        },
      ],
    };
    expect(savedSshTargets([entry])).toEqual([target]);
    expect(savedSshTargets([{ ...entry, alternateRoutes: [] }])).toEqual([]);
  });

  it("preserves a key referenced by another saved profile", () => {
    expect(isSshKeyReferenced("shared", [null, { keyRef: "other" }, { keyRef: "shared" }])).toBe(true);
    expect(isSshKeyReferenced("removed", [null, { keyRef: "other" }])).toBe(false);
    expect(isSshKeyReferenced("removed", [])).toBe(false);
  });
});
