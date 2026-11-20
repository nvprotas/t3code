import { sshTargetKey, type ConnectionAttemptError } from "@t3tools/client-runtime/connection";
import type { DesktopSshEnvironmentTarget } from "@t3tools/contracts";

import type { SshNativeErrorCode } from "./native";

export type SshStage =
  | "credentials"
  | "bastion SSH"
  | "bastion forwarding"
  | "target SSH"
  | "discovery"
  | "T3 forwarding"
  | "environment identity"
  | "T3 authentication"
  | "pairing"
  | "connection";

const attempts = new Map<string, string[]>();

export function startSshDiagnostics(target: DesktopSshEnvironmentTarget) {
  const key = sshTargetKey(target);
  const lines: string[] = [];
  attempts.delete(key);
  attempts.set(key, lines);
  if (attempts.size > 20) attempts.delete(attempts.keys().next().value!);
  return (
    stage: SshStage,
    status: "started" | "ok" | "failed" | "closed",
    code?: SshNativeErrorCode | ConnectionAttemptError["reason"],
  ) => {
    // Only stages and machine codes belong here; native messages and script output may contain secrets.
    const current = attempts.get(key);
    if (current === undefined) return;
    current.push(`${new Date().toISOString()} ${stage}: ${status}${code ? ` (${code})` : ""}`);
    if (current.length > 64) current.shift();
  };
}

export function sshDiagnosticsText(target: DesktopSshEnvironmentTarget): string {
  const lines = attempts.get(sshTargetKey(target));
  if (lines === undefined) return "";
  const endpoint = (value: DesktopSshEnvironmentTarget) =>
    `${value.username ?? ""}@${value.hostname}:${value.port ?? 22}`;
  return [
    `SSH target: ${endpoint(target)}`,
    `Bastion: ${target.bastion ? endpoint(target.bastion) : "none"}`,
    ...lines,
  ].join("\n");
}
