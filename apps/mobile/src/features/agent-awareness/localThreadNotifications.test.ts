import { describe, expect, it } from "vite-plus/test";

import {
  evaluateThreadNotification,
  type ThreadNotificationMark,
} from "./localThreadNotifications";

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
