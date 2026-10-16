import { sshTargetKey } from "@t3tools/client-runtime/connection";
import type { DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import * as SecureStore from "expo-secure-store";

/**
 * What the phone keeps per SSH target. The private key itself lives in the
 * native module (Keystore-encrypted); this only references it. Never synced.
 */
export interface SshTargetCredentials {
  readonly keyRef: string;
  /** Pinned host public key, set once the user accepts its fingerprint. */
  readonly hostKey: string | null;
  /** Cached bearer token so reconnects do not pair a new session every time. */
  readonly bearerToken: string | null;
}

// SecureStore keys allow only [A-Za-z0-9._-].
function storageKey(target: DesktopSshEnvironmentTarget): string {
  let hash = 0x811c9dc5;
  for (const char of sshTargetKey(target)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  return `t3.ssh.target.${hash.toString(16)}.${target.hostname.replace(/[^A-Za-z0-9._-]/gu, "_")}`;
}

export async function readSshCredentials(
  target: DesktopSshEnvironmentTarget,
): Promise<SshTargetCredentials | null> {
  const raw = await SecureStore.getItemAsync(storageKey(target));
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.keyRef !== "string") return null;
  return {
    keyRef: record.keyRef,
    hostKey: typeof record.hostKey === "string" ? record.hostKey : null,
    bearerToken: typeof record.bearerToken === "string" ? record.bearerToken : null,
  };
}

export async function writeSshCredentials(
  target: DesktopSshEnvironmentTarget,
  credentials: SshTargetCredentials,
): Promise<void> {
  await SecureStore.setItemAsync(storageKey(target), JSON.stringify(credentials));
}

export async function updateSshCredentials(
  target: DesktopSshEnvironmentTarget,
  patch: Partial<SshTargetCredentials>,
): Promise<void> {
  const current = await readSshCredentials(target);
  if (current === null) return;
  await writeSshCredentials(target, { ...current, ...patch });
}

export async function deleteSshCredentials(target: DesktopSshEnvironmentTarget): Promise<void> {
  await SecureStore.deleteItemAsync(storageKey(target));
}
