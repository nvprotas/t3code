import { describe, expect, it } from "vite-plus/test";

import { createOfficeSim } from "./officeSim";
import { seatPosition } from "./officeWorld";

describe("createOfficeSim", () => {
  it("seats agents at their desks on first load and walks later arrivals in", () => {
    const sim = createOfficeSim();
    sim.setAgents([{ id: "a", name: "A", status: "working" }]);
    expect(sim.walkers.get("a")).toMatchObject(seatPosition(0));
    sim.setAgents([
      { id: "a", name: "A", status: "working" },
      { id: "b", name: "B", status: "working" },
    ]);
    const arrival = sim.walkers.get("b")!;
    expect(arrival.x).toBeLessThan(-6);
    for (let i = 0; i < 400; i++) sim.step(0.1);
    expect(arrival).toMatchObject({ ...seatPosition(1), seated: true });
  });

  it("lets two agents pass each other on a lane without overlapping", () => {
    const sim = createOfficeSim();
    sim.setAgents([
      { id: "a", name: "A", status: "working" },
      { id: "b", name: "B", status: "working" },
    ]);
    const a = sim.walkers.get("a")!;
    const b = sim.walkers.get("b")!;
    Object.assign(a, { x: -5, z: -1.25, px: -5, pz: -1.25, route: [{ x: 5, z: -1.25 }] });
    Object.assign(b, { x: 5, z: -1.25, px: 5, pz: -1.25, route: [{ x: -5, z: -1.25 }] });
    let closest = Infinity;
    for (let i = 0; i < 300 && (a.route.length > 0 || b.route.length > 0); i++) {
      sim.step(0.05);
      closest = Math.min(closest, Math.hypot(a.px - b.px, a.pz - b.pz));
    }
    expect(closest).toBeGreaterThan(0.4);
    expect([a.route.length, b.route.length]).toEqual([0, 0]);
  });
});
