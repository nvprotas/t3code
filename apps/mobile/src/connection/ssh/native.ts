import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

/**
 * Error codes the native module rejects with (`error.code`). Authentication and
 * host-key codes need the user; the rest are transport failures worth retrying.
 */
export const SSH_NATIVE_ERROR_CODES = [
  "SSH_OPEN_FAILED",
  "SSH_TIMEOUT",
  "SSH_CANCELLED",
  "SSH_AUTH_FAILED",
  "SSH_PASSPHRASE_REQUIRED",
  "SSH_KEY_INVALID",
  "SSH_HOST_KEY_CHANGED",
  "SSH_HOST_KEY_REJECTED",
  "SSH_SESSION_CLOSED",
  "SSH_EXEC_FAILED",
  "SSH_FORWARD_FAILED",
] as const;
export type SshNativeErrorCode = (typeof SSH_NATIVE_ERROR_CODES)[number];

export function sshNativeErrorCode(error: unknown): SshNativeErrorCode {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { readonly code: unknown }).code
      : null;
  return SSH_NATIVE_ERROR_CODES.find((candidate) => candidate === code) ?? "SSH_OPEN_FAILED";
}

export interface SshConnectOptions {
  /** Caller-chosen id; host-key events and `cancel` refer to it. */
  readonly attemptId: string;
  readonly hostname: string;
  readonly port: number;
  readonly username: string;
  readonly keyRef: string;
  /** Null tries the key unencrypted; an encrypted key then rejects SSH_PASSPHRASE_REQUIRED. */
  readonly passphrase: string | null;
  /**
   * The pinned host public key (OpenSSH `type base64`). Null means unknown: the
   * module emits `onHostKey` and waits up to 60 s for `confirmHostKey`. A
   * different key than the pinned one rejects SSH_HOST_KEY_CHANGED without asking.
   */
  readonly hostKey: string | null;
}

export interface SshHostKeyEvent {
  readonly attemptId: string;
  /** OpenSSH `type base64`, to pin after the user accepts. */
  readonly hostKey: string;
  /** `SHA256:...` as `ssh-keygen -lf` prints it. */
  readonly fingerprint: string;
}

export interface SshClosedEvent {
  readonly sessionId: string;
  readonly code: SshNativeErrorCode;
  readonly message: string;
}

export interface SshKeyInfo {
  readonly keyRef: string;
  /** OpenSSH public key line, or null when it cannot be derived without the passphrase. */
  readonly publicKey: string | null;
  readonly encrypted: boolean;
}

export interface SshExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

type SshEvents = {
  onHostKey: (event: SshHostKeyEvent) => void;
  onClosed: (event: SshClosedEvent) => void;
};

/**
 * `T3Ssh` from `modules/t3-ssh` (Android only). One SSH session can carry
 * several exec channels and one local forward. Closing a session, losing the
 * network or failing keepalive closes its listener and emits `onClosed`.
 */
export interface T3SshNativeModule {
  /** Generates an ed25519 key, stored encrypted with an Android Keystore key. */
  generateKey(comment: string): Promise<SshKeyInfo>;
  /** Imports OpenSSH, PEM or PuTTY private key text (at most 64 KiB). Rejects SSH_KEY_INVALID. */
  importKey(privateKey: string): Promise<SshKeyInfo>;
  deleteKey(keyRef: string): Promise<void>;
  connect(
    options: SshConnectOptions,
  ): Promise<{ readonly sessionId: string; readonly hostKey: string }>;
  confirmHostKey(attemptId: string, accept: boolean): Promise<void>;
  /** Cancels a pending `connect`; it rejects SSH_CANCELLED. */
  cancel(attemptId: string): Promise<void>;
  /** Runs `command` in an exec channel, writing `stdin` then EOF. Rejects SSH_TIMEOUT after `timeoutMs`. */
  exec(
    sessionId: string,
    command: string,
    stdin: string | null,
    timeoutMs: number,
  ): Promise<SshExecResult>;
  /** Listens on 127.0.0.1 at an ephemeral port and forwards each connection to remoteHost:remotePort. */
  forward(
    sessionId: string,
    remoteHost: string,
    remotePort: number,
  ): Promise<{ readonly localPort: number }>;
  isOpen(sessionId: string): boolean;
  close(sessionId: string): Promise<void>;
  addListener<E extends keyof SshEvents>(event: E, listener: SshEvents[E]): { remove(): void };
}

export const sshNative: T3SshNativeModule | null =
  Platform.OS === "android" ? requireOptionalNativeModule<T3SshNativeModule>("T3Ssh") : null;

export function isSshSupported(): boolean {
  return sshNative !== null;
}
