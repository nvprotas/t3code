import { useSyncExternalStore } from "react";

/**
 * Questions the SSH gateway needs the user to answer mid-connection. The
 * gateway awaits `request*`; `SshPromptHost` renders the head of the queue and
 * calls `answer`.
 */
export type SshPrompt =
  | {
      readonly id: string;
      readonly kind: "host-key";
      readonly destination: string;
      readonly fingerprint: string;
    }
  | {
      readonly id: string;
      readonly kind: "passphrase";
      readonly destination: string;
      /** Set when a previous passphrase was wrong. */
      readonly retry: boolean;
    };

type Answer = { readonly accept: boolean; readonly passphrase?: string };

let queue: ReadonlyArray<SshPrompt> = [];
const resolvers = new Map<string, (answer: Answer) => void>();
const listeners = new Set<() => void>();
let sequence = 0;

function publish(next: ReadonlyArray<SshPrompt>) {
  queue = next;
  for (const listener of listeners) listener();
}

function ask(prompt: SshPrompt): Promise<Answer> {
  return new Promise((resolve) => {
    resolvers.set(prompt.id, resolve);
    publish([...queue, prompt]);
  });
}

/** Resolves true when the user trusts this host key. */
export async function requestHostKeyConfirmation(input: {
  readonly destination: string;
  readonly fingerprint: string;
}): Promise<boolean> {
  sequence += 1;
  const answer = await ask({ id: `ssh-prompt-${sequence}`, kind: "host-key", ...input });
  return answer.accept;
}

/** Resolves the passphrase, or null when the user cancels. */
export async function requestPassphrase(input: {
  readonly destination: string;
  readonly retry: boolean;
}): Promise<string | null> {
  sequence += 1;
  const answer = await ask({ id: `ssh-prompt-${sequence}`, kind: "passphrase", ...input });
  return answer.accept ? (answer.passphrase ?? "") : null;
}

export function answerSshPrompt(id: string, answer: Answer): void {
  const resolve = resolvers.get(id);
  if (resolve === undefined) return;
  resolvers.delete(id);
  publish(queue.filter((prompt) => prompt.id !== id));
  resolve(answer);
}

/** Declines a prompt nobody will answer, for example after its attempt was cancelled. */
export function dismissSshPrompt(id: string): void {
  answerSshPrompt(id, { accept: false });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The prompt to show now, or null. */
export function useCurrentSshPrompt(): SshPrompt | null {
  return useSyncExternalStore(
    subscribe,
    () => queue[0] ?? null,
    () => null,
  );
}
