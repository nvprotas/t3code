import * as SecureStore from "expo-secure-store";

// Synchronous and on disk, so the trail survives a native crash that kills the app.
const KEY = "office-debug-log";
const MAX_CHARS = 1800;

export const OFFICE_STABLE_MARK = "stable";

export function readOfficeLog(): string {
  try {
    return SecureStore.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function logOfficeStep(step: string) {
  try {
    const line = `${new Date().toISOString().slice(11, 23)} ${step}\n`;
    SecureStore.setItem(KEY, (readOfficeLog() + line).slice(-MAX_CHARS));
  } catch {}
}

export function clearOfficeLog() {
  try {
    SecureStore.setItem(KEY, "");
  } catch {}
}

/** The last 3D session started but never reached a steady render. */
export function officeCrashedLastTime(log: string) {
  return log.includes("scene mounted") && !log.includes(OFFICE_STABLE_MARK);
}
