import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect } from "react";

import { useNowAfter } from "../../lib/clock";
import { useProjects, useThreadShells } from "../../state/entities";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { showAndroidLocalAgentActivity } from "./androidNotifications";
import { localAndroidAgentActivity } from "./localThreadNotifications";

export function LocalAgentActivityWorker() {
  const threads = useThreadShells();
  const projects = useProjects();
  const environments = useWorkspaceEnvironments();
  const enabled = useAtomValue(
    mobilePreferencesAtom,
    (result) => AsyncResult.isSuccess(result) && result.value.liveActivitiesEnabled !== false,
  );
  const completedAt = threads.reduce(
    (latest, thread) => Math.max(latest, Date.parse(thread.latestRun?.completedAt ?? "") || 0),
    0,
  );
  const now = useNowAfter(completedAt > 0 ? completedAt + 60_000 : null);
  const live = new Set(
    environments
      .filter((environment) => environment.isEnabled && environment.connectionState === "connected")
      .map((environment) => environment.environmentId),
  );
  const payload = JSON.stringify(
    enabled ? localAndroidAgentActivity(threads, projects, live, now) : null,
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Publish meaningful activity changes to Android's notification manager.
  useEffect(() => {
    showAndroidLocalAgentActivity(JSON.parse(payload) as Record<string, string> | null);
  }, [payload]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Remove the native card when local notifications are disabled or their worker unmounts.
  useEffect(() => () => showAndroidLocalAgentActivity(null), []);

  return null;
}
