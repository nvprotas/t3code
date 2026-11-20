import { describe, expect, it } from "vite-plus/test";

import { officeThreadStatus } from "./officeStatus";

type Input = Parameters<typeof officeThreadStatus>[0];

function thread(overrides: Partial<Input> = {}): Input {
  return {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    interactionMode: "default",
    latestRun: null,
    runtime: null,
    ...overrides,
  };
}

const running = { status: "running", activeRunId: null } as unknown as Input["runtime"];

describe("officeThreadStatus", () => {
  it("is idle for a settled thread", () => {
    expect(officeThreadStatus(thread(), "connected")).toBe("idle");
  });

  it("is working while a turn runs", () => {
    expect(officeThreadStatus(thread({ runtime: running }), "connected")).toBe("working");
  });

  it.each([{ hasPendingApprovals: true }, { hasPendingUserInput: true }] as const)(
    "waits for the user on %j even while a turn runs",
    (pending) => {
      expect(officeThreadStatus(thread({ runtime: running, ...pending }), "connected")).toBe(
        "waiting",
      );
    },
  );

  it.each(["connecting", "reconnecting", "offline", "error", "unsupported", "available"] as const)(
    "is disconnected, not idle or working, when the environment is %s",
    (state) => {
      expect(officeThreadStatus(thread(), state)).toBe("disconnected");
      expect(
        officeThreadStatus(thread({ runtime: running, hasPendingApprovals: true }), state),
      ).toBe("disconnected");
    },
  );
});
