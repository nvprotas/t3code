import { describe, expect, it } from "vite-plus/test";

import { OFFICE_SPRITE_HEIGHT, OFFICE_SPRITE_WIDTH, officePalette, officeSprite } from "./sprites";

const KINDS = ["empty", "working", "waiting", "idle", "disconnected"] as const;

describe("office sprites", () => {
  it.each(KINDS)("keeps the %s sprite on the grid, colored, and modest in size", (kind) => {
    const rects = officeSprite(kind);
    const palette = officePalette(kind, "thread-1");
    expect(rects.length).toBeLessThanOrEqual(50);
    for (const rect of rects) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(OFFICE_SPRITE_WIDTH);
      expect(rect.y + rect.height).toBeLessThanOrEqual(OFFICE_SPRITE_HEIGHT);
      expect(palette[rect.glyph]).toBeDefined();
    }
  });

  it("varies the agent by thread id but never by render", () => {
    expect(officePalette("idle", "a")).toEqual(officePalette("idle", "a"));
    const shirts = ["a", "b", "c", "d", "e", "f"].map((id) => officePalette("idle", id).b);
    expect(new Set(shirts).size).toBeGreaterThan(1);
  });
});
