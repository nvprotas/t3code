import { connectionRoutes, type ConnectionCatalogEntry } from "@t3tools/client-runtime/connection";
import type { DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import * as Option from "effect/Option";

export function parseSshTarget(input: {
  readonly host: string;
  readonly username: string;
  readonly port: string;
}): DesktopSshEnvironmentTarget {
  const address = input.host.trim();
  const parts = /^(?:([^@\s]+)@)?(\[[^\]]+\]|[^:@\s[\]]+)(?::([0-9]+))?$/.exec(address);
  if (parts === null) {
    throw new Error("Enter a host or user@host:port. Put IPv6 addresses in brackets.");
  }
  const username = parts[1] ?? input.username.trim();
  if (!username || /[\s@:/\\]/.test(username)) {
    throw new Error("Enter a valid SSH username.");
  }
  const host = parts[2]!;
  const hostname = host.startsWith("[") ? host.slice(1, -1) : host;
  if (
    /[\s/\\?#]/.test(hostname) ||
    !hostname ||
    hostname.startsWith("-") ||
    (host.startsWith("[") && !hostname.includes(":"))
  ) {
    throw new Error("Enter a hostname or IP address without a URL scheme or path.");
  }
  const portText = parts[3] ?? (input.port.trim() || "22");
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Enter a port from 1 to 65535.");
  }
  return {
    alias: `${username}@${host}${port === 22 ? "" : `:${port}`}`,
    hostname,
    username,
    port: port === 22 ? null : port,
  };
}

export function savedSshTargets(entries: Iterable<ConnectionCatalogEntry>) {
  return Array.from(entries).flatMap((entry) =>
    connectionRoutes(entry).flatMap((route) => {
      const profile = Option.getOrNull(route.profile);
      return route.target._tag === "SshConnectionTarget" && profile?._tag === "SshConnectionProfile"
        ? [profile.target]
        : [];
    }),
  );
}

export function isSshKeyReferenced(
  keyRef: string,
  savedCredentials: ReadonlyArray<{ readonly keyRef: string } | null>,
): boolean {
  return savedCredentials.some((credentials) => credentials?.keyRef === keyRef);
}
