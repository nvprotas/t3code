import { useAtomValue } from "@effect/atom-react";
import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import {
  type PendingSubagentRequest,
  presentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { pendingSubagentRequestsByThread } from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import * as Notifications from "expo-notifications";
import { useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";

import { environmentCatalog } from "../../connection/catalog";
import { environmentShell } from "../../state/shell";
import { mobilePreferencesAtom } from "../../state/preferences";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import {
  evaluateThreadNotification,
  type ThreadNotificationMark,
} from "./localThreadNotifications";

/**
 * Posts thread notifications from the live connection for builds without
 * T3 Connect, where the relay cannot push. Works only while the app process
 * keeps its connection; taps route through useAgentNotificationNavigation.
 */
export function LocalThreadNotificationsWorker() {
  const enabled = useAtomValue(
    mobilePreferencesAtom,
    (result) =>
      AsyncResult.isSuccess(result) && result.value.localThreadNotificationsEnabled === true,
  );
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const environmentIds = useMemo(() => [...enabledEnvironmentIds(catalog)], [catalog]);

  if (!enabled || hasCloudPublicConfig()) return null;
  return environmentIds.map((environmentId) => (
    <EnvironmentLocalNotifications key={environmentId} environmentId={environmentId} />
  ));
}

interface ThreadEntry {
  readonly raw: OrchestrationV2ThreadShell;
  readonly subagentRequest: PendingSubagentRequest | null;
  readonly mark: ThreadNotificationMark;
}

function EnvironmentLocalNotifications({ environmentId }: { environmentId: EnvironmentId }) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const threads =
    shell.status === "live" && Option.isSome(shell.snapshot) ? shell.snapshot.value.threads : null;
  const previous = useRef(new Map<ThreadId, ThreadEntry>());

  useEffect(() => {
    if (threads === null) {
      previous.current.clear();
      return;
    }
    const next = new Map<ThreadId, ThreadEntry>();
    // Subagents are skipped, so their requests notify through the thread above them.
    const subagentRequests = pendingSubagentRequestsByThread(threads);
    for (const raw of threads) {
      if (raw.lineage.relationshipToParent === "subagent") continue;
      const prior = previous.current.get(raw.id);
      const subagentRequest = subagentRequests.get(raw.id) ?? null;
      if (prior?.raw === raw && prior.subagentRequest === subagentRequest) {
        next.set(raw.id, prior);
        continue;
      }
      const thread = presentThreadShell(environmentId, raw, subagentRequest);
      const { mark, title } = evaluateThreadNotification(thread, prior?.mark);
      next.set(raw.id, { raw, subagentRequest, mark });
      if (title === null) continue;
      // One notification per thread: a newer state replaces the older one.
      void Notifications.scheduleNotificationAsync({
        identifier: `${environmentId}:${thread.id}`,
        content: { title, body: thread.title, data: { environmentId, threadId: thread.id } },
        trigger: Platform.OS === "android" ? { channelId: "agent-alerts" } : null,
      }).catch((cause: unknown) => {
        console.warn("Failed to post local thread notification", cause);
      });
    }
    previous.current = next;
  }, [environmentId, threads]);

  return null;
}
