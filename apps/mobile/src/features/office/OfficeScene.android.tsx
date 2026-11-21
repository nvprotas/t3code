import { requireNativeView } from "expo";
import { useGT } from "gt-react-native";
import { useEffect, useState } from "react";
import { useWindowDimensions, View, type NativeSyntheticEvent, type ViewProps } from "react-native";

import { clearOfficeLog, logOfficeStep, OFFICE_STABLE_MARK } from "./officeLog";
import type { OfficeAgent } from "./officeSim";

// Tall enough to see the room up close, short enough that the thread list still peeks out below.
const MAX_ASPECT = 1.4;
const MAX_SCREEN_SHARE = 0.62;

interface NativeOfficeProps extends ViewProps {
  readonly agentsJson: string;
  readonly selectedId: string;
  readonly active: boolean;
  readonly focusRequest: string;
  readonly onSelectAgent: (event: NativeSyntheticEvent<{ readonly id: string }>) => void;
  readonly onRendered: () => void;
}

const NativeOffice = requireNativeView<NativeOfficeProps>("T3Office");

/** The office drawn natively on an Android canvas; simulation, zoom and pan run off the JS thread. */
export function OfficeScene(props: {
  readonly agents: readonly OfficeAgent[];
  readonly active: boolean;
  readonly selectedId: string | undefined;
  readonly onSelectAgent: (id: string | undefined) => void;
  readonly onLockScroll: (locked: boolean) => void;
  readonly focusRequest?: string;
}) {
  const gt = useGT();
  const [width, setWidth] = useState(0);
  const screen = useWindowDimensions();
  const height = Math.round(Math.min(width * MAX_ASPECT, screen.height * MAX_SCREEN_SHARE));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the start of a session for crash diagnosis
  useEffect(() => {
    clearOfficeLog();
    logOfficeStep("native scene mounted");
  }, []);

  return (
    <View
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      style={{ borderRadius: 20, overflow: "hidden", backgroundColor: "#1b1f27" }}
    >
      {width === 0 ? null : (
        <NativeOffice
          accessibilityRole="image"
          accessibilityLabel={gt("Office with {count} agents", { count: props.agents.length })}
          style={{ width, height }}
          agentsJson={JSON.stringify(props.agents)}
          selectedId={props.selectedId ?? ""}
          active={props.active}
          focusRequest={props.focusRequest ?? ""}
          onSelectAgent={(event) => props.onSelectAgent(event.nativeEvent.id || undefined)}
          onRendered={() => logOfficeStep(OFFICE_STABLE_MARK)}
        />
      )}
    </View>
  );
}
