import { useAtomValue } from "@effect/atom-react";
import { useGT, useMessages } from "gt-react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusPill, type StatusTone } from "../../components/StatusPill";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { steadyNavigationThreadShellsAtom } from "../../state/threads";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { connectionTone } from "../connection/connectionTone";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { buildOfficeGroups, type OfficeStatus } from "./officeStatus";

export function SettingsOfficeRouteScreen() {
  const gt = useGT();
  const m = useMessages();
  const insets = useSafeAreaInsets();
  const selectDetail = useSelectWorkspaceDetail();
  const environments = useWorkspaceEnvironments();
  const threads = useAtomValue(steadyNavigationThreadShellsAtom);
  const groups = useMemo(() => buildOfficeGroups(environments, threads), [environments, threads]);

  const statusTone = (status: OfficeStatus): StatusTone => {
    switch (status) {
      case "working":
        return {
          label: gt("Working", { $context: "agent status" }),
          pillClassName: "bg-adaptive-emerald-500-a12-a16",
          textClassName: "text-adaptive-emerald-700-300",
        };
      case "waiting":
        return {
          label: gt("Waiting for you"),
          pillClassName: "bg-warning",
          textClassName: "text-warning-foreground",
        };
      case "disconnected":
        return {
          label: gt("Disconnected"),
          pillClassName: "bg-danger",
          textClassName: "text-danger-foreground",
        };
      case "idle":
        return {
          label: gt("Idle"),
          pillClassName: "bg-subtle",
          textClassName: "text-foreground-secondary",
        };
    }
  };

  return (
    <SettingsScreen title={gt("Office")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {groups.map((group) => (
          <View key={group.environmentId} className="gap-2">
            <View className="flex-row items-center justify-between gap-3 px-1">
              <Text className="min-w-0 shrink font-t3-bold text-foreground" numberOfLines={1}>
                {group.label}
              </Text>
              <StatusPill {...connectionTone(group.connectionState, undefined, m)} size="compact" />
            </View>
            {group.rows.length === 0 ? (
              <Text textRole="footnote" className="px-1 text-foreground-muted">
                {gt("No threads")}
              </Text>
            ) : (
              group.rows.map(({ thread, status }) => (
                <Pressable
                  key={thread.id}
                  accessibilityRole="button"
                  onPress={() =>
                    selectDetail({
                      name: "Thread",
                      params: {
                        environmentId: String(thread.environmentId),
                        threadId: String(thread.id),
                      },
                    })
                  }
                  className="flex-row items-center justify-between gap-3 rounded-2xl bg-subtle px-4 py-3"
                >
                  <Text className="min-w-0 flex-1 text-foreground" numberOfLines={1}>
                    {thread.title}
                  </Text>
                  <StatusPill {...statusTone(status)} size="compact" />
                </Pressable>
              ))
            )}
          </View>
        ))}
      </ScrollView>
    </SettingsScreen>
  );
}
