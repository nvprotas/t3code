import { describe, expect, it } from "vite-plus/test";

import { buildOfficeSnapshot, type OfficeSceneThread } from "./officeSnapshot";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");

function thread(id: string, overrides: Record<string, unknown> = {}): OfficeSceneThread {
  return {
    archivedAt: null,
    environmentId: "local",
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    id,
    interactionMode: "default",
    latestRun: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
    pendingSubagentRequest: null,
    projectId: "p1",
    providerInstanceId: "claudeAgent",
    runtime: null,
    settledOverride: null,
    title: id,
    updatedAt: "2026-11-20T11:00:00.000Z",
    ...overrides,
  } as unknown as OfficeSceneThread;
}

const environments = [
  { environmentId: "local", environmentLabel: "Mac", connectionState: "connected" },
  { environmentId: "vps", environmentLabel: "VPS", connectionState: "offline" },
] as const;

function build(threads: OfficeSceneThread[], envs = environments) {
  return buildOfficeSnapshot({
    environments: envs as never,
    threads,
    projects: [],
    now: NOW,
    offlineLabel: "No connection",
  });
}

describe("buildOfficeSnapshot", () => {
  it("leaves out settled, archived, side-chat and long idle threads", () => {
    const { snapshot } = build([
      thread("kept"),
      thread("settled", { settledOverride: "settled" }),
      thread("archived", { archivedAt: "2026-11-19T00:00:00.000Z" }),
      thread("side", {
        lineage: {
          parentThreadId: "kept",
          relationshipToParent: null,
          rootThreadId: "kept",
          sideChat: true,
        },
      }),
      thread("stale", { updatedAt: "2026-11-01T00:00:00.000Z" }),
    ]);
    expect(snapshot.threads.map((t) => t.title)).toEqual(["kept"]);
  });

  it("seats each environment as its own team and shows lost connections as failed", () => {
    const { snapshot, targets } = build([thread("a"), thread("b", { environmentId: "vps" })]);
    const [a, b] = snapshot.threads;
    expect(a?.team).not.toBe(b?.team);
    expect(b?.status).toBe("failed");
    expect(b?.activity).toEqual({ code: "", v: "No connection" });
    expect(snapshot.teams.map((t) => t.name).slice(0, 2)).toEqual(["Mac", "VPS"]);
    expect(targets.get(b!.id)).toEqual({ environmentId: "vps", threadId: "b" });
  });

  it("keeps a subagent with its parent only while the parent is in the office", () => {
    const sub = (id: string, parent: string) =>
      thread(id, {
        lineage: { parentThreadId: parent, relationshipToParent: "subagent", rootThreadId: parent },
      });
    const { snapshot } = build([thread("root"), sub("child", "root"), sub("orphan", "gone")]);
    const byTitle = new Map(snapshot.threads.map((t) => [t.title, t]));
    expect(byTitle.get("child")?.parentId).toBe(byTitle.get("root")?.id);
    expect(byTitle.get("orphan")?.parentId).toBeNull();
  });
});
