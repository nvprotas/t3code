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
  readonly name: string;
  /** A word or two on what the thread is about, under the name on Android. */
  readonly task?: string;
  readonly status: OfficeStatus;
  /** Running subagents; on Android the thread then moves into a private office. */
  readonly subagents?: number;
  // Read only by the Android scene.
  readonly team?: string;
  readonly teamName?: string;
  readonly ask?: "approval" | "input" | "";
  readonly quietSince?: number;
  readonly merged?: number;
  readonly alarm?: boolean;
  readonly limited?: boolean;
  /** Which provider runs the thread, shown as a coloured dot on the name tag. */
  readonly provider?: string;
}

export interface Walker {
  readonly id: string;
  name: string;
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
  /** Sidestep that keeps walkers from meeting head-on; the drawn position is (px, pz). */
  offX: number;
  offZ: number;
  waited: number;
  px: number;
  pz: number;
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
// Everyone steps to the same hand, so two walkers on one lane pass instead of colliding.
const SIDESTEP = 0.34;
const LOOK_AHEAD = 1.1;
const PERSONAL_SPACE = 0.5;
const MAX_WAIT = 1.5;

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
          name: agent.name,
          offX: 0,
          offZ: 0,
          waited: 0,
          px: start.x,
          pz: start.z,
        };
        walkers.set(agent.id, walker);
        retarget(walker);
      } else if (walker.status !== agent.status) {
        walker.status = agent.status;
        retarget(walker);
      }
    }
    for (const agent of next.values()) {
      const walker = walkers.get(agent.id);
      if (walker) walker.name = agent.name;
    }
    populated = true;
  }

  function stepWalker(walker: Walker, dt: number) {
    const target = walker.route[0];
    let targetHeading = walker.heading;
    let sidestepX = 0;
    let sidestepZ = 0;
    let blocked = false;
    if (target) {
      const dx = target.x - walker.x;
      const dz = target.z - walker.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1e-3) {
        const dirX = dx / distance;
        const dirZ = dz / distance;
        for (const other of walkers.values()) {
          if (other === walker) continue;
          const ox = other.px - walker.px;
          const oz = other.pz - walker.pz;
          const ahead = ox * dirX + oz * dirZ;
          if (ahead <= 0 || ahead > LOOK_AHEAD) continue;
          const side = ox * dirZ - oz * dirX;
          if (Math.abs(side) > PERSONAL_SPACE + 0.1) continue;
          sidestepX = dirZ * SIDESTEP;
          sidestepZ = -dirX * SIDESTEP;
          if (ahead < PERSONAL_SPACE && Math.abs(side) < PERSONAL_SPACE * 0.6) blocked = true;
        }
      }
      if (blocked && walker.waited < MAX_WAIT) {
        walker.waited += dt;
      } else {
        blocked = false;
        walker.waited = 0;
        const step = WALK_SPEED * dt;
        if (distance <= step) {
          walker.x = target.x;
          walker.z = target.z;
          walker.route.shift();
        } else {
          walker.x += (dx / distance) * step;
          walker.z += (dz / distance) * step;
        }
      }
      if (distance > 1e-3) targetHeading = Math.atan2(dx, dz);
    } else {
      walker.waited = 0;
      if (walker.status === "idle") {
        walker.pause -= dt;
        if (walker.pause <= 0) {
          walker.pause = 4 + Math.random() * 6;
          retarget(walker);
        }
      }
    }
    const ease = Math.min(1, dt * 6);
    walker.offX += (sidestepX - walker.offX) * ease;
    walker.offZ += (sidestepZ - walker.offZ) * ease;
    walker.px = walker.x + walker.offX;
    walker.pz = walker.z + walker.offZ;
    const seat = seatPosition(walker.desk);
    walker.walking = target !== undefined && !blocked;
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
    // Standing and seated poses change in coarse steps, so unchanged agents are not redrawn.
    const t = walker.walking ? clock + walker.phase : Math.floor((clock + walker.phase) * 10) / 10;
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
