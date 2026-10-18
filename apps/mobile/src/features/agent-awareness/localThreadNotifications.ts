import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

type ThreadNotificationInput = Pick<
  EnvironmentThreadShell,
  | "archivedAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "latestRun"
  | "pendingSubagentRequest"
  | "runtime"
>;

/** What a thread last notified about, so the same state never notifies twice. */
export interface ThreadNotificationMark {
  /** `<runId>:<status>` while the thread needs attention, otherwise null. */
  readonly attention: string | null;
  /** Completion time of the latest finished run. */
  readonly completion: number | null;
}

type ThreadStatus = "approval" | "input" | "working" | "waiting" | "failed" | "limited" | "ready";
type AttentionStatus = Extract<ThreadStatus, "approval" | "input" | "failed" | "limited">;

const BUSY_RUNTIME_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

// Same order as the web sidebar's resolveSidebarThreadStatus.
function threadStatus(thread: ThreadNotificationInput): ThreadStatus {
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") {
    return "approval";
  }
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") {
    return "input";
  }
  if (thread.runtime !== null && BUSY_RUNTIME_STATUSES.has(thread.runtime.status)) return "working";
  if (thread.runtime?.status === "idle") return "waiting";
  if (thread.runtime?.status === "failed") {
    return thread.runtime.lastErrorClass === "usage_limit" ? "limited" : "failed";
  }
  return thread.latestRun?.status === "failed" ? "failed" : "ready";
}

function isAttention(status: ThreadStatus): status is AttentionStatus {
  return status === "approval" || status === "input" || status === "failed" || status === "limited";
}

const ATTENTION_TITLES: Record<AttentionStatus, string> = {
  approval: "Approval needed",
  input: "Input needed",
  failed: "Thread failed",
  limited: "Usage limit reached",
};

/**
 * Mirrors the web ThreadNotificationCoordinator: a thread notifies when it
 * newly needs attention or a later run completes. Returns the mark to keep and
 * the notification title, or null when nothing new happened. A thread seen for
 * the first time only records its mark, so connecting never replays history.
 */
export function evaluateThreadNotification(
  thread: ThreadNotificationInput,
  prior: ThreadNotificationMark | undefined,
): { readonly mark: ThreadNotificationMark; readonly title: string | null } {
  const status = threadStatus(thread);
  const attention = isAttention(status) ? `${thread.latestRun?.runId ?? ""}:${status}` : null;
  const completedAt = Date.parse(thread.latestRun?.completedAt ?? "");
  // Threads parked on subagents or monitors read as waiting and complete later.
  const completion =
    status === "ready" && thread.latestRun?.status === "completed" && Number.isFinite(completedAt)
      ? completedAt
      : (prior?.completion ?? null);
  const mark = { attention, completion };
  if (!prior || thread.archivedAt !== null) return { mark, title: null };
  if (isAttention(status) && attention !== prior.attention) {
    return { mark, title: ATTENTION_TITLES[status] };
  }
  if (completion !== null && (prior.completion === null || completion > prior.completion)) {
    return { mark, title: "Thread completed" };
  }
  return { mark, title: null };
}
