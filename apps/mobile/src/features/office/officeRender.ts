import { deskScreen, furniture, backdropParts, type Part } from "./officeScenery";
import type { OfficeSim, Pose, Walker } from "./officeSim";
import type { OfficeStatus } from "./officeStatus";
import { agentColors } from "./officeWorld";

type Vec = readonly [number, number, number];

export interface Poly {
  readonly points: string;
  readonly fill: string;
  readonly opacity?: number;
}

/** A name tag in unscaled view coordinates; the scene keeps tags the same size while zoomed. */
export interface Label {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly selected: boolean;
}

export interface OfficeFrame {
  readonly items: readonly Item[];
  readonly labels: readonly Label[];
}

/** One drawable block; blocks are painted far to near. */
export interface Item {
  readonly id: string;
  readonly depth: number;
  readonly polys: readonly Poly[];
}

export const ASPECT = 0.78;
const HALF_WIDTH = 8.9;
const SKIN = "#f1c9a5";
const OFFLINE = "#6b7280";
const TARGET: Vec = [0, 0.6, 0.5];
const EYE: Vec = [11, 12, 13];

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec): Vec => {
  const length = Math.hypot(...a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

const TO_CAMERA = normalize(EYE);
const RIGHT = normalize(cross([-EYE[0], -EYE[1], -EYE[2]], [0, 1, 0]));
const UP = cross(RIGHT, [-TO_CAMERA[0], -TO_CAMERA[1], -TO_CAMERA[2]]);
const LIGHT = normalize([-4, 10, 6]);

// Corner order is (x, y, z) bits; each face is wound so its normal points outward.
const FACES = [
  [1, 3, 7, 5],
  [0, 4, 6, 2],
  [2, 6, 7, 3],
  [4, 5, 7, 6],
  [1, 0, 2, 3],
] as const;

const rgbCache = new Map<string, readonly [number, number, number]>();
function rgb(hex: string) {
  let value = rgbCache.get(hex);
  if (!value) {
    const n = Number.parseInt(hex.slice(1), 16);
    value = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, value);
  }
  return value;
}

function mix(hex: string, other: string, amount: number) {
  const a = rgb(hex);
  const b = rgb(other);
  const channel = (index: 0 | 1 | 2) => Math.round(a[index] + (b[index] - a[index]) * amount);
  return `#${((1 << 24) | (channel(0) << 16) | (channel(1) << 8) | channel(2)).toString(16).slice(1)}`;
}

function shade(hex: string, normal: Vec) {
  const factor = 0.55 + 0.5 * Math.max(0, dot(normal, LIGHT));
  const [r, g, b] = rgb(hex);
  return `rgb(${Math.min(255, Math.round(r * factor))},${Math.min(255, Math.round(g * factor))},${Math.min(255, Math.round(b * factor))})`;
}

export interface OfficeRenderer {
  readonly height: number;
  frame(sim: OfficeSim, selectedId: string | undefined): OfficeFrame | null;
  pick(sim: OfficeSim, x: number, y: number): string | undefined;
}

export function createOfficeRenderer(width: number): OfficeRenderer {
  const height = Math.round(width * ASPECT);
  const scale = width / (2 * HALF_WIDTH);
  const project = (p: Vec) => {
    const d = sub(p, TARGET);
    return [width / 2 + dot(d, RIGHT) * scale, height / 2 - dot(d, UP) * scale] as const;
  };

  function boxPolys(part: Part, transform?: (p: Vec) => Vec): Poly[] {
    const [w, h, d] = part.size;
    const corners: Vec[] = [];
    for (let i = 0; i < 8; i++) {
      const local: Vec = [
        part.at[0] + (i & 1 ? w : -w) / 2,
        part.at[1] + (i & 2 ? h : -h) / 2,
        part.at[2] + (i & 4 ? d : -d) / 2,
      ];
      corners.push(transform ? transform(local) : local);
    }
    const polys: Poly[] = [];
    for (const face of FACES) {
      const [a, b, c, e] = face.map((index) => corners[index]!) as [Vec, Vec, Vec, Vec];
      const normal = normalize(cross(sub(b, a), sub(c, a)));
      if (dot(normal, TO_CAMERA) <= 0.001) continue;
      const points = [a, b, c, e]
        .map((corner) => {
          const [px, py] = project(corner);
          return `${px.toFixed(1)},${py.toFixed(1)}`;
        })
        .join(" ");
      polys.push({ points, fill: part.flat ? part.color : shade(part.color, normal) });
    }
    return polys;
  }

  const backdrop: Item = {
    id: "backdrop",
    depth: -Infinity,
    polys: backdropParts().flatMap((part) => boxPolys(part)),
  };
  const staticItems = furniture().map((piece) => ({
    id: piece.id,
    depth: dot(piece.anchor, TO_CAMERA),
    polys: piece.parts.flatMap((part) => boxPolys(part)),
  }));
  const screenCache = new Map<string, readonly Poly[]>();
  const deskItems = new Map<string, Item>();

  function deskItem(index: number, status: OfficeStatus | "empty"): Item {
    const key = `${index}:${status}`;
    let item = deskItems.get(key);
    if (!item) {
      const base = staticItems.find((candidate) => candidate.id === `desk-${index}`)!;
      let screen = screenCache.get(key);
      if (!screen) {
        screen = boxPolys(deskScreen(index, status));
        screenCache.set(key, screen);
      }
      item = { ...base, polys: [...base.polys, ...screen] };
      deskItems.set(key, item);
    }
    return item;
  }

  function walkerItem(walker: Walker, pose: Pose, selected: boolean): Item {
    const { hair, shirt } = agentColors(walker.id);
    const offline = walker.status === "disconnected";
    const tint = (color: string) => (offline ? mix(color, OFFLINE, 0.65) : color);
    const cosHeading = Math.cos(walker.heading);
    const sinHeading = Math.sin(walker.heading);
    const cosTilt = Math.cos(pose.tilt);
    const sinTilt = Math.sin(pose.tilt);
    const place = (p: Vec): Vec => {
      const y = p[1] * cosTilt - p[2] * sinTilt + pose.bob;
      const z = p[1] * sinTilt + p[2] * cosTilt;
      return [
        p[0] * cosHeading + z * sinHeading + walker.px,
        y,
        -p[0] * sinHeading + z * cosHeading + walker.pz,
      ];
    };
    const swing = (pivotY: number, angle: number) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return (p: Vec): Vec => {
        const y = p[1] - pivotY;
        return place([p[0], pivotY + y * cos - p[2] * sin, y * sin + p[2] * cos]);
      };
    };
    const blocks: { part: Part; transform: (p: Vec) => Vec }[] = [
      {
        part: { size: [0.42, 0.45, 0.25], at: [0, 0.675, 0], color: tint(shirt) },
        transform: place,
      },
      { part: { size: [0.3, 0.3, 0.3], at: [0, 1.06, 0], color: tint(SKIN) }, transform: place },
      {
        part: { size: [0.32, 0.09, 0.32], at: [0, 1.235, 0], color: tint(hair) },
        transform: place,
      },
      {
        part: { size: [0.32, 0.2, 0.08], at: [0, 1.12, -0.13], color: tint(hair) },
        transform: place,
      },
      {
        part: { size: [0.05, 0.05, 0.02], at: [-0.07, 1.08, 0.151], color: "#1f2937" },
        transform: place,
      },
      {
        part: { size: [0.05, 0.05, 0.02], at: [0.07, 1.08, 0.151], color: "#1f2937" },
        transform: place,
      },
    ];
    const legs = [
      [-0.1, pose.legLeft],
      [0.1, pose.legRight],
    ] as const;
    for (const [x, angle] of legs) {
      blocks.push({
        part: { size: [0.14, 0.45, 0.14], at: [x, 0.225, 0], color: tint("#334155") },
        transform: swing(0.45, angle),
      });
    }
    const arms = [
      [-0.27, pose.armLeft],
      [0.27, pose.armRight],
    ] as const;
    for (const [x, angle] of arms) {
      const move = swing(0.88, angle);
      blocks.push(
        { part: { size: [0.1, 0.3, 0.1], at: [x, 0.73, 0], color: tint(shirt) }, transform: move },
        { part: { size: [0.09, 0.1, 0.09], at: [x, 0.53, 0], color: tint(SKIN) }, transform: move },
      );
    }
    const polys: Poly[] = [];
    const shadow: Vec[] = Array.from({ length: 12 }, (_, i) => [
      walker.px + Math.cos((i / 12) * Math.PI * 2) * 0.32,
      0.012,
      walker.pz + Math.sin((i / 12) * Math.PI * 2) * 0.32,
    ]);
    polys.push({
      points: shadow
        .map((p) =>
          project(p)
            .map((v) => v.toFixed(1))
            .join(","),
        )
        .join(" "),
      fill: "#000000",
      opacity: 0.18,
    });
    if (selected) {
      const ring: Vec[] = Array.from({ length: 20 }, (_, i) => [
        walker.px + Math.cos((i / 20) * Math.PI * 2) * 0.55,
        0.014,
        walker.pz + Math.sin((i / 20) * Math.PI * 2) * 0.55,
      ]);
      polys.push({
        points: ring
          .map((p) =>
            project(p)
              .map((v) => v.toFixed(1))
              .join(","),
          )
          .join(" "),
        fill: "#facc15",
        opacity: 0.55,
      });
    }
    const ordered = blocks
      .map((block) => ({ block, depth: dot(block.transform(block.part.at), TO_CAMERA) }))
      .sort((a, b) => a.depth - b.depth);
    for (const { block } of ordered) polys.push(...boxPolys(block.part, block.transform));
    if (walker.status === "waiting") {
      const cos = Math.cos(pose.alertSpin);
      const sin = Math.sin(pose.alertSpin);
      const spin = (p: Vec): Vec =>
        place([p[0] * cos + p[2] * sin, p[1], -p[0] * sin + p[2] * cos]);
      polys.push(
        ...boxPolys(
          {
            size: [0.11, 0.26, 0.11],
            at: [0, pose.alertY + 0.06, 0],
            color: "#fbbf24",
            flat: true,
          },
          spin,
        ),
        ...boxPolys(
          { size: [0.11, 0.1, 0.11], at: [0, pose.alertY - 0.18, 0], color: "#fbbf24", flat: true },
          spin,
        ),
      );
    }
    return {
      id: `walker-${walker.id}`,
      depth: dot([walker.px, 0.3, walker.pz], TO_CAMERA),
      polys,
    };
  }

  const cache = new Map<string, { sig: string; item: Item; label: Label }>();
  let lastKey: string | undefined;

  /** The next picture, or null when nothing visible changed; unchanged agents keep their old polygons. */
  function frame(sim: OfficeSim, selectedId: string | undefined): OfficeFrame | null {
    const statuses = new Map<number, OfficeStatus>();
    const items: Item[] = [];
    const labels: Label[] = [];
    const keys: string[] = [];
    for (const walker of sim.walkers.values()) {
      statuses.set(walker.desk, walker.status);
      const pose = sim.pose(walker);
      const selected = walker.id === selectedId;
      const sig = [
        Math.round(walker.px * 60),
        Math.round(walker.pz * 60),
        Math.round(walker.heading * 30),
        walker.status,
        walker.name,
        selected,
        Math.round(pose.legLeft * 20),
        Math.round(pose.armLeft * 20),
        Math.round(pose.armRight * 20),
        Math.round(pose.bob * 100),
        Math.round(pose.tilt * 10),
        walker.status === "waiting" ? Math.round(pose.alertY * 50) : "",
        walker.status === "waiting" ? Math.round(pose.alertSpin * 10) : "",
      ].join(",");
      let entry = cache.get(walker.id);
      if (entry?.sig !== sig) {
        const [x, y] = project([walker.px, walker.status === "waiting" ? 2.15 : 1.6, walker.pz]);
        entry = {
          sig,
          item: walkerItem(walker, pose, selected),
          label: { id: walker.id, x, y, text: walker.name, selected },
        };
        cache.set(walker.id, entry);
      }
      keys.push(walker.id + sig);
      items.push(entry.item);
      labels.push(entry.label);
    }
    for (const id of cache.keys()) {
      if (!sim.walkers.has(id)) cache.delete(id);
    }
    const key = keys.join("|");
    if (key === lastKey) return null;
    lastKey = key;
    for (const item of staticItems) {
      if (!item.id.startsWith("desk-")) {
        items.push(item);
        continue;
      }
      const index = Number(item.id.slice(5));
      items.push({ ...deskItem(index, statuses.get(index) ?? "empty"), depth: item.depth });
    }
    items.sort((a, b) => a.depth - b.depth);
    return { items: [backdrop, ...items], labels };
  }

  function pick(sim: OfficeSim, x: number, y: number) {
    let best: string | undefined;
    let bestDistance = 0.11 * width;
    for (const walker of sim.walkers.values()) {
      const [px, py] = project([walker.px, 0.8, walker.pz]);
      const distance = Math.hypot(px - x, py - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = walker.id;
      }
    }
    return best;
  }

  return { height, frame, pick };
}
