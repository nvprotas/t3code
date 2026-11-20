import { useAtomValue } from "@effect/atom-react";
import { useGT } from "gt-react-native";
import { use, useState } from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";
import { useProjects } from "../../state/entities";
import { steadyNavigationThreadShellsAtom } from "../../state/threads";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { OfficeRoom } from "./OfficeRoom";
import { OfficeScene } from "./OfficeScene";
import { buildOfficeGroups } from "./officeStatus";

export function OfficeScreen() {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const tabActivity = use(NativeWorkspaceTabActivityContext);
  const headerOnly = tabActivity?.headerOnly === true;
  const selectDetail = useSelectWorkspaceDetail();
  const environments = useWorkspaceEnvironments();
  const threads = useAtomValue(steadyNavigationThreadShellsAtom);
  const projects = useProjects();
  const groups = buildOfficeGroups(environments, threads);
  // The 3D scene ships only in the Android APK; elsewhere, or if it fails to load, the rooms stay.
  const [sceneFailed, setSceneFailed] = useState(false);
  const openThread = (target: { environmentId: string; threadId: string }) =>
    selectDetail({ name: "Thread", params: target });

  return (
    <SettingsScreen title={gt("Office")} workspaceRoot>
      {headerOnly ? null : Platform.OS === "android" && !sceneFailed ? (
        <OfficeScene
          environments={environments}
          threads={threads}
          projects={projects}
          offlineLabel={gt("No connection")}
          visible={tabActivity?.active ?? true}
          onOpenThread={openThread}
          onFailed={() => setSceneFailed(true)}
        />
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
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
