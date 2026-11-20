import { useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { StatusPill } from "../../components/StatusPill";
import { AppText as Text } from "../../components/ui/AppText";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { connectionTone } from "../connection/connectionTone";
import { OfficeDesk, OfficeSprite } from "./OfficeDesk";
import type { buildOfficeGroups } from "./officeStatus";

const MAX_DESKS = 12;
const MIN_DESK_WIDTH = 88;
const GAP = 8;
const ROOM_PADDING = 12;

type OfficeGroup = ReturnType<typeof buildOfficeGroups>[number];

export function OfficeRoom(props: {
  readonly group: OfficeGroup;
  readonly animate: boolean;
  readonly onOpenThread: (row: OfficeGroup["rows"][number]) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { colors } = useControlTheme();
  const [width, setWidth] = useState(0);
  const { group } = props;
  const inner = width - 2 * ROOM_PADDING;
  const columns = Math.max(1, Math.floor((inner + GAP) / (MIN_DESK_WIDTH + GAP)));
  const deskWidth = Math.floor((inner - GAP * (columns - 1)) / columns);
  const shown = group.rows.slice(0, MAX_DESKS);
  const hidden = group.rows.length - shown.length;
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-3 px-1">
        <Text className="min-w-0 shrink font-t3-bold text-foreground" numberOfLines={1}>
          {group.label}
        </Text>
        <StatusPill {...connectionTone(group.connectionState, undefined, m)} size="compact" />
      </View>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{
          padding: ROOM_PADDING,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors["--color-border"],
          backgroundColor: colors["--color-card"],
          opacity: group.connectionState === "connected" ? 1 : 0.6,
        }}
      >
        {width === 0 ? null : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
            {group.rows.length === 0 ? (
              <View style={{ width: deskWidth, alignItems: "center", opacity: 0.6 }}>
                <OfficeSprite kind="empty" threadId="" deskWidth={deskWidth} />
                <Text textRole="caption" className="text-foreground-muted">
                  {gt("No threads")}
                </Text>
              </View>
            ) : (
              shown.map((row) => (
                <OfficeDesk
                  key={row.thread.id}
                  threadId={row.thread.id}
                  title={row.thread.title}
                  status={row.status}
                  width={deskWidth}
                  animate={props.animate}
                  onPress={() => props.onOpenThread(row)}
                />
              ))
            )}
          </View>
        )}
        {hidden > 0 ? (
          <Text textRole="caption" className="pt-2 text-center text-foreground-muted">
            {gt("+{count} more", { count: hidden })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
