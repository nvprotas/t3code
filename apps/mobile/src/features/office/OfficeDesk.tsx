import { useGT } from "gt-react-native";
import { Pressable } from "react-native";
import { Rect, Svg } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { cn } from "../../lib/cn";
import type { OfficeStatus } from "./officeStatus";
import { OFFICE_SPRITE_HEIGHT, OFFICE_SPRITE_WIDTH, officePalette, officeSprite } from "./sprites";

// Padding plus the waiting border, which every desk reserves so none shifts.
const DESK_PADDING = 4;
const DESK_BORDER = 2;

/** The largest whole pixel size whose sprite fits a desk this wide, so edges land on pixels. */
function cellSize(deskWidth: number) {
  const inner = deskWidth - 2 * (DESK_PADDING + DESK_BORDER);
  return Math.max(1, Math.floor(inner / OFFICE_SPRITE_WIDTH));
}

export function OfficeSprite(props: {
  readonly kind: OfficeStatus | "empty";
  readonly threadId: string;
  readonly deskWidth: number;
}) {
  const cell = cellSize(props.deskWidth);
  const palette = officePalette(props.kind, props.threadId);
  return (
    <Svg
      width={OFFICE_SPRITE_WIDTH * cell}
      height={OFFICE_SPRITE_HEIGHT * cell}
      viewBox={`0 0 ${OFFICE_SPRITE_WIDTH} ${OFFICE_SPRITE_HEIGHT}`}
      accessible={false}
    >
      {officeSprite(props.kind).map((rect) => (
        <Rect
          key={`${rect.x}:${rect.y}`}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill={palette[rect.glyph]}
        />
      ))}
    </Svg>
  );
}

export function OfficeDesk(props: {
  readonly threadId: string;
  readonly title: string;
  readonly status: OfficeStatus;
  readonly width: number;
  readonly onPress: () => void;
}) {
  const gt = useGT();
  const { colors } = useControlTheme();
  const waiting = props.status === "waiting";
  const label =
    props.status === "working"
      ? gt("Working", { $context: "agent status" })
      : waiting
        ? gt("Waiting for you")
        : props.status === "disconnected"
          ? gt("Disconnected")
          : gt("Idle");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt("{title}, {status}", { title: props.title, status: label })}
      onPress={props.onPress}
      style={{
        width: props.width,
        padding: DESK_PADDING,
        borderRadius: 12,
        borderWidth: DESK_BORDER,
        borderColor: waiting ? colors["--color-warning-foreground"] : "transparent",
        backgroundColor: waiting ? colors["--color-warning"] : colors["--color-screen"],
        alignItems: "center",
        gap: 2,
      }}
    >
      <OfficeSprite kind={props.status} threadId={props.threadId} deskWidth={props.width} />
      <Text textRole="caption" className="w-full text-center text-foreground" numberOfLines={1}>
        {props.title}
      </Text>
      <Text
        textRole="caption"
        className={cn(
          "w-full text-center",
          props.status === "working" && "font-t3-bold text-adaptive-emerald-700-300",
          waiting && "font-t3-bold text-warning-foreground",
          (props.status === "idle" || props.status === "disconnected") && "text-foreground-muted",
        )}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}
