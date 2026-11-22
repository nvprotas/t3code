import { useAtomValue } from "@effect/atom-react";
import { CommandId, MessageId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { useGT, useLocale } from "gt-react-native";
import { lazy, Suspense, use, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { RenderErrorBoundary } from "../../components/RenderErrorBoundary";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { uuidv4 } from "../../lib/uuid";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { steadyNavigationThreadShellsAtom } from "../../state/threads";
import { useProjects } from "../../state/entities";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { OfficeAgentCard } from "./OfficeAgentCard";
import { OfficeDebugCard } from "./OfficeDebugCard";
import { officeCrashedLastTime, readOfficeLog } from "./officeLog";
import { officeNames, officeTask } from "./officeNames";
import { OfficeRoom } from "./OfficeRoom";
import { OfficeSceneFailure } from "./OfficeSceneFailure";
import { buildOfficeGroups, officeSceneFacts } from "./officeStatus";

// Loaded on demand so a GL or three.js failure stays inside the Office tab instead of blanking the app.
const OfficeScene = lazy(() =>
  import("./OfficeScene").then((module) => ({ default: module.OfficeScene })),
);

function CameraButton(props: { readonly label: string; readonly onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="min-h-11 justify-center rounded-full bg-black/60 px-4"
    >
      <Text className="font-t3-bold text-white">{props.label}</Text>
    </Pressable>
  );
}

function sendToThread(
  thread: { readonly environmentId: EnvironmentId; readonly id: ThreadId },
  text: string,
) {
  return enqueueThreadOutboxMessage({
    environmentId: thread.environmentId,
    threadId: thread.id,
    messageId: MessageId.make(uuidv4()),
    commandId: CommandId.make(uuidv4()),
    text,
    attachments: [],
    dispatchMode: "auto",
    createdAt: new Date().toISOString(),
  });
}

export function OfficeScreen() {
  const gt = useGT();
  const locale = useLocale();
  const [startup] = useState(() => {
    const log = readOfficeLog();
    return { log, crashed: officeCrashedLastTime(log) };
  });
  const [started, setStarted] = useState(!startup.crashed);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [scrollLocked, setScrollLocked] = useState(false);
  const [focus, setFocus] = useState({ nonce: 0, target: "" });
  const insets = useSafeAreaInsets();
  const tabActivity = use(NativeWorkspaceTabActivityContext);
  const headerOnly = tabActivity?.headerOnly === true;
  const selectDetail = useSelectWorkspaceDetail();
  const environments = useWorkspaceEnvironments();
  const threads = useAtomValue(steadyNavigationThreadShellsAtom);
  const projects = useProjects();
  const { startNewTask } = useAdaptiveWorkspaceLayout();
  const projectTitles = new Map(
    projects.map((project) => [`${project.environmentId}/${project.id}`, project.title]),
  );
  const scratchProjects = new Set(
    projects
      .filter((project) => project.isScratch === true)
      .map((project) => `${project.environmentId}/${project.id}`),
  );
  const groups = buildOfficeGroups(environments, threads);
  const rows = groups.flatMap((group) => group.rows);
  // Threads of unreachable environments stay in the list below but get no one in the room.
  const present = rows.filter((row) => row.status !== "disconnected");
  const names = officeNames(
    present.map((row) => String(row.thread.id)),
    locale,
  );
  const agents = present.map((row, index) => ({
    id: String(row.thread.id),
    name: names[index] ?? "",
    task: officeTask(row.thread.title),
    status: row.status,
    ...officeSceneFacts(row.thread, row.status),
    // Threads without a project share one pod group, whichever server they run on.
    ...(scratchProjects.has(`${row.thread.environmentId}/${row.thread.projectId}`)
      ? { team: "scratch" }
      : {}),
    teamName: projectTitles.get(`${row.thread.environmentId}/${row.thread.projectId}`) ?? "",
  }));
  const selectedGroup = groups.find((group) =>
    group.rows.some((row) => String(row.thread.id) === selectedId),
  );
  const selected = selectedGroup?.rows.find((row) => String(row.thread.id) === selectedId);
  const selectedName = agents.find((agent) => agent.id === selectedId)?.name ?? "";
  const waiting = agents.filter((agent) => agent.status === "waiting");
  const moveCamera = (target: string) =>
    setFocus((current) => ({ nonce: current.nonce + 1, target }));
  // Each press flies to the next agent waiting for an answer and opens its card.
  const showNextWaiting = () => {
    const current = waiting.findIndex((agent) => agent.id === selectedId);
    const next = waiting[(current + 1) % waiting.length];
    if (next === undefined) return;
    setSelectedId(next.id);
    moveCamera(next.id);
  };
  const openThread = (target: { environmentId: string; threadId: string }) =>
    selectDetail({ name: "Thread", params: target });

  return (
    <SettingsScreen title={gt("Office")} workspaceRoot>
      {headerOnly ? null : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          scrollEnabled={!scrollLocked}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
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
            <View>
              <RenderErrorBoundary
                renderFallback={(failure) => <OfficeSceneFailure {...failure} />}
              >
                <Suspense fallback={null}>
                  <OfficeScene
                    agents={agents}
                    active={tabActivity?.active ?? true}
                    selectedId={selectedId}
                    onSelectAgent={setSelectedId}
                    onLockScroll={setScrollLocked}
                    focusRequest={`${focus.nonce}|${focus.target}`}
                  />
                </Suspense>
              </RenderErrorBoundary>
              {Platform.OS === "android" ? (
                <View className="absolute left-3 right-3 top-3 flex-row flex-wrap justify-end gap-2">
                  {waiting.length > 0 ? (
                    <CameraButton
                      label={gt("Waiting ({count})", { count: waiting.length })}
                      onPress={showNextWaiting}
                    />
                  ) : null}
                  <CameraButton label={gt("Overview")} onPress={() => moveCamera("overview")} />
                  <CameraButton label={gt("+ Thread")} onPress={startNewTask} />
                </View>
              ) : null}
              {selected && selectedGroup ? (
                <View className="absolute inset-x-2 bottom-2">
                  <OfficeAgentCard
                    thread={selected.thread}
                    status={selected.status}
                    name={selectedName}
                    environment={selectedGroup.label}
                    onOpen={() =>
                      openThread({
                        environmentId: String(selected.thread.environmentId),
                        threadId: String(selected.thread.id),
                      })
                    }
                    onClose={() => setSelectedId(undefined)}
                    onSend={(text) => sendToThread(selected.thread, text)}
                  />
                </View>
              ) : null}
            </View>
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
