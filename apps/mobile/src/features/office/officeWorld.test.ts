import { describe, expect, it } from "vite-plus/test";

import { LOUNGE_SPOTS, officeRoute, seatPosition } from "./officeWorld";

describe("officeRoute", () => {
  it("walks the lane in front of a desk row", () => {
    expect(officeRoute(seatPosition(0), seatPosition(3))).toEqual([
      { x: -5, z: -1.25 },
      { x: 1, z: -1.25 },
      seatPosition(3),
    ]);
  });

  it("changes lanes through the corridor instead of crossing desks", () => {
    expect(officeRoute(seatPosition(2), LOUNGE_SPOTS[0]!)).toEqual([
      { x: -1, z: -1.25 },
      { x: -6.3, z: -1.25 },
      { x: -6.3, z: 2 },
      { x: 5.9, z: 2 },
      LOUNGE_SPOTS[0],
    ]);
  });

  it("is empty when already there", () => {
    expect(officeRoute(seatPosition(7), seatPosition(7))).toEqual([]);
  });
});
