import { isListedThreadLineage } from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";

export type OfficeStatus = "working" | "waiting" | "idle" | "disconnected";

type OfficeThreadInput = Pick<
  EnvironmentThreadShell,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "interactionMode"
  | "latestRun"
  | "runtime"
>;

export function officeThreadStatus(
  thread: OfficeThreadInput,
  connectionState: EnvironmentConnectionPhase,
): OfficeStatus {
  if (connectionState !== "connected") return "disconnected";
  if (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.pendingSubagentRequest != null
  ) {
    return "waiting";
  }
  return isThreadWorking(thread) ? "working" : "idle";
}

const STATUS_RANK: Readonly<Record<OfficeStatus, number>> = {
  waiting: 0,
  working: 1,
  disconnected: 2,
  idle: 3,
};

export function buildOfficeGroups<
  T extends OfficeThreadInput &
    Pick<
      EnvironmentThreadShell,
      "archivedAt" | "environmentId" | "id" | "lineage" | "settledOverride" | "title" | "updatedAt"
    >,
>(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentThreadShell["environmentId"];
    readonly environmentLabel: string;
    readonly connectionState: EnvironmentConnectionPhase;
  }>,
  threads: ReadonlyArray<T>,
) {
  return environments.map((environment) => ({
    environmentId: environment.environmentId,
    label: environment.environmentLabel,
    connectionState: environment.connectionState,
    // Hermes lacks toSorted.
    rows: threads
      .filter(
        (thread) =>
          thread.environmentId === environment.environmentId &&
          thread.archivedAt === null &&
          isListedThreadLineage(thread.lineage) &&
          thread.settledOverride !== "settled",
      )
      .map((thread) => ({
        thread,
        status: officeThreadStatus(thread, environment.connectionState),
      }))
      .sort(
        (left, right) =>
          STATUS_RANK[left.status] - STATUS_RANK[right.status] ||
          right.thread.updatedAt.localeCompare(left.thread.updatedAt),
      ),
  }));
}

// After this long without activity an idle agent naps at its desk.
const NAP_AFTER_MS = 2 * 60 * 60 * 1000;

type OfficeSceneInput = Pick<
  EnvironmentThreadShell,
  | "projectId"
  | "hasPendingApprovals"
  | "updatedAt"
  | "pullRequests"
  | "latestRun"
  | "limitRecovery"
  | "pendingBackgroundTasks"
>;

/** What the Android office shows about a thread beyond its status. */
export function officeSceneFacts(thread: OfficeSceneInput, status: OfficeStatus, now: number) {
  return {
    team: String(thread.projectId),
    ask:
      status !== "waiting"
        ? ("" as const)
        : thread.hasPendingApprovals
          ? ("approval" as const)
          : ("input" as const),
    sleeping: status === "idle" && now - Date.parse(thread.updatedAt) > NAP_AFTER_MS,
    merged: thread.pullRequests.filter((link) => link.snapshot?.state === "merged").length,
    alarm:
      thread.latestRun?.status === "failed" ||
      thread.pullRequests.some(
        (link) => link.snapshot?.state === "open" && link.snapshot.checksState === "failing",
      ),
    limited: thread.limitRecovery != null,
    subagents: thread.pendingBackgroundTasks.filter((task) => task.kind === "subagent").length,
  };
}
