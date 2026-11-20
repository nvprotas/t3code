import { useAtomValue } from "@effect/atom-react";
import { useGT } from "gt-react-native";
import { lazy, Suspense, use, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RenderErrorBoundary } from "../../components/RenderErrorBoundary";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";
import { steadyNavigationThreadShellsAtom } from "../../state/threads";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { OfficeAgentCard } from "./OfficeAgentCard";
import { OfficeDebugCard } from "./OfficeDebugCard";
import { officeCrashedLastTime, readOfficeLog } from "./officeLog";
import { officeShortNames } from "./officeNames";
import { OfficeRoom } from "./OfficeRoom";
import { OfficeSceneFailure } from "./OfficeSceneFailure";
import { buildOfficeGroups } from "./officeStatus";

// Loaded on demand so a GL or three.js failure stays inside the Office tab instead of blanking the app.
const OfficeScene = lazy(() =>
  import("./OfficeScene").then((module) => ({ default: module.OfficeScene })),
);

export function OfficeScreen() {
  const gt = useGT();
  const [startup] = useState(() => {
    const log = readOfficeLog();
    return { log, crashed: officeCrashedLastTime(log) };
  });
  const [started, setStarted] = useState(!startup.crashed);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [scrollLocked, setScrollLocked] = useState(false);
  const insets = useSafeAreaInsets();
  const tabActivity = use(NativeWorkspaceTabActivityContext);
  const headerOnly = tabActivity?.headerOnly === true;
  const selectDetail = useSelectWorkspaceDetail();
  const environments = useWorkspaceEnvironments();
  const threads = useAtomValue(steadyNavigationThreadShellsAtom);
  const groups = buildOfficeGroups(environments, threads);
  const rows = groups.flatMap((group) => group.rows);
  // Threads of unreachable environments stay in the list below but get no one in the room.
  const present = rows.filter((row) => row.status !== "disconnected");
  const names = officeShortNames(present.map((row) => row.thread.title));
  const agents = present.map((row, index) => ({
    id: String(row.thread.id),
    name: names[index] ?? row.thread.title,
    status: row.status,
    subagents: row.thread.pendingBackgroundTasks.filter((task) => task.kind === "subagent").length,
  }));
  const selectedGroup = groups.find((group) =>
    group.rows.some((row) => String(row.thread.id) === selectedId),
  );
  const selected = selectedGroup?.rows.find((row) => String(row.thread.id) === selectedId);
  const openThread = (target: { environmentId: string; threadId: string }) =>
    selectDetail({ name: "Thread", params: target });

  return (
    <SettingsScreen title={gt("Office")} workspaceRoot>
      {headerOnly ? null : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          scrollEnabled={!scrollLocked}
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {started ? null : (
            <OfficeDebugCard
              log={startup.log}
              crashed={startup.crashed}
              onStart={() => setStarted(true)}
            />
          )}
          {started ? (
            <RenderErrorBoundary renderFallback={(failure) => <OfficeSceneFailure {...failure} />}>
              <Suspense fallback={null}>
                <OfficeScene
                  agents={agents}
                  active={tabActivity?.active ?? true}
                  selectedId={selectedId}
                  onSelectAgent={setSelectedId}
                  onLockScroll={setScrollLocked}
                />
              </Suspense>
            </RenderErrorBoundary>
          ) : null}
          {selected && selectedGroup ? (
            <OfficeAgentCard
              thread={selected.thread}
              status={selected.status}
              environment={selectedGroup.label}
              onOpen={() =>
                openThread({
                  environmentId: String(selected.thread.environmentId),
                  threadId: String(selected.thread.id),
                })
              }
              onClose={() => setSelectedId(undefined)}
            />
          ) : null}
          {groups.map((group) => (
            <OfficeRoom
              key={group.environmentId}
              group={group}
              onOpenThread={({ thread }) =>
                openThread({
                  environmentId: String(thread.environmentId),
                  threadId: String(thread.id),
                })
              }
            />
          ))}
        </ScrollView>
      )}
    </SettingsScreen>
  );
}
