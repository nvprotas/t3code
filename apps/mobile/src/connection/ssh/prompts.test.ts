import { expect, it } from "@effect/vitest";

import { requestHostKeyConfirmation, requestPassphrase } from "./prompts";

it("dismisses host-key and passphrase prompts when their attempt is cancelled", async () => {
  const hostKey = new AbortController();
  const trust = requestHostKeyConfirmation({
    destination: "dev@target",
    fingerprint: "SHA256:test",
    signal: hostKey.signal,
  });
  hostKey.abort();
  expect(await trust).toBe(false);
  const passphrase = new AbortController();
  const unlock = requestPassphrase({
    destination: "access@bastion",
    retry: false,
    signal: passphrase.signal,
  });
  passphrase.abort();
  expect(await unlock).toBeNull();
  expect(
    await requestPassphrase({
      destination: "access@bastion",
      retry: false,
      signal: passphrase.signal,
    }),
  ).toBeNull();
});
