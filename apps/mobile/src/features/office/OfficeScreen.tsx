import { useAtomValue } from "@effect/atom-react";
import { useGT } from "gt-react-native";
import { use } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";
import { steadyNavigationThreadShellsAtom } from "../../state/threads";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { OfficeRoom } from "./OfficeRoom";
import { buildOfficeGroups } from "./officeStatus";

export function OfficeScreen() {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const tabActivity = use(NativeWorkspaceTabActivityContext);
  const headerOnly = tabActivity?.headerOnly === true;
  const selectDetail = useSelectWorkspaceDetail();
  const environments = useWorkspaceEnvironments();
  const threads = useAtomValue(steadyNavigationThreadShellsAtom);
  const groups = buildOfficeGroups(environments, threads);
  const openThread = (target: { environmentId: string; threadId: string }) =>
    selectDetail({ name: "Thread", params: target });

  return (
    <SettingsScreen title={gt("Office")} workspaceRoot>
      {headerOnly ? null : (
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
              animate={tabActivity?.active ?? true}
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
