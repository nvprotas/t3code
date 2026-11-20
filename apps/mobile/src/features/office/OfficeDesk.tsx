import { useGT } from "gt-react-native";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
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

/** Alternates two typing frames on the UI thread; stops while the tab is hidden. */
function TypingFrame(props: { readonly children: React.ReactNode; readonly animate: boolean }) {
  const phase = useSharedValue(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts and stops a UI-thread animation with tab visibility
  useEffect(() => {
    if (!props.animate) {
      cancelAnimation(phase);
      phase.value = 0;
      return;
    }
    phase.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(phase);
  }, [props.animate, phase]);
  const style = useAnimatedStyle(() => ({ opacity: phase.value >= 0.5 ? 1 : 0 }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, left: 0 }, style]}>
      {props.children}
    </Animated.View>
  );
}

export function OfficeSprite(props: {
  readonly kind: OfficeStatus | "empty";
  readonly threadId: string;
  readonly deskWidth: number;
  readonly animate?: boolean;
}) {
  if (props.kind === "working") {
    return (
      <View>
        <SpriteSvg {...props} kind="working" />
        <TypingFrame animate={props.animate === true}>
          <SpriteSvg {...props} kind="typing" />
        </TypingFrame>
      </View>
    );
  }
  return <SpriteSvg {...props} />;
}

function SpriteSvg(props: {
  readonly kind: OfficeStatus | "empty" | "typing";
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
  readonly animate: boolean;
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
      <OfficeSprite
        kind={props.status}
        threadId={props.threadId}
        deskWidth={props.width}
        animate={props.animate}
      />
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
