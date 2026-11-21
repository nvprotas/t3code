import { describe, expect, it } from "vite-plus/test";

import { buildOfficeGroups, officeSceneFacts, officeThreadStatus } from "./officeStatus";

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

describe("buildOfficeGroups", () => {
  it("leaves out settled, archived and child threads but keeps the rest", () => {
    const environment = { environmentId: "env" as never, environmentLabel: "Env" };
    const lineage = {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: "t" as never,
    };
    const listed = {
      ...thread(),
      environmentId: environment.environmentId,
      updatedAt: "2026-01-01T00:00:00.000Z",
      title: "Thread",
      archivedAt: null,
      settledOverride: null,
      lineage,
    };
    const threads = [
      { ...listed, id: "kept" as never },
      { ...listed, id: "settled" as never, settledOverride: "settled" as const },
      { ...listed, id: "archived" as never, archivedAt: "2026-01-02T00:00:00.000Z" },
      {
        ...listed,
        id: "child" as never,
        lineage: { ...lineage, relationshipToParent: "subagent" as const },
      },
    ];
    const [group] = buildOfficeGroups([{ ...environment, connectionState: "connected" }], threads);
    expect(group?.rows.map((row) => row.thread.id)).toEqual(["kept"]);
  });
});

describe("officeSceneFacts", () => {
  type SceneInput = Parameters<typeof officeSceneFacts>[0];
  const pr = (state: string, checksState: string | null) =>
    ({ snapshot: { state, checksState } }) as unknown as SceneInput["pullRequests"][number];
  const scene = (overrides: Partial<SceneInput> = {}): SceneInput =>
    ({
      environmentId: "environment-1",
      projectId: "project-1",
      hasPendingApprovals: false,
      updatedAt: "2026-01-01T11:00:00.000Z",
      pullRequests: [],
      latestRun: null,
      limitRecovery: null,
      pendingBackgroundTasks: [],
      ...overrides,
    }) as SceneInput;

  it("tells an approval from a question", () => {
    expect(officeSceneFacts(scene({ hasPendingApprovals: true }), "waiting").ask).toBe("approval");
    expect(officeSceneFacts(scene(), "waiting").ask).toBe("input");
  });

  it("counts merged pull requests and raises the alarm only for failing open ones", () => {
    const facts = officeSceneFacts(
      scene({ pullRequests: [pr("merged", "failing"), pr("open", "passing")] }),
      "idle",
    );
    expect(facts.merged).toBe(1);
    expect(facts.alarm).toBe(false);
    expect(officeSceneFacts(scene({ pullRequests: [pr("open", "failing")] }), "idle").alarm).toBe(
      true,
    );
  });
});
