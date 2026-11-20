import { describe, expect, it } from "vite-plus/test";

import { createOfficeSim } from "./officeSim";
import { seatPosition } from "./officeWorld";

describe("createOfficeSim", () => {
  it("seats agents at their desks on first load and walks later arrivals in", () => {
    const sim = createOfficeSim();
    sim.setAgents([{ id: "a", status: "working" }]);
    expect(sim.walkers.get("a")).toMatchObject(seatPosition(0));
    sim.setAgents([
      { id: "a", status: "working" },
      { id: "b", status: "working" },
    ]);
    const arrival = sim.walkers.get("b")!;
    expect(arrival.x).toBeLessThan(-6);
    for (let i = 0; i < 400; i++) sim.step(0.1);
    expect(arrival).toMatchObject({ ...seatPosition(1), seated: true });
  });
});
