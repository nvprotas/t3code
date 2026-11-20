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
  T extends OfficeThreadInput & Pick<EnvironmentThreadShell, "environmentId" | "updatedAt">,
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
      .filter((thread) => thread.environmentId === environment.environmentId)
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
