import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

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

type ActivityThread = ThreadNotificationInput &
  Pick<
    EnvironmentThreadShell,
    "environmentId" | "id" | "projectId" | "title" | "lineage" | "updatedAt" | "settledOverride"
  >;

const ACTIVITY_PRESENTATIONS = {
  approval: { phase: "waiting_for_approval", status: "Approval", priority: 0 },
  input: { phase: "waiting_for_input", status: "Input", priority: 1 },
  working: { phase: "running", status: "Working", priority: 2 },
  waiting: { phase: "stale", status: "Waiting", priority: 3 },
  limited: { phase: "failed", status: "Failed", priority: 4 },
  failed: { phase: "failed", status: "Failed", priority: 4 },
  ready: { phase: "completed", status: "Done", priority: 5 },
} as const;

export function localAndroidAgentActivity(
  threads: ReadonlyArray<ActivityThread>,
  projects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly title: string;
  }>,
  liveEnvironmentIds: ReadonlySet<EnvironmentId>,
  now: number,
): Record<string, string> | null {
  const rows = threads.flatMap((thread) => {
    if (
      !liveEnvironmentIds.has(thread.environmentId) ||
      thread.archivedAt !== null ||
      thread.lineage.relationshipToParent === "subagent" ||
      thread.lineage.sideChat === true
    ) {
      return [];
    }
    const status = threadStatus(thread);
    const terminal = status === "ready" || status === "failed" || status === "limited";
    const occurredAt = Date.parse(
      thread.latestRun?.completedAt ?? thread.runtime?.updatedAt ?? thread.updatedAt,
    );
    if (
      terminal &&
      (thread.settledOverride === "settled" ||
        (status === "ready" && thread.latestRun?.status !== "completed") ||
        !Number.isFinite(occurredAt) ||
        now - occurredAt < 0 ||
        now - occurredAt >= 60_000)
    ) {
      return [];
    }
    return [{ thread, ...ACTIVITY_PRESENTATIONS[status], terminal, occurredAt }];
  });
  rows.sort((left, right) => left.priority - right.priority || right.occurredAt - left.occurredAt);
  const hero = rows[0];
  if (!hero) return null;
  const lineText = (value: string) => value.replace(/[\t\r\n]/gu, " ").slice(0, 120);
  return {
    activity_identity: JSON.stringify([
      hero.thread.environmentId,
      hero.thread.id,
      hero.thread.latestRun?.runId ?? null,
    ]),
    activity_phase: hero.phase,
    activity_active_count: String(rows.filter((row) => !row.terminal).length),
    activity_attention_count: String(rows.filter((row) => row.priority <= 1).length),
    activity_path: `/threads/${encodeURIComponent(hero.thread.environmentId)}/${encodeURIComponent(hero.thread.id)}`,
    ...(hero.terminal ? { activity_expires_at: String(hero.occurredAt + 60_000) } : {}),
    ...Object.fromEntries(
      rows.slice(0, 5).map((row, index) => {
        const project = projects.find(
          (candidate) =>
            candidate.environmentId === row.thread.environmentId &&
            candidate.id === row.thread.projectId,
        );
        return [
          `activity_line_${index}`,
          [row.status, lineText(row.thread.title), lineText(project?.title ?? "No project")].join(
            "\t",
          ),
        ];
      }),
    ),
  };
}
