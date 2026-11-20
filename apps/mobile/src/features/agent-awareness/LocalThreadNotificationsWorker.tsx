import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { AsyncResult } from "effect/reactivity";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useThreadShells } from "../../state/entities";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { mobilePreferencesAtom } from "../../state/preferences";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { LocalAgentActivityWorker } from "./LocalAgentActivityWorker";
import {
  evaluateThreadNotification,
  type ThreadNotificationMark,
} from "./localThreadNotifications";

export function LocalThreadNotificationsWorker() {
  const enabled = useAtomValue(
    mobilePreferencesAtom,
    (result) =>
      AsyncResult.isSuccess(result) && result.value.localThreadNotificationsEnabled === true,
  );
  return enabled && !hasCloudPublicConfig() ? <EnabledLocalNotifications /> : null;
}

interface ThreadEntry {
  readonly raw: EnvironmentThreadShell["source"];
  readonly subagentRequest: EnvironmentThreadShell["pendingSubagentRequest"];
  readonly mark: ThreadNotificationMark;
}

function EnabledLocalNotifications() {
  const threads = useThreadShells();
  const environments = useWorkspaceEnvironments();
  const previous = useRef(new Map<string, ThreadEntry>());

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Deliver OS notifications for state transitions from connected environments.
  useEffect(() => {
    const live = new Set(
      environments
        .filter(
          (environment) => environment.isEnabled && environment.connectionState === "connected",
        )
        .map((environment) => environment.environmentId),
    );
    const next = new Map<string, ThreadEntry>();
    for (const thread of threads) {
      if (
        !live.has(thread.environmentId) ||
        thread.lineage.relationshipToParent === "subagent" ||
        thread.lineage.sideChat === true
      ) {
        continue;
      }
      const key = JSON.stringify([thread.environmentId, thread.id]);
      const prior = previous.current.get(key);
      const subagentRequest = thread.pendingSubagentRequest;
      if (prior?.raw === thread.source && prior.subagentRequest === subagentRequest) {
        next.set(key, prior);
        continue;
      }
      const { mark, title } = evaluateThreadNotification(thread, prior?.mark);
      next.set(key, { raw: thread.source, subagentRequest, mark });
      if (title === null) continue;
      void Notifications.scheduleNotificationAsync({
        identifier: `${thread.environmentId}:${thread.id}`,
        content: {
          title,
          body: thread.title,
          data: { environmentId: thread.environmentId, threadId: thread.id },
        },
        trigger: Platform.OS === "android" ? { channelId: "agent-alerts" } : null,
      }).catch((cause: unknown) => {
        console.warn("Failed to post local thread notification", cause);
      });
    }
    previous.current = next;
  }, [environments, threads]);

  return Platform.OS === "android" ? <LocalAgentActivityWorker /> : null;
}
