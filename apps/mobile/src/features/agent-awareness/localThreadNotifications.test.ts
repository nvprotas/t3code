import { describe, expect, it } from "vite-plus/test";

import {
  evaluateThreadNotification,
  localAndroidAgentActivity,
  type ThreadNotificationMark,
} from "./localThreadNotifications";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

type Input = Parameters<typeof evaluateThreadNotification>[0];

function thread(input: {
  readonly runId?: string;
  readonly run?: "running" | "completed" | "failed";
  readonly runtime?: "running" | "idle" | "failed" | "completed" | null;
  readonly completedAt?: string | null;
  readonly approval?: boolean;
  readonly userInput?: boolean;
  readonly usageLimit?: boolean;
  readonly archived?: boolean;
}): Input {
  const runtime = input.runtime === undefined ? "completed" : input.runtime;
  return {
    archivedAt: input.archived ? "2026-10-18T10:00:00.000Z" : null,
    hasPendingApprovals: input.approval ?? false,
    hasPendingUserInput: input.userInput ?? false,
    pendingSubagentRequest: null,
    latestRun: {
      runId: input.runId ?? "run-1",
      status: input.run ?? "completed",
      requestedAt: null,
      startedAt: null,
      completedAt: input.completedAt === undefined ? "2026-10-18T10:00:00.000Z" : input.completedAt,
      assistantMessageId: null,
    },
    runtime:
      runtime === null
        ? null
        : {
            status: runtime,
            activeRunId: null,
            providerInstanceId: "codex",
            providerName: null,
            lastError: null,
            lastErrorClass: input.usageLimit ? "usage_limit" : null,
            usageLimitResetAt: null,
            updatedAt: "2026-10-18T10:00:00.000Z",
          },
  } as unknown as Input;
}

function mark(input: Partial<ThreadNotificationMark> = {}): ThreadNotificationMark {
  return { attention: null, completion: null, ...input };
}

describe("evaluateThreadNotification", () => {
  it("records a thread seen for the first time without notifying", () => {
    const result = evaluateThreadNotification(thread({}), undefined);
    expect(result.title).toBeNull();
    expect(result.mark.completion).toBe(Date.parse("2026-10-18T10:00:00.000Z"));
  });

  it("notifies once when a running thread completes", () => {
    const running = evaluateThreadNotification(
      thread({ run: "running", runtime: "running", completedAt: null }),
      mark(),
    );
    expect(running.title).toBeNull();

    const completed = evaluateThreadNotification(thread({}), running.mark);
    expect(completed.title).toBe("Thread completed");
    expect(evaluateThreadNotification(thread({}), completed.mark).title).toBeNull();
  });

  it("waits while subagents or monitors park the thread", () => {
    expect(evaluateThreadNotification(thread({ runtime: "idle" }), mark()).title).toBeNull();
  });

  it.each([
    [{ approval: true }, "Approval needed"],
    [{ userInput: true }, "Input needed"],
    [{ runtime: "failed" as const, run: "failed" as const }, "Thread failed"],
    [{ runtime: "failed" as const, usageLimit: true }, "Usage limit reached"],
    [{ runtime: null, run: "failed" as const }, "Thread failed"],
  ])("notifies when the thread needs attention (%o)", (input, title) => {
    const first = evaluateThreadNotification(thread(input), mark());
    expect(first.title).toBe(title);
    expect(evaluateThreadNotification(thread(input), first.mark).title).toBeNull();
  });

  it("notifies again for the same request on a later run", () => {
    const first = evaluateThreadNotification(thread({ userInput: true }), mark());
    const later = evaluateThreadNotification(
      thread({ userInput: true, runId: "run-2" }),
      first.mark,
    );
    expect(later.title).toBe("Input needed");
  });

  it("stays quiet for archived threads", () => {
    expect(evaluateThreadNotification(thread({ archived: true }), mark()).title).toBeNull();
  });
});

describe("localAndroidAgentActivity", () => {
  const environmentId = EnvironmentId.make("ssh-server");
  const otherEnvironmentId = EnvironmentId.make("other-server");
  const projectId = ProjectId.make("project");
  const live = new Set([environmentId]);
  const now = Date.parse("2026-10-18T10:00:30.000Z");
  const activityThread = (input: Parameters<typeof thread>[0] = {}, id = "thread") => ({
    ...thread(input),
    environmentId,
    projectId,
    id: ThreadId.make(id),
    title: id,
    updatedAt: "2026-10-18T10:00:00.000Z",
    settledOverride: null,
    lineage: { rootThreadId: ThreadId.make(id), parentThreadId: null, relationshipToParent: null },
  });

  it("prioritizes an agent needing input over running work and ignores offline agents", () => {
    const working = activityThread({ runtime: "running", run: "running" }, "working");
    const input = activityThread({ userInput: true }, "question");
    const offline = { ...activityThread({ approval: true }), environmentId: otherEnvironmentId };
    const result = localAndroidAgentActivity([working, input, offline], [], live, now);
    expect(result).toMatchObject({
      activity_phase: "waiting_for_input",
      activity_active_count: "2",
      activity_attention_count: "1",
      activity_path: "/threads/ssh-server/question",
      activity_line_0: "Input\tquestion\tNo project",
    });
    expect(localAndroidAgentActivity([working], [], new Set(), now)).toBeNull();
    expect(
      localAndroidAgentActivity(
        [working, { ...input, pendingSubagentRequest: "approval" }],
        [],
        live,
        now,
      )?.activity_phase,
    ).toBe("waiting_for_approval");
  });

  it("shows a completion briefly without replaying archived settled or historical results", () => {
    const completed = activityThread();
    expect(localAndroidAgentActivity([completed], [], live, now)).toMatchObject({
      activity_phase: "completed",
      activity_expires_at: String(Date.parse("2026-10-18T10:01:00.000Z")),
    });
    expect(localAndroidAgentActivity([completed], [], live, now + 60_000)).toBeNull();
    expect(
      localAndroidAgentActivity([{ ...completed, archivedAt: completed.updatedAt }], [], live, now),
    ).toBeNull();
    expect(
      localAndroidAgentActivity([{ ...completed, settledOverride: "settled" }], [], live, now),
    ).toBeNull();
    expect(
      localAndroidAgentActivity([activityThread({ runtime: "idle" })], [], live, now),
    ).toMatchObject({ activity_phase: "stale" });
  });

  it("keeps activity identity across status changes and escapes thread links and row separators", () => {
    const working = activityThread({ runtime: "running", run: "running" }, "thread:one/two");
    const first = localAndroidAgentActivity([working], [], live, now);
    const completed = { ...working, ...thread({}), title: "title\twith\nseparators" };
    const result = localAndroidAgentActivity(
      [completed],
      [{ environmentId, id: projectId, title: "project\nname" }],
      live,
      now,
    );
    expect(result?.activity_identity).toBe(first?.activity_identity);
    expect(result?.activity_path).toBe("/threads/ssh-server/thread%3Aone%2Ftwo");
    expect(result?.activity_line_0).toBe("Done\ttitle with separators\tproject name");
  });
});
