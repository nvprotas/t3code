import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as SecureStore from "expo-secure-store";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import { readSshCredentials, updateSshCredentials, writeSshCredentials } from "./credentials";

it("keeps bastion trust while updating target credentials and separates storage by route", async () => {
  const target = { alias: "dev", hostname: "127.0.0.1", username: "dev", port: 22002 };
  const bastion = { alias: "jump", hostname: "jump-a.test", username: "access", port: null };
  const routed = { ...target, bastion };
  const credentials = {
    keyRef: "target-key",
    hostKey: "target-pin",
    bearerToken: null,
    bastion: { keyRef: "bastion-key", hostKey: "bastion-pin" },
  };
  const read = vi.mocked(SecureStore.getItemAsync);
  const write = vi.mocked(SecureStore.setItemAsync);
  read.mockReset();
  write.mockReset();
  read.mockResolvedValue(JSON.stringify(credentials));
  expect(await readSshCredentials(routed)).toEqual(credentials);
  await updateSshCredentials(routed, { bearerToken: "new-token" });
  expect(JSON.parse(write.mock.calls[0]![1])).toEqual({ ...credentials, bearerToken: "new-token" });
  await writeSshCredentials(target, credentials);
  await writeSshCredentials(
    { ...target, bastion: { ...bastion, hostname: "jump-b.test" } },
    credentials,
  );
  expect(new Set(write.mock.calls.map(([key]) => key)).size).toBe(3);
});

it("reads legacy direct credentials but rejects a bastion profile without its key", async () => {
  const target = { alias: "dev", hostname: "server.test", username: "dev", port: null };
  const credentials = { keyRef: "target-key", hostKey: "target-pin", bearerToken: "cached" };
  vi.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(credentials));
  expect(await readSshCredentials(target)).toEqual(credentials);
  expect(
    await readSshCredentials({ ...target, bastion: { ...target, hostname: "jump.test" } }),
  ).toBeNull();
});
