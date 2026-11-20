/** Floor plan of the 3D office, in world units on the floor plane (x right, z towards the viewer). */
export interface FloorPoint {
  readonly x: number;
  readonly z: number;
}

export const ROOM_WIDTH = 14;
export const ROOM_DEPTH = 10;
export const OFFICE_DESKS = 12;

const DESK_COLUMNS = [-5, -3, -1, 1, 3, 5] as const;
const DESK_ROWS = [-3, 0] as const;
const SEAT_OFFSET = 0.85;
// Walkers move only along these lanes and the corridor, so they never cut through a desk.
const LANES = [-1.25, 2] as const;
const CORRIDOR_X = -6.3;

export const LOUNGE_SPOTS: readonly FloorPoint[] = [
  { x: 5.9, z: 3.4 },
  { x: -1.6, z: 3.6 },
  { x: -5.6, z: 3.2 },
  { x: 2.6, z: 3.8 },
];

export function deskPosition(index: number): FloorPoint {
  return {
    x: DESK_COLUMNS[index % DESK_COLUMNS.length] ?? 0,
    z: DESK_ROWS[Math.floor(index / DESK_COLUMNS.length) % DESK_ROWS.length] ?? 0,
  };
}

export function seatPosition(index: number): FloorPoint {
  const desk = deskPosition(index);
  return { x: desk.x, z: desk.z + SEAT_OFFSET };
}

function laneIndex(point: FloorPoint) {
  return point.z < -0.5 ? 0 : 1;
}

/** Waypoints from one floor point to another along the lanes, excluding the start. */
export function officeRoute(from: FloorPoint, to: FloorPoint): FloorPoint[] {
  if (Math.abs(to.x - from.x) + Math.abs(to.z - from.z) < 1e-3) return [];
  const start = laneIndex(from);
  const end = laneIndex(to);
  const points: FloorPoint[] = [{ x: from.x, z: LANES[start] }];
  if (start !== end) {
    points.push({ x: CORRIDOR_X, z: LANES[start] }, { x: CORRIDOR_X, z: LANES[end] });
  }
  points.push({ x: to.x, z: LANES[end] }, to);
  const route: FloorPoint[] = [];
  let last = from;
  for (const point of points) {
    if (Math.abs(point.x - last.x) + Math.abs(point.z - last.z) < 1e-3) continue;
    route.push(point);
    last = point;
  }
  return route;
}

const HAIR_COLORS = ["#3b2417", "#111827", "#a16207", "#7c2d12", "#d6d3d1", "#b45309"] as const;
const SHIRT_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#a855f7",
  "#f97316",
  "#14b8a6",
  "#ec4899",
  "#eab308",
] as const;

function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Each thread's agent keeps the same look everywhere it appears. */
export function agentColors(threadId: string) {
  const hash = hashString(threadId);
  return {
    hair: HAIR_COLORS[hash % HAIR_COLORS.length] ?? "#111827",
    shirt: SHIRT_COLORS[(hash >>> 8) % SHIRT_COLORS.length] ?? "#3b82f6",
  };
}
