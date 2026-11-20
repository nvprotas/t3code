import { deskPosition, OFFICE_DESKS, ROOM_DEPTH, ROOM_WIDTH, seatPosition } from "./officeWorld";
import type { OfficeStatus } from "./officeStatus";

export interface Part {
  readonly size: readonly [number, number, number];
  readonly at: readonly [number, number, number];
  readonly color: string;
  readonly flat?: boolean;
}

/** A piece of furniture drawn as one block; `anchor` decides whether walkers pass in front of it. */
export interface Furniture {
  readonly id: string;
  readonly anchor: readonly [number, number, number];
  readonly parts: readonly Part[];
}

export const SCREEN_COLORS: Readonly<Record<OfficeStatus | "empty", string>> = {
  working: "#5eead4",
  waiting: "#fbbf24",
  idle: "#334155",
  disconnected: "#1f2937",
  empty: "#111827",
};

const HALF_WIDTH = ROOM_WIDTH / 2;
const HALF_DEPTH = ROOM_DEPTH / 2;
const MUGS = ["#ef4444", "#3b82f6", "#f8fafc", "#10b981"] as const;

/** Floor, walls and wall decor, drawn first in this order. */
export function backdropParts(): Part[] {
  const parts: Part[] = [];
  for (let x = -HALF_WIDTH + 1; x < HALF_WIDTH; x += 2) {
    for (let z = -HALF_DEPTH + 1; z < HALF_DEPTH; z += 2) {
      const even = (x + z + ROOM_WIDTH) % 4 === 0;
      parts.push({ size: [2, 0.1, 2], at: [x, -0.05, z], color: even ? "#d9c4a0" : "#cdb48c" });
    }
  }
  parts.push(
    { size: [ROOM_WIDTH + 0.4, 3, 0.2], at: [0, 1.5, -HALF_DEPTH - 0.1], color: "#ece6da" },
    { size: [0.2, 3, ROOM_DEPTH], at: [-HALF_WIDTH - 0.1, 1.5, 0], color: "#e1d9c8" },
    { size: [ROOM_WIDTH + 0.4, 0.16, 0.05], at: [0, 0.08, -HALF_DEPTH + 0.02], color: "#8a6a4a" },
    { size: [0.05, 0.16, ROOM_DEPTH], at: [-HALF_WIDTH + 0.02, 0.08, 0], color: "#8a6a4a" },
  );
  for (const x of [-4, 0, 4]) {
    parts.push(
      { size: [2.4, 1.4, 0.06], at: [x, 1.85, -HALF_DEPTH + 0.02], color: "#f8fafc" },
      { size: [2.2, 1.2, 0.07], at: [x, 1.85, -HALF_DEPTH + 0.03], color: "#8ecdf2" },
      { size: [0.06, 1.2, 0.08], at: [x, 1.85, -HALF_DEPTH + 0.04], color: "#f8fafc" },
    );
  }
  parts.push(
    // Door, beside the far lane.
    { size: [0.08, 2.1, 1.1], at: [-HALF_WIDTH + 0.03, 1.05, -1.25], color: "#8a5a2b" },
    { size: [0.06, 0.08, 0.08], at: [-HALF_WIDTH + 0.08, 1, -0.85], color: "#e5c07b" },
    // Whiteboard with a couple of scribbles.
    { size: [0.05, 1.2, 2.1], at: [-HALF_WIDTH + 0.02, 1.6, 2.8], color: "#94a3b8" },
    { size: [0.06, 1.05, 1.95], at: [-HALF_WIDTH + 0.03, 1.6, 2.8], color: "#ffffff" },
    { size: [0.07, 0.05, 1.2], at: [-HALF_WIDTH + 0.04, 1.85, 2.6], color: "#3b82f6" },
    { size: [0.07, 0.05, 0.8], at: [-HALF_WIDTH + 0.04, 1.6, 2.4], color: "#ef4444" },
    { size: [0.07, 0.05, 1], at: [-HALF_WIDTH + 0.04, 1.38, 3], color: "#10b981" },
    // Lounge rug.
    { size: [4, 0.02, 2.2], at: [-1.6, 0.01, 3.7], color: "#7c9cbf" },
  );
  return parts;
}

/** Everything that stands in the room except the desk screens, which follow agent status. */
export function furniture(): Furniture[] {
  const items: Furniture[] = [
    {
      id: "sofa",
      anchor: [-1.6, 0.4, 4.5],
      parts: [
        { size: [2.4, 0.42, 0.8], at: [-1.6, 0.21, 4.45], color: "#4f6d7a" },
        { size: [2.4, 0.5, 0.2], at: [-1.6, 0.67, 4.8], color: "#4f6d7a" },
        { size: [2.2, 0.12, 0.6], at: [-1.6, 0.48, 4.4], color: "#628796" },
        { size: [0.2, 0.6, 0.8], at: [-2.9, 0.3, 4.45], color: "#44606b" },
        { size: [0.2, 0.6, 0.8], at: [-0.3, 0.3, 4.45], color: "#44606b" },
      ],
    },
    {
      id: "cooler",
      anchor: [6.5, 0.6, 3.4],
      parts: [
        { size: [0.5, 1, 0.5], at: [6.5, 0.5, 3.4], color: "#e5e7eb" },
        { size: [0.36, 0.45, 0.36], at: [6.5, 1.23, 3.4], color: "#60a5fa" },
        { size: [0.08, 0.06, 0.1], at: [6.22, 0.8, 3.4], color: "#1f2937" },
      ],
    },
    {
      id: "snacks",
      anchor: [2.6, 0.5, 4.5],
      parts: [
        { size: [0.1, 0.7, 0.1], at: [2.6, 0.35, 4.5], color: "#8a5a2b" },
        { size: [1, 0.06, 0.8], at: [2.6, 0.72, 4.5], color: "#c08a53" },
        { size: [0.2, 0.14, 0.2], at: [2.4, 0.82, 4.45], color: "#ef4444" },
        { size: [0.16, 0.16, 0.16], at: [2.75, 0.83, 4.55], color: "#facc15" },
      ],
    },
  ];
  for (const [x, z] of [
    [-6.4, 4.4],
    [6.4, -4.4],
  ] as const) {
    items.push({
      id: `plant-${x}`,
      anchor: [x, 0.6, z],
      parts: [
        { size: [0.5, 0.5, 0.5], at: [x, 0.25, z], color: "#b45309" },
        { size: [0.7, 0.6, 0.7], at: [x, 0.8, z], color: "#16a34a" },
        { size: [0.45, 0.4, 0.45], at: [x + 0.05, 1.25, z - 0.05], color: "#22c55e" },
      ],
    });
  }
  for (let index = 0; index < OFFICE_DESKS; index++) {
    const { x, z } = deskPosition(index);
    const seat = seatPosition(index);
    items.push(
      {
        id: `desk-${index}`,
        anchor: [x, 0.74, z],
        parts: [
          { size: [0.07, 0.7, 0.76], at: [x - 0.64, 0.36, z], color: "#8a5a2b" },
          { size: [0.07, 0.7, 0.76], at: [x + 0.64, 0.36, z], color: "#8a5a2b" },
          { size: [1.4, 0.07, 0.8], at: [x, 0.74, z], color: "#c08a53" },
          { size: [0.3, 0.02, 0.18], at: [x, 0.785, z - 0.25], color: "#4b5263" },
          { size: [0.08, 0.22, 0.08], at: [x, 0.86, z - 0.25], color: "#4b5263" },
          { size: [0.72, 0.44, 0.05], at: [x, 1.06, z - 0.22], color: "#1f2430" },
          { size: [0.5, 0.03, 0.16], at: [x, 0.79, z + 0.12], color: "#e5e7eb" },
          { size: [0.08, 0.1, 0.08], at: [x + 0.5, 0.82, z + 0.05], color: MUGS[index % 4]! },
        ],
      },
      {
        id: `chair-${index}`,
        anchor: [x, 0.4, seat.z + 0.15],
        parts: [
          { size: [0.45, 0.04, 0.45], at: [x, 0.03, seat.z], color: "#475569" },
          { size: [0.07, 0.36, 0.07], at: [x, 0.2, seat.z], color: "#475569" },
          { size: [0.5, 0.08, 0.5], at: [x, 0.42, seat.z], color: "#334155" },
          { size: [0.5, 0.38, 0.07], at: [x, 0.65, seat.z + 0.27], color: "#334155" },
        ],
      },
    );
  }
  return items;
}

/** The monitor face, drawn over the desk's monitor frame. */
export function deskScreen(index: number, status: OfficeStatus | "empty"): Part {
  const { x, z } = deskPosition(index);
  return {
    size: [0.64, 0.36, 0.01],
    at: [x, 1.07, z - 0.19],
    color: SCREEN_COLORS[status],
    flat: true,
  };
}
