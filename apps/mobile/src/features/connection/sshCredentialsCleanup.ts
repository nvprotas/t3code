import { sshTargetKey } from "@t3tools/client-runtime/connection";
import type { DesktopSshEnvironmentTarget, EnvironmentId } from "@t3tools/contracts";

import { environmentCatalog } from "../../connection/catalog";
import { deleteSshCredentials, readSshCredentials } from "../../connection/ssh/credentials";
import { sshNative } from "../../connection/ssh/native";
import { appAtomRegistry } from "../../state/atom-registry";
import { isSshKeyReferenced, savedSshTargets } from "./sshTarget";

export function currentSshTargets(excludeEnvironmentId?: EnvironmentId) {
  const entries = appAtomRegistry.get(environmentCatalog.catalogValueAtom).entries;
  return savedSshTargets(
    [...entries].flatMap(([id, entry]) => (id === excludeEnvironmentId ? [] : [entry])),
  );
}

export async function cleanupUnusedSshKey(keyRef: string): Promise<void> {
  try {
    const credentials = await Promise.all(currentSshTargets().map(readSshCredentials));
    if (!isSshKeyReferenced(keyRef, credentials)) await sshNative?.deleteKey(keyRef);
  } catch {
    // Preserve the key if another saved route's credentials cannot be read.
  }
}

/** Cleanup must never turn a successful catalog removal into a failure. */
export async function cleanupSshCredentials(
  target: DesktopSshEnvironmentTarget,
  removedEnvironmentId?: EnvironmentId,
): Promise<void> {
  try {
    const remaining = currentSshTargets(removedEnvironmentId);
    if (remaining.some((saved) => sshTargetKey(saved) === sshTargetKey(target))) return;
    const credentials = await readSshCredentials(target);
    if (credentials !== null) {
      // A failed read leaves the key intact: another saved route may still need it.
      const savedCredentials = await Promise.all(remaining.map(readSshCredentials));
      if (!isSshKeyReferenced(credentials.keyRef, savedCredentials)) {
        await sshNative?.deleteKey(credentials.keyRef).catch(() => undefined);
      }
    }
    await deleteSshCredentials(target);
  } catch {
    // Secure storage can be unavailable while the device is locked.
  }
}
