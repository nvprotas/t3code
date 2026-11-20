import type { OfficeStatus } from "./officeStatus";

export const OFFICE_SPRITE_WIDTH = 20;
export const OFFICE_SPRITE_HEIGHT = 22;

type OfficeSpriteKind = OfficeStatus | "empty" | "typing";

interface Layer {
  readonly x: number;
  readonly y: number;
  readonly rows: readonly string[];
}

/** A rectangle of one palette glyph, in sprite pixels. */
interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly glyph: string;
}

const DESK: readonly Layer[] = [
  { x: 1, y: 8, rows: ["mmmmmmmmmm", ...Array<string>(5).fill("mxxxxxxxxm"), "mmmmmmmmmm"] },
  { x: 5, y: 15, rows: ["MM"] },
  { x: 18, y: 10, rows: Array<string>(6).fill("cc") },
  { x: 0, y: 16, rows: ["d".repeat(OFFICE_SPRITE_WIDTH), "D".repeat(OFFICE_SPRITE_WIDTH)] },
  { x: 1, y: 18, rows: Array<string>(4).fill("DD") },
  { x: 17, y: 18, rows: Array<string>(4).fill("DD") },
  { x: 14, y: 18, rows: Array<string>(3).fill("cc") },
  { x: 11, y: 21, rows: ["cccccc"] },
];

function agent(x: number): readonly Layer[] {
  return [
    { x: x + 1, y: 7, rows: ["hhhh"] },
    { x, y: 8, rows: ["hhhhhh", "skssks", "ssssss"] },
    { x: x + 1, y: 11, rows: ["ssss"] },
    { x, y: 12, rows: Array<string>(4).fill("bbbbbb") },
  ];
}

const SPRITE_LAYERS: Readonly<Record<OfficeSpriteKind, readonly Layer[]>> = {
  empty: DESK,
  working: [
    ...DESK,
    { x: 2, y: 9, rows: ["gllllggg", "gggllllg", "glllgggg", "ggglllgg", "gllggggg"] },
    ...agent(12),
    { x: 11, y: 13, rows: ["b", "b"] },
    { x: 10, y: 15, rows: ["ss"] },
  ],
  typing: [
    ...DESK,
    { x: 2, y: 9, rows: ["gggggggg", "gllllggg", "ggglllgg", "glllgggg", "ggllllgg"] },
    ...agent(12),
    { x: 11, y: 13, rows: ["b", "b"] },
    { x: 11, y: 15, rows: ["ss"] },
  ],
  waiting: [
    ...DESK,
    { x: 2, y: 9, rows: ["qqqqqqqq", "xxxxxxxx", "xwwwwwxx", "xwwwxxxx", "xxxxxqqx"] },
    ...agent(14),
    { x: 11, y: 8, rows: ["ss"] },
    { x: 12, y: 9, rows: ["s", "s", "s", "s"] },
    { x: 12, y: 13, rows: ["bb"] },
    { x: 14, y: 0, rows: ["aaaaaa", "aawwaa", "aawwaa", "aaaaaa", "aawwaa", "aaaaaa"] },
    { x: 16, y: 6, rows: ["aa"] },
  ],
  idle: [
    ...DESK,
    { x: 3, y: 10, rows: ["l"] },
    ...agent(13),
    { x: 16, y: 3, rows: ["zzz", ".z.", "zzz"] },
  ],
  disconnected: [
    ...DESK,
    { x: 4, y: 9, rows: ["e...e", ".e.e.", "..e..", ".e.e.", "e...e"] },
    ...agent(13),
  ],
};

function pixelRects(layers: readonly Layer[]): readonly PixelRect[] {
  const grid = Array.from({ length: OFFICE_SPRITE_HEIGHT }, () =>
    Array<string>(OFFICE_SPRITE_WIDTH).fill("."),
  );
  for (const layer of layers) {
    layer.rows.forEach((row, dy) => {
      [...row].forEach((glyph, dx) => {
        const line = grid[layer.y + dy];
        if (glyph !== "." && line && layer.x + dx < OFFICE_SPRITE_WIDTH) line[layer.x + dx] = glyph;
      });
    });
  }
  const rects: PixelRect[] = [];
  // A run that repeats the one above it grows that rectangle, so a leg is one element, not four.
  let open = new Map<string, number>();
  grid.forEach((line, y) => {
    const next = new Map<string, number>();
    let start = 0;
    for (let x = 1; x <= line.length; x++) {
      if (x < line.length && line[x] === line[start]) continue;
      const glyph = line[start]!;
      if (glyph !== ".") {
        const key = `${start}:${x - start}:${glyph}`;
        const above = open.get(key);
        if (above === undefined) {
          next.set(key, rects.push({ x: start, y, width: x - start, height: 1, glyph }) - 1);
        } else {
          rects[above] = { ...rects[above]!, height: rects[above]!.height + 1 };
          next.set(key, above);
        }
      }
      start = x;
    }
    open = next;
  });
  return rects;
}

const SPRITES = {
  empty: pixelRects(SPRITE_LAYERS.empty),
  working: pixelRects(SPRITE_LAYERS.working),
  typing: pixelRects(SPRITE_LAYERS.typing),
  waiting: pixelRects(SPRITE_LAYERS.waiting),
  idle: pixelRects(SPRITE_LAYERS.idle),
  disconnected: pixelRects(SPRITE_LAYERS.disconnected),
} satisfies Record<OfficeSpriteKind, readonly PixelRect[]>;

export function officeSprite(kind: OfficeSpriteKind) {
  return SPRITES[kind];
}

const SCENE_COLORS: Readonly<Record<string, string>> = {
  m: "#4b5263",
  M: "#6b7280",
  x: "#1f2430",
  g: "#134e4a",
  l: "#5eead4",
  q: "#b45309",
  w: "#ffffff",
  e: "#9ca3af",
  d: "#c08a53",
  D: "#8a5a2b",
  c: "#475569",
  s: "#f1c9a5",
  k: "#1f2937",
  a: "#d97706",
  z: "#94a3b8",
};

const OFFLINE_COLORS: Readonly<Record<string, string>> = {
  ...SCENE_COLORS,
  m: "#6b7280",
  M: "#9ca3af",
  x: "#374151",
  e: "#d1d5db",
  d: "#9ca3af",
  D: "#6b7280",
  c: "#6b7280",
  s: "#9ca3af",
  k: "#374151",
  h: "#6b7280",
  b: "#6b7280",
};

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

/** Glyph colors for one desk; the agent's hair and shirt follow its thread id. */
export function officePalette(
  status: OfficeSpriteKind,
  threadId: string,
): Readonly<Record<string, string>> {
  if (status === "disconnected") return OFFLINE_COLORS;
  const hash = hashString(threadId);
  return {
    ...SCENE_COLORS,
    h: HAIR_COLORS[hash % HAIR_COLORS.length] ?? "#111827",
    b: SHIRT_COLORS[(hash >>> 8) % SHIRT_COLORS.length] ?? "#3b82f6",
  };
}
