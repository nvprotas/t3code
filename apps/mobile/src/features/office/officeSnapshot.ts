import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";

import { officeThreadStatus } from "./officeStatus";

/** The office scene seats four teams; more groups share the emptiest one. */
const TEAM_COUNT = 4;
/** Idle threads untouched for longer than this stay out of the office. */
const IDLE_WINDOW_MS = 48 * 60 * 60 * 1000;

type SceneProvider = "claude" | "codex" | "cursor" | "gemini";
type SceneStatus = "running" | "waiting" | "idle" | "failed";

export type OfficeSceneThread = Pick<
  EnvironmentThreadShell,
  | "archivedAt"
  | "environmentId"
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "id"
  | "interactionMode"
  | "latestRun"
  | "lineage"
  | "modelSelection"
  | "pendingSubagentRequest"
  | "projectId"
  | "providerInstanceId"
  | "runtime"
  | "settledOverride"
  | "title"
  | "updatedAt"
>;

export interface OfficeSceneEnvironment {
  readonly environmentId: EnvironmentThreadShell["environmentId"];
  readonly environmentLabel: string;
  readonly connectionState: EnvironmentConnectionPhase;
}

export interface OfficeSceneTarget {
  readonly environmentId: string;
  readonly threadId: string;
}

function sceneProvider(instanceId: string): SceneProvider {
  const id = instanceId.toLowerCase();
  if (id.includes("claude")) return "claude";
  if (id.includes("codex")) return "codex";
  if (id.includes("gemini") || id.includes("antigravity")) return "gemini";
  return "cursor";
}

const sceneId = (thread: Pick<OfficeSceneThread, "environmentId" | "id">) =>
  `${thread.environmentId}:${thread.id}`;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The wire snapshot t3-office's T3Source reads (vendor/t3-office/src/t3source.ts), built from the
 * app's own thread shells. Threads get scene ids that `targets` maps back to the thread to open.
 */
export function buildOfficeSnapshot(input: {
  readonly environments: ReadonlyArray<OfficeSceneEnvironment>;
  readonly threads: ReadonlyArray<OfficeSceneThread>;
  readonly projects: ReadonlyArray<Pick<EnvironmentProject, "environmentId" | "id" | "title">>;
  readonly now: number;
  readonly offlineLabel: string;
}) {
  const environments = new Map(input.environments.map((env) => [env.environmentId, env]));
  const projectTitles = new Map(
    input.projects.map((project) => [`${project.environmentId}:${project.id}`, project.title]),
  );
  const byEnvironment = input.environments.length > 1;
  const targets = new Map<string, OfficeSceneTarget>();

  const rows = input.threads.flatMap((thread) => {
    const environment = environments.get(thread.environmentId);
    if (
      environment === undefined ||
      thread.archivedAt !== null ||
      thread.settledOverride === "settled" ||
      thread.lineage.sideChat === true
    ) {
      return [];
    }
    const status = officeThreadStatus(thread, environment.connectionState);
    const updatedAt = Date.parse(thread.updatedAt);
    if (status === "idle" && input.now - updatedAt > IDLE_WINDOW_MS) return [];
    const project =
      projectTitles.get(`${thread.environmentId}:${thread.projectId}`) ??
      environment.environmentLabel;
    return [{ thread, environment, status, updatedAt, project }];
  });

  const shown = new Set(rows.map((row) => sceneId(row.thread)));
  const groupOf = (row: (typeof rows)[number]) =>
    byEnvironment ? row.environment.environmentLabel : row.project;
  const groups = [...new Set(rows.map(groupOf))].sort((a, b) => a.localeCompare(b));
  const load = Array.from({ length: TEAM_COUNT }, () => 0);
  const teamOf = new Map<string, number>();
  for (const group of groups) {
    const team = teamOf.size < TEAM_COUNT ? teamOf.size : load.indexOf(Math.min(...load));
    teamOf.set(group, team);
    load[team] = (load[team] ?? 0) + rows.filter((row) => groupOf(row) === group).length;
  }

  const threads = rows.map((row) => {
    const { thread, environment, status } = row;
    const id = sceneId(thread);
    targets.set(id, { environmentId: String(thread.environmentId), threadId: String(thread.id) });
    const parent = thread.lineage.parentThreadId;
    const parentId =
      thread.lineage.relationshipToParent === "subagent" && parent !== null
        ? `${thread.environmentId}:${parent}`
        : null;
    const sceneStatus: SceneStatus =
      status === "working"
        ? "running"
        : status === "waiting"
          ? "waiting"
          : status === "disconnected"
            ? "failed"
            : "idle";
    return {
      id,
      title: thread.title,
      provider: sceneProvider(thread.providerInstanceId),
      providerInstanceId: String(thread.providerInstanceId),
      providerLabel: String(thread.providerInstanceId),
      model: thread.modelSelection.model,
      status: sceneStatus,
      runStatus: thread.latestRun?.status ?? "",
      team: teamOf.get(groupOf(row)) ?? 0,
      projectId: String(thread.projectId),
      project: byEnvironment ? `${environment.environmentLabel} · ${row.project}` : row.project,
      parentId: parentId !== null && shown.has(parentId) ? parentId : null,
      managerId: null,
      updatedAt: row.updatedAt,
      lastActiveAt: row.updatedAt,
      runStartedAt: Date.parse(thread.latestRun?.startedAt ?? "") || 0,
      toolCalls: 0,
      files: 0,
      context: 0,
      cost: 0,
      tps: 0,
      activity:
        status === "waiting"
          ? { code: "waiting" }
          : { code: "", v: status === "disconnected" ? input.offlineLabel : "" },
      message: "",
      events: [],
      prs: [],
      url: "",
    };
  });

  const teams = Array.from({ length: TEAM_COUNT }, (_, index) => {
    const members = groups.filter((group) => teamOf.get(group) === index);
    const name = members[0] ?? "";
    return {
      index,
      name,
      short: name ? clip(name, 14) + (members.length > 1 ? ` +${members.length - 1}` : "") : "",
      overflowOf: null,
      projects: members.map((group) => ({
        title: group,
        ids: [],
        threads: rows.filter((row) => groupOf(row) === group).length,
      })),
    };
  });

  return {
    targets,
    snapshot: {
      ok: true,
      fetchedAt: new Date(input.now).toISOString(),
      environmentId: "",
      webBase: "",
      teams,
      threads,
      boss: null,
      totals: {
        runs: 0,
        tokens: 0,
        cost: 0,
        queued: 0,
        running: threads.filter((t) => t.status === "running").length,
        waiting: threads.filter((t) => t.status === "waiting").length,
      },
    },
  };
}
