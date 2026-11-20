import { useGT } from "gt-react-native";
import { memo, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { G, Polygon, Rect, Text as SvgText } from "react-native-svg";

import { clearOfficeLog, logOfficeStep, OFFICE_STABLE_MARK } from "./officeLog";
import { createOfficeRenderer, type Item, type OfficeFrame } from "./officeRender";
import { createOfficeSim, type OfficeAgent } from "./officeSim";

// Enough for walking and typing; keeps the JS thread mostly idle.
const FRAME_INTERVAL_MS = 1000 / 20;
const MAX_ZOOM = 3.5;
const LABEL_FONT = 10;
const LABEL_MAX_CHARS = 16;

interface View2D {
  readonly k: number;
  readonly tx: number;
  readonly ty: number;
}

const FIT: View2D = { k: 1, tx: 0, ty: 0 };

/** Keeps the zoomed picture covering the frame. */
function clampView(view: View2D, width: number, height: number): View2D {
  const k = Math.min(MAX_ZOOM, Math.max(1, view.k));
  return {
    k,
    tx: Math.min(0, Math.max(width - width * k, view.tx)),
    ty: Math.min(0, Math.max(height - height * k, view.ty)),
  };
}

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

const LabelView = memo(function LabelView(props: {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly selected: boolean;
}) {
  const text =
    props.text.length > LABEL_MAX_CHARS
      ? `${props.text.slice(0, LABEL_MAX_CHARS - 1)}…`
      : props.text;
  const w = text.length * LABEL_FONT * 0.56 + 10;
  return (
    <G>
      <Rect
        x={props.x - w / 2}
        y={props.y - LABEL_FONT - 4}
        width={w}
        height={LABEL_FONT + 7}
        rx={6}
        fill={props.selected ? "#facc15" : "#000000"}
        fillOpacity={props.selected ? 1 : 0.6}
      />
      <SvgText
        x={props.x}
        y={props.y - 3}
        fontSize={LABEL_FONT}
        fontWeight="600"
        fill={props.selected ? "#1f2937" : "#ffffff"}
        textAnchor="middle"
      >
        {text}
      </SvgText>
    </G>
  );
});

export function OfficeScene(props: {
  readonly agents: readonly OfficeAgent[];
  readonly active: boolean;
  readonly selectedId: string | undefined;
  readonly onSelectAgent: (id: string | undefined) => void;
  readonly onLockScroll: (locked: boolean) => void;
}) {
  const gt = useGT();
  const [width, setWidth] = useState(0);
  const [sim] = useState(createOfficeSim);
  const [frame, setFrame] = useState<OfficeFrame>({ items: [], labels: [] });
  const [view, setView] = useState(FIT);
  const viewRef = useRef(FIT);
  const gestureBase = useRef(FIT);
  const renderer = useMemo(() => (width > 0 ? createOfficeRenderer(width) : null), [width]);
  const height = renderer?.height ?? 0;
  const zoomed = view.k > 1.001;

  const commit = useEffectEvent((next: View2D) => {
    const clamped = clampView(next, width, height);
    viewRef.current = clamped;
    setView(clamped);
    props.onLockScroll(clamped.k > 1.001);
  });
  const beginGesture = useEffectEvent(() => {
    gestureBase.current = viewRef.current;
    props.onLockScroll(true);
  });
  const endGesture = useEffectEvent(() => props.onLockScroll(viewRef.current.k > 1.001));
  const pinch = useEffectEvent((scale: number, focalX: number, focalY: number) => {
    const base = gestureBase.current;
    const k = Math.min(MAX_ZOOM, Math.max(1, base.k * scale));
    commit({
      k,
      tx: focalX - (focalX - base.tx) * (k / base.k),
      ty: focalY - (focalY - base.ty) * (k / base.k),
    });
  });
  const pan = useEffectEvent((dx: number, dy: number) => {
    const base = gestureBase.current;
    commit({ k: base.k, tx: base.tx + dx, ty: base.ty + dy });
  });
  const reset = useEffectEvent(() => commit(FIT));

  // oxlint-disable-next-line react/capitalized-calls -- gesture factory, not a component
  const gesture = Gesture.Simultaneous(
    // oxlint-disable-next-line react/capitalized-calls -- gesture factory, not a component
    Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => beginGesture())
      .onUpdate((event) => pinch(event.scale, event.focalX, event.focalY))
      .onFinalize(() => endGesture()),
    // oxlint-disable-next-line react/capitalized-calls -- gesture factory, not a component
    Gesture.Pan()
      .enabled(zoomed)
      .maxPointers(1)
      .runOnJS(true)
      .onStart(() => beginGesture())
      .onUpdate((event) => pan(event.translationX, event.translationY))
      .onFinalize(() => endGesture()),
    // oxlint-disable-next-line react/capitalized-calls -- gesture factory, not a component
    Gesture.Tap()
      .numberOfTaps(2)
      .runOnJS(true)
      .onEnd(() => reset()),
  );

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
    const tick = (now: number) => {
      handle = requestAnimationFrame(tick);
      if (last !== 0 && now - last < FRAME_INTERVAL_MS) return;
      sim.step(last === 0 ? 0 : Math.min(0.1, (now - last) / 1000));
      last = now;
      const next = renderer.frame(sim, props.selectedId);
      if (!next) return;
      setFrame(next);
      frames += 1;
      if (frames === 1) logOfficeStep("first frame");
      if (frames === 30) logOfficeStep(OFFICE_STABLE_MARK);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [renderer, sim, props.active, props.selectedId]);

  return (
    <View
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      style={{ borderRadius: 20, overflow: "hidden", backgroundColor: "#1b1f27" }}
    >
      {renderer ? (
        <GestureDetector gesture={gesture}>
          <Pressable
            accessibilityRole="image"
            accessibilityLabel={gt("Office with {count} agents", { count: props.agents.length })}
            onPress={(event) => {
              const x = (event.nativeEvent.locationX - view.tx) / view.k;
              const y = (event.nativeEvent.locationY - view.ty) / view.k;
              props.onSelectAgent(renderer.pick(sim, x, y));
            }}
          >
            <Svg width={width} height={height}>
              <G transform={[view.k, 0, 0, view.k, view.tx, view.ty]}>
                {frame.items.map((item) => (
                  <ItemView key={item.id} polys={item.polys} />
                ))}
              </G>
              {frame.labels.map((label) => (
                <LabelView
                  key={label.id}
                  text={label.text}
                  x={Math.round(label.x * view.k + view.tx)}
                  y={Math.round(label.y * view.k + view.ty)}
                  selected={label.selected}
                />
              ))}
            </Svg>
          </Pressable>
        </GestureDetector>
      ) : null}
    </View>
  );
}
