import type { OfficeStatus } from "./officeStatus";
import {
  type FloorPoint,
  LOUNGE_SPOTS,
  OFFICE_DESKS,
  officeRoute,
  seatPosition,
} from "./officeWorld";

export interface OfficeAgent {
  readonly id: string;
  readonly status: OfficeStatus;
}

export interface Walker {
  readonly id: string;
  readonly phase: number;
  status: OfficeStatus;
  desk: number;
  x: number;
  z: number;
  heading: number;
  route: FloorPoint[];
  pause: number;
  walking: boolean;
  seated: boolean;
}

export interface Pose {
  readonly legLeft: number;
  readonly legRight: number;
  readonly armLeft: number;
  readonly armRight: number;
  readonly bob: number;
  readonly tilt: number;
  readonly alertY: number;
  readonly alertSpin: number;
}

const WALK_SPEED = 1.5;
const FACING_DESK = Math.PI;
// Turned towards the camera, so a waiting agent waves at you.
const FACING_VIEWER = Math.atan2(11, 13);
const DOOR: FloorPoint = { x: -6.8, z: -1.25 };

/** Who is where in the office; no rendering, so it can be stepped and tested on its own. */
export function createOfficeSim() {
  const walkers = new Map<string, Walker>();
  let clock = 0;
  let populated = false;

  function retarget(walker: Walker) {
    const seat = seatPosition(walker.desk);
    const spot = LOUNGE_SPOTS[Math.floor(Math.random() * LOUNGE_SPOTS.length)];
    const goal =
      walker.status === "idle" && spot
        ? { x: spot.x + (Math.random() - 0.5) * 0.8, z: spot.z + (Math.random() - 0.5) * 0.4 }
        : walker.status === "waiting"
          ? { x: seat.x + 1, z: seat.z }
          : seat;
    walker.route = officeRoute(walker, goal);
  }

  function setAgents(agents: readonly OfficeAgent[]) {
    const next = new Map(agents.slice(0, OFFICE_DESKS).map((agent) => [agent.id, agent]));
    for (const id of walkers.keys()) {
      if (!next.has(id)) walkers.delete(id);
    }
    const taken = new Set([...walkers.values()].map((walker) => walker.desk));
    for (const agent of next.values()) {
      let walker = walkers.get(agent.id);
      if (!walker) {
        let desk = 0;
        while (taken.has(desk)) desk++;
        taken.add(desk);
        // On first load everyone is already at their desk; later arrivals come in through the door.
        const start = populated ? DOOR : seatPosition(desk);
        walker = {
          id: agent.id,
          phase: Math.random() * 10,
          status: agent.status,
          desk,
          x: start.x,
          z: start.z,
          heading: FACING_DESK,
          route: [],
          pause: Math.random() * 3,
          walking: false,
          seated: false,
        };
        walkers.set(agent.id, walker);
        retarget(walker);
      } else if (walker.status !== agent.status) {
        walker.status = agent.status;
        retarget(walker);
      }
    }
    populated = true;
  }

  function stepWalker(walker: Walker, dt: number) {
    const target = walker.route[0];
    let targetHeading = walker.heading;
    if (target) {
      const dx = target.x - walker.x;
      const dz = target.z - walker.z;
      const distance = Math.hypot(dx, dz);
      const step = WALK_SPEED * dt;
      if (distance <= step) {
        walker.x = target.x;
        walker.z = target.z;
        walker.route.shift();
      } else {
        walker.x += (dx / distance) * step;
        walker.z += (dz / distance) * step;
      }
      if (distance > 1e-3) targetHeading = Math.atan2(dx, dz);
    } else if (walker.status === "idle") {
      walker.pause -= dt;
      if (walker.pause <= 0) {
        walker.pause = 4 + Math.random() * 6;
        retarget(walker);
      }
    }
    const seat = seatPosition(walker.desk);
    walker.walking = target !== undefined;
    walker.seated =
      !target &&
      (walker.status === "working" || walker.status === "disconnected") &&
      Math.abs(walker.x - seat.x) + Math.abs(walker.z - seat.z) < 1e-3;
    if (walker.seated) targetHeading = FACING_DESK;
    if (!target && walker.status === "waiting") targetHeading = FACING_VIEWER;
    const turn = Math.atan2(
      Math.sin(targetHeading - walker.heading),
      Math.cos(targetHeading - walker.heading),
    );
    walker.heading += turn * Math.min(1, dt * 10);
    return target !== undefined || walker.status !== "disconnected" || Math.abs(turn) > 1e-3;
  }

  /** Advances time; false when nothing on screen is moving. */
  function step(dt: number) {
    clock += dt;
    let animating = false;
    for (const walker of walkers.values()) animating = stepWalker(walker, dt) || animating;
    return animating;
  }

  function pose(walker: Walker): Pose {
    const t = clock + walker.phase;
    const alertY = 1.65 + Math.sin(t * 4) * 0.06;
    const alertSpin = t * 1.5;
    if (walker.walking) {
      const swing = Math.sin(t * 9);
      return {
        legLeft: swing * 0.6,
        legRight: -swing * 0.6,
        armLeft: -swing * 0.5,
        armRight: swing * 0.5,
        bob: Math.abs(Math.cos(t * 9)) * 0.04,
        tilt: 0,
        alertY,
        alertSpin,
      };
    }
    if (walker.seated) {
      const working = walker.status === "working";
      return {
        legLeft: -Math.PI / 2,
        legRight: -Math.PI / 2,
        armLeft: working ? -1.15 + Math.sin(t * 18) * 0.12 : -0.6,
        armRight: working ? -1.15 + Math.sin(t * 18 + Math.PI) * 0.12 : -0.6,
        bob: 0,
        tilt: walker.status === "disconnected" ? 0.3 : 0,
        alertY,
        alertSpin,
      };
    }
    return {
      legLeft: 0,
      legRight: 0,
      armLeft: Math.sin(t * 1.5) * 0.05,
      armRight:
        walker.status === "waiting" ? -2.7 + Math.sin(t * 7) * 0.25 : -Math.sin(t * 1.5) * 0.05,
      bob: 0,
      tilt: 0,
      alertY,
      alertSpin,
    };
  }

  return { walkers, setAgents, step, pose };
}

export type OfficeSim = ReturnType<typeof createOfficeSim>;
