/**
 * T3 Code mobile bridge (not in upstream t3-office). Inside the app's WebView the office gets its threads
 * pushed from React Native instead of polling the dev server, and asks the app to open a thread.
 */
interface Host {
  postMessage(message: string): void;
}

const host = (window as unknown as { ReactNativeWebView?: Host }).ReactNativeWebView;
export const bridged = !!host;

let latest: unknown = null;
const waiters: ((snapshot: unknown) => void)[] = [];
let paused = false;
let resume: (() => void) | null = null;

(window as unknown as { __t3office: object }).__t3office = {
  push(snapshot: unknown) {
    latest = snapshot;
    for (const w of waiters.splice(0)) w(snapshot);
  },
  pause(on: boolean) {
    const was = paused;
    paused = on;
    if (was && !on) {
      const fn = resume;
      resume = null;
      fn?.();
    }
  },
};

export function nextSnapshot<T>(): Promise<T> {
  return latest ? Promise.resolve(latest as T) : new Promise((r) => waiters.push(r as (s: unknown) => void));
}

export function openInApp(id: string) {
  host?.postMessage(JSON.stringify({ type: 'open', id }));
}

export const isPaused = () => paused;
export function onResume(fn: () => void) {
  resume = fn;
}

host?.postMessage(JSON.stringify({ type: 'ready' }));
