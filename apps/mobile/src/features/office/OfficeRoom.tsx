import { useGT, useMessages } from "gt-react-native";
import { Pressable, View } from "react-native";

import { StatusPill } from "../../components/StatusPill";
import { AppText as Text } from "../../components/ui/AppText";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { cn } from "../../lib/cn";
import { connectionTone } from "../connection/connectionTone";
import type { buildOfficeGroups } from "./officeStatus";
import { agentColors } from "./officeWorld";

type OfficeGroup = ReturnType<typeof buildOfficeGroups>[number];

/** One environment's agents, listed under the 3D office; the dot matches the agent's shirt. */
export function OfficeRoom(props: {
  readonly group: OfficeGroup;
  readonly onOpenThread: (row: OfficeGroup["rows"][number]) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { colors } = useControlTheme();
  const { group } = props;
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-3 px-1">
        <Text className="min-w-0 shrink font-t3-bold text-foreground" numberOfLines={1}>
          {group.label}
        </Text>
        <StatusPill {...connectionTone(group.connectionState, undefined, m)} size="compact" />
      </View>
      <View
        style={{
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors["--color-border"],
          backgroundColor: colors["--color-card"],
          opacity: group.connectionState === "connected" ? 1 : 0.6,
        }}
      >
        {group.rows.length === 0 ? (
          <Text textRole="caption" className="p-3 text-center text-foreground-muted">
            {gt("No threads")}
          </Text>
        ) : (
          group.rows.map((row) => {
            const label =
              row.status === "working"
                ? gt("Working", { $context: "agent status" })
                : row.status === "waiting"
                  ? gt("Waiting for you")
                  : row.status === "disconnected"
                    ? gt("Disconnected")
                    : gt("Idle");
            return (
              <Pressable
                key={row.thread.id}
                accessibilityRole="button"
                accessibilityLabel={gt("{title}, {status}", {
                  title: row.thread.title,
                  status: label,
                })}
                onPress={() => props.onOpenThread(row)}
                className="flex-row items-center gap-3 px-3 py-2.5"
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: agentColors(row.thread.id).shirt,
                  }}
                />
                <Text className="min-w-0 flex-1 text-foreground" numberOfLines={1}>
                  {row.thread.title}
                </Text>
                <Text
                  textRole="caption"
                  className={cn(
                    row.status === "working" && "font-t3-bold text-adaptive-emerald-700-300",
                    row.status === "waiting" && "font-t3-bold text-warning-foreground",
                    (row.status === "idle" || row.status === "disconnected") &&
                      "text-foreground-muted",
                  )}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}
