import { useGT } from "gt-react-native";
import { memo, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { G, Polygon } from "react-native-svg";

import { clearOfficeLog, logOfficeStep, OFFICE_STABLE_MARK } from "./officeLog";
import { createOfficeRenderer, type Item } from "./officeRender";
import { createOfficeSim, type OfficeAgent } from "./officeSim";

// Enough for walking and typing; keeps the JS thread mostly idle.
const FRAME_INTERVAL_MS = 1000 / 24;

const ItemView = memo(function ItemView(props: { readonly polys: Item["polys"] }) {
  return (
    <G>
      {props.polys.map((poly) => (
        <Polygon
          key={`${poly.points}|${poly.fill}`}
          points={poly.points}
          fill={poly.fill}
          fillOpacity={poly.opacity}
        />
      ))}
    </G>
  );
});

export function OfficeScene(props: {
  readonly agents: readonly OfficeAgent[];
  readonly active: boolean;
  readonly onOpenAgent: (id: string) => void;
}) {
  const gt = useGT();
  const [width, setWidth] = useState(0);
  const [sim] = useState(createOfficeSim);
  const [items, setItems] = useState<readonly Item[]>([]);
  const renderer = useMemo(() => (width > 0 ? createOfficeRenderer(width) : null), [width]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the start of a session for crash diagnosis
  useEffect(() => {
    clearOfficeLog();
    logOfficeStep("scene mounted");
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes thread state into the simulation
  useEffect(() => {
    sim.setAgents(props.agents);
  }, [sim, props.agents]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the animation loop only while the tab is visible
  useEffect(() => {
    if (!renderer || !props.active) return;
    let handle = 0;
    let last = 0;
    let frames = 0;
    let drawn = false;
    const tick = (now: number) => {
      handle = requestAnimationFrame(tick);
      if (last !== 0 && now - last < FRAME_INTERVAL_MS) return;
      const animating = sim.step(last === 0 ? 0 : Math.min(0.1, (now - last) / 1000));
      last = now;
      if (!animating && drawn) return;
      drawn = true;
      setItems(renderer.frame(sim));
      frames += 1;
      if (frames === 1) logOfficeStep("first frame");
      if (frames === 30) logOfficeStep(OFFICE_STABLE_MARK);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [renderer, sim, props.active]);

  return (
    <View
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      style={{ borderRadius: 20, overflow: "hidden", backgroundColor: "#1b1f27" }}
    >
      {renderer ? (
        <Pressable
          accessibilityRole="image"
          accessibilityLabel={gt("Office with {count} agents", { count: props.agents.length })}
          onPress={(event) => {
            const id = renderer.pick(sim, event.nativeEvent.locationX, event.nativeEvent.locationY);
            if (id) props.onOpenAgent(id);
          }}
        >
          <Svg width={width} height={renderer.height}>
            {items.map((item) => (
              <ItemView key={item.id} polys={item.polys} />
            ))}
          </Svg>
        </Pressable>
      ) : null}
    </View>
  );
}
