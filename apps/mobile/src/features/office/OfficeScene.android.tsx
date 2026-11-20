import { requireNativeView } from "expo";
import { useGT } from "gt-react-native";
import { useEffect, useState } from "react";
import { View, type NativeSyntheticEvent, type ViewProps } from "react-native";

import { clearOfficeLog, logOfficeStep, OFFICE_STABLE_MARK } from "./officeLog";
import type { OfficeAgent } from "./officeSim";

const ASPECT = 0.85;

interface NativeOfficeProps extends ViewProps {
  readonly agentsJson: string;
  readonly selectedId: string;
  readonly active: boolean;
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
}) {
  const gt = useGT();
  const [width, setWidth] = useState(0);

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
          style={{ width, height: Math.round(width * ASPECT) }}
          agentsJson={JSON.stringify(props.agents)}
          selectedId={props.selectedId ?? ""}
          active={props.active}
          onSelectAgent={(event) => props.onSelectAgent(event.nativeEvent.id || undefined)}
          onRendered={() => logOfficeStep(OFFICE_STABLE_MARK)}
        />
      )}
    </View>
  );
}
