import { GLView } from "expo-gl";
import { useGT } from "gt-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { clearOfficeLog, logOfficeStep, OFFICE_STABLE_MARK } from "./officeLog";
import { createOfficeEngine, type OfficeAgent, type OfficeEngine } from "./officeEngine";

// Enough for walking and typing; the GPU and JS thread stay mostly idle.
const FRAME_INTERVAL_MS = 1000 / 30;
const ASPECT = 0.78;

export function OfficeScene(props: {
  readonly agents: readonly OfficeAgent[];
  readonly active: boolean;
  readonly onOpenAgent: (id: string) => void;
}) {
  const gt = useGT();
  const [width, setWidth] = useState(0);
  const [engine, setEngine] = useState<OfficeEngine | null>(null);
  // GL callbacks run outside render; rethrowing here hands their errors to the error boundary.
  const [failure, setFailure] = useState<{ readonly error: unknown } | null>(null);
  const height = Math.round(width * ASPECT);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the start of a 3D session for crash diagnosis
  useEffect(() => {
    clearOfficeLog();
    logOfficeStep("scene mounted");
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes thread state into the GL scene
  useEffect(() => {
    engine?.setAgents(props.agents);
  }, [engine, props.agents]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the render loop only while the tab is visible
  useEffect(() => {
    if (!engine || !props.active) return;
    let handle = 0;
    let last = 0;
    let frames = 0;
    const tick = (now: number) => {
      handle = requestAnimationFrame(tick);
      if (last !== 0 && now - last < FRAME_INTERVAL_MS) return;
      try {
        engine.frame(last === 0 ? 0 : Math.min(0.1, (now - last) / 1000));
      } catch (error) {
        cancelAnimationFrame(handle);
        logOfficeStep(`frame error: ${String(error).slice(0, 200)}`);
        setFailure({ error });
        return;
      }
      last = now;
      frames += 1;
      if (frames === 1 || frames === 5) logOfficeStep(`frame ${frames}`);
      if (frames === 30) logOfficeStep(OFFICE_STABLE_MARK);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [engine, props.active]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases GL resources with the view
  useEffect(() => () => engine?.dispose(), [engine]);

  if (failure) throw failure.error;

  return (
    <View
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      style={{ borderRadius: 20, overflow: "hidden", backgroundColor: "#1b1f27" }}
    >
      {width === 0 ? null : (
        <Pressable
          accessibilityRole="image"
          accessibilityLabel={gt("Office with {count} agents", { count: props.agents.length })}
          onPress={(event) => {
            const id = engine?.pick(
              event.nativeEvent.locationX,
              event.nativeEvent.locationY,
              width,
              height,
            );
            if (id) props.onOpenAgent(id);
          }}
        >
          <GLView
            style={{ width, height }}
            onContextCreate={(gl) => {
              try {
                logOfficeStep(`gl context ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`);
                setEngine(createOfficeEngine(gl));
                logOfficeStep("engine ready");
              } catch (error) {
                logOfficeStep(`engine error: ${String(error).slice(0, 200)}`);
                setFailure({ error });
              }
            }}
          />
        </Pressable>
      )}
    </View>
  );
}
