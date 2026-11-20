import type { ExpoWebGLRenderingContext } from "expo-gl";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";

import type { OfficeStatus } from "./officeStatus";
import {
  agentColors,
  deskPosition,
  type FloorPoint,
  LOUNGE_SPOTS,
  OFFICE_DESKS,
  officeRoute,
  ROOM_DEPTH,
  ROOM_WIDTH,
  seatPosition,
} from "./officeWorld";

export interface OfficeAgent {
  readonly id: string;
  readonly status: OfficeStatus;
}

interface Part {
  readonly size: readonly [number, number, number];
  readonly at: readonly [number, number, number];
  readonly color: string;
}

const WALK_SPEED = 1.5;
const FACING_DESK = Math.PI;
// Turned towards the camera, so a waiting agent waves at you.
const FACING_VIEWER = Math.atan2(11, 13);
const SKIN = "#f1c9a5";
const SCREEN_COLORS: Readonly<Record<OfficeStatus | "empty", string>> = {
  working: "#5eead4",
  waiting: "#fbbf24",
  idle: "#334155",
  disconnected: "#1f2937",
  empty: "#111827",
};
// WebGL-only pixelStorei parameters that GLES rejects with a warning per call.
const WEBGL_ONLY_PIXEL_PARAMS = new Set([0x9240, 0x9241, 0x9243]);

/** Bakes boxes into one vertex-coloured geometry, so a whole set is a single draw call. */
function boxes(parts: readonly Part[]) {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const matrix = new Matrix4();
  const color = new Color();
  for (const part of parts) {
    const box = new BoxGeometry(...part.size).toNonIndexed();
    box.applyMatrix4(matrix.makeTranslation(...part.at));
    color.set(part.color);
    const position = box.getAttribute("position");
    const normal = box.getAttribute("normal");
    for (let index = 0; index < position.count; index++) {
      positions.push(position.getX(index), position.getY(index), position.getZ(index));
      normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
      colors.push(color.r, color.g, color.b);
    }
    box.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  return geometry;
}

function roomParts(): Part[] {
  const parts: Part[] = [];
  const halfWidth = ROOM_WIDTH / 2;
  const halfDepth = ROOM_DEPTH / 2;
  for (let x = -halfWidth + 1; x < halfWidth; x += 2) {
    for (let z = -halfDepth + 1; z < halfDepth; z += 2) {
      const even = (x + z + ROOM_WIDTH) % 4 === 0;
      parts.push({ size: [2, 0.1, 2], at: [x, -0.05, z], color: even ? "#d9c4a0" : "#cdb48c" });
    }
  }
  parts.push(
    { size: [ROOM_WIDTH + 0.4, 3, 0.2], at: [0, 1.5, -halfDepth - 0.1], color: "#ece6da" },
    { size: [0.2, 3, ROOM_DEPTH], at: [-halfWidth - 0.1, 1.5, 0], color: "#e1d9c8" },
    { size: [ROOM_WIDTH + 0.4, 0.16, 0.05], at: [0, 0.08, -halfDepth + 0.02], color: "#8a6a4a" },
    { size: [0.05, 0.16, ROOM_DEPTH], at: [-halfWidth + 0.02, 0.08, 0], color: "#8a6a4a" },
  );
  for (const x of [-4, 0, 4]) {
    parts.push(
      { size: [2.4, 1.4, 0.06], at: [x, 1.85, -halfDepth + 0.02], color: "#f8fafc" },
      { size: [2.2, 1.2, 0.07], at: [x, 1.85, -halfDepth + 0.03], color: "#8ecdf2" },
      { size: [0.06, 1.2, 0.08], at: [x, 1.85, -halfDepth + 0.04], color: "#f8fafc" },
    );
  }
  parts.push(
    // Door, beside the far lane.
    { size: [0.08, 2.1, 1.1], at: [-halfWidth + 0.03, 1.05, -1.25], color: "#8a5a2b" },
    { size: [0.06, 0.08, 0.08], at: [-halfWidth + 0.08, 1, -0.85], color: "#e5c07b" },
    // Whiteboard with a couple of scribbles.
    { size: [0.05, 1.2, 2.1], at: [-halfWidth + 0.02, 1.6, 2.8], color: "#94a3b8" },
    { size: [0.06, 1.05, 1.95], at: [-halfWidth + 0.03, 1.6, 2.8], color: "#ffffff" },
    { size: [0.07, 0.05, 1.2], at: [-halfWidth + 0.04, 1.85, 2.6], color: "#3b82f6" },
    { size: [0.07, 0.05, 0.8], at: [-halfWidth + 0.04, 1.6, 2.4], color: "#ef4444" },
    { size: [0.07, 0.05, 1], at: [-halfWidth + 0.04, 1.38, 3], color: "#10b981" },
    // Lounge: rug and sofa.
    { size: [4, 0.02, 2.2], at: [-1.6, 0.01, 3.7], color: "#7c9cbf" },
    { size: [2.4, 0.42, 0.8], at: [-1.6, 0.21, 4.45], color: "#4f6d7a" },
    { size: [2.2, 0.12, 0.6], at: [-1.6, 0.48, 4.4], color: "#628796" },
    { size: [2.4, 0.5, 0.2], at: [-1.6, 0.67, 4.8], color: "#4f6d7a" },
    { size: [0.2, 0.6, 0.8], at: [-2.9, 0.3, 4.45], color: "#44606b" },
    { size: [0.2, 0.6, 0.8], at: [-0.3, 0.3, 4.45], color: "#44606b" },
    // Water cooler.
    { size: [0.5, 1, 0.5], at: [6.5, 0.5, 3.4], color: "#e5e7eb" },
    { size: [0.36, 0.45, 0.36], at: [6.5, 1.23, 3.4], color: "#60a5fa" },
    { size: [0.08, 0.06, 0.1], at: [6.22, 0.8, 3.4], color: "#1f2937" },
    // Snack table.
    { size: [1, 0.06, 0.8], at: [2.6, 0.72, 4.5], color: "#c08a53" },
    { size: [0.1, 0.7, 0.1], at: [2.6, 0.35, 4.5], color: "#8a5a2b" },
    { size: [0.2, 0.14, 0.2], at: [2.4, 0.82, 4.45], color: "#ef4444" },
    { size: [0.16, 0.16, 0.16], at: [2.75, 0.83, 4.55], color: "#facc15" },
  );
  for (const [x, z] of [
    [-6.4, 4.4],
    [6.4, -4.4],
  ] as const) {
    parts.push(
      { size: [0.5, 0.5, 0.5], at: [x, 0.25, z], color: "#b45309" },
      { size: [0.7, 0.6, 0.7], at: [x, 0.8, z], color: "#16a34a" },
      { size: [0.45, 0.4, 0.45], at: [x + 0.05, 1.25, z - 0.05], color: "#22c55e" },
    );
  }
  const mugs = ["#ef4444", "#3b82f6", "#f8fafc", "#10b981"];
  for (let index = 0; index < OFFICE_DESKS; index++) {
    const { x, z } = deskPosition(index);
    const seat = seatPosition(index);
    parts.push(
      { size: [1.4, 0.07, 0.8], at: [x, 0.74, z], color: "#c08a53" },
      { size: [0.07, 0.7, 0.76], at: [x - 0.64, 0.36, z], color: "#8a5a2b" },
      { size: [0.07, 0.7, 0.76], at: [x + 0.64, 0.36, z], color: "#8a5a2b" },
      { size: [0.72, 0.44, 0.05], at: [x, 1.06, z - 0.22], color: "#1f2430" },
      { size: [0.08, 0.22, 0.08], at: [x, 0.86, z - 0.25], color: "#4b5263" },
      { size: [0.3, 0.02, 0.18], at: [x, 0.785, z - 0.25], color: "#4b5263" },
      { size: [0.5, 0.03, 0.16], at: [x, 0.79, z + 0.12], color: "#e5e7eb" },
      { size: [0.08, 0.1, 0.08], at: [x + 0.5, 0.82, z + 0.05], color: mugs[index % 4]! },
      { size: [0.5, 0.08, 0.5], at: [x, 0.42, seat.z], color: "#334155" },
      { size: [0.5, 0.38, 0.07], at: [x, 0.65, seat.z + 0.27], color: "#334155" },
      { size: [0.07, 0.36, 0.07], at: [x, 0.2, seat.z], color: "#475569" },
      { size: [0.45, 0.04, 0.45], at: [x, 0.03, seat.z], color: "#475569" },
    );
  }
  return parts;
}

interface Walker {
  readonly id: string;
  readonly root: Group;
  readonly body: Mesh;
  readonly limbs: readonly [Mesh, Mesh, Mesh, Mesh];
  readonly alert: Mesh;
  readonly phase: number;
  status: OfficeStatus;
  desk: number;
  x: number;
  z: number;
  heading: number;
  route: FloorPoint[];
  pause: number;
}

export function createOfficeEngine(gl: ExpoWebGLRenderingContext) {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixelStorei = gl.pixelStorei.bind(gl);
  gl.pixelStorei = (pname, param) => {
    if (!WEBGL_ONLY_PIXEL_PARAMS.has(pname)) pixelStorei(pname, param);
  };
  // three reads these at startup; some expo-gl builds return null.
  const attributes =
    typeof gl.getContextAttributes === "function" ? gl.getContextAttributes() : null;
  if (!attributes) {
    gl.getContextAttributes = () => ({
      alpha: true,
      antialias: false,
      depth: true,
      desynchronized: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: false,
    });
  }
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: () => gl,
  };
  const renderer = new WebGLRenderer({
    canvas: canvas as never,
    context: gl as never,
    antialias: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor("#1b1f27");

  const scene = new Scene();
  scene.add(new HemisphereLight("#ffffff", "#9c8b70", 2.2));
  const sun = new DirectionalLight("#fff6e5", 1.8);
  sun.position.set(-4, 10, 6);
  scene.add(sun);

  const material = new MeshLambertMaterial({ vertexColors: true });
  const offlineMaterial = new MeshLambertMaterial({ vertexColors: true, color: "#6b7280" });
  const glowMaterial = new MeshBasicMaterial({ vertexColors: true });
  const shadowMaterial = new MeshBasicMaterial({
    color: "#000000",
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });

  const room = new Mesh(boxes(roomParts()), material);
  room.matrixAutoUpdate = false;
  scene.add(room);

  const screenGeometry = new BoxGeometry(0.64, 0.36, 0.01);
  const screenMaterials = Object.fromEntries(
    Object.entries(SCREEN_COLORS).map(([key, color]) => [key, new MeshBasicMaterial({ color })]),
  ) as Record<OfficeStatus | "empty", MeshBasicMaterial>;
  const screens = Array.from({ length: OFFICE_DESKS }, (_, index) => {
    const { x, z } = deskPosition(index);
    const screen = new Mesh(screenGeometry, screenMaterials.empty);
    screen.position.set(x, 1.07, z - 0.19);
    screen.updateMatrix();
    screen.matrixAutoUpdate = false;
    scene.add(screen);
    return screen;
  });

  const legGeometry = boxes([{ size: [0.14, 0.45, 0.14], at: [0, -0.225, 0], color: "#334155" }]);
  const alertGeometry = boxes([
    { size: [0.11, 0.26, 0.11], at: [0, 0.06, 0], color: "#fbbf24" },
    { size: [0.11, 0.1, 0.11], at: [0, -0.18, 0], color: "#fbbf24" },
  ]);
  const shadowGeometry = new CircleGeometry(0.32, 12).rotateX(-Math.PI / 2);

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(11, 12, 13);
  camera.lookAt(0, 0.6, 0.5);
  const halfWidth = 8.9;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = (halfWidth * height) / width;
  camera.bottom = (-halfWidth * height) / width;
  camera.updateProjectionMatrix();

  const walkers = new Map<string, Walker>();
  let clock = 0;
  let dirty = true;
  let populated = false;

  function createWalker(agent: OfficeAgent, desk: number, start: FloorPoint): Walker {
    const { hair, shirt } = agentColors(agent.id);
    const root = new Group();
    const body = new Mesh(
      boxes([
        { size: [0.42, 0.45, 0.25], at: [0, 0.675, 0], color: shirt },
        { size: [0.3, 0.3, 0.3], at: [0, 1.06, 0], color: SKIN },
        { size: [0.32, 0.09, 0.32], at: [0, 1.235, 0], color: hair },
        { size: [0.32, 0.2, 0.08], at: [0, 1.12, -0.13], color: hair },
        { size: [0.05, 0.05, 0.02], at: [-0.07, 1.08, 0.151], color: "#1f2937" },
        { size: [0.05, 0.05, 0.02], at: [0.07, 1.08, 0.151], color: "#1f2937" },
      ]),
      material,
    );
    const armGeometry = boxes([
      { size: [0.1, 0.3, 0.1], at: [0, -0.15, 0], color: shirt },
      { size: [0.09, 0.1, 0.09], at: [0, -0.35, 0], color: SKIN },
    ]);
    const leftLeg = new Mesh(legGeometry, material);
    const rightLeg = new Mesh(legGeometry, material);
    const leftArm = new Mesh(armGeometry, material);
    const rightArm = new Mesh(armGeometry, material);
    leftLeg.position.set(-0.1, 0.45, 0);
    rightLeg.position.set(0.1, 0.45, 0);
    leftArm.position.set(-0.27, 0.88, 0);
    rightArm.position.set(0.27, 0.88, 0);
    const alert = new Mesh(alertGeometry, glowMaterial);
    alert.position.set(0, 1.65, 0);
    const shadow = new Mesh(shadowGeometry, shadowMaterial);
    shadow.position.y = 0.012;
    const figure = new Group();
    figure.add(body, leftLeg, rightLeg, leftArm, rightArm, alert);
    root.add(shadow, figure);
    scene.add(root);
    return {
      id: agent.id,
      root,
      body,
      limbs: [leftLeg, rightLeg, leftArm, rightArm],
      alert,
      phase: Math.random() * 10,
      status: agent.status,
      desk,
      x: start.x,
      z: start.z,
      heading: FACING_DESK,
      route: [],
      pause: Math.random() * 3,
    };
  }

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
    for (const [id, walker] of walkers) {
      if (next.has(id)) continue;
      scene.remove(walker.root);
      walker.body.geometry.dispose();
      walker.limbs[2].geometry.dispose();
      walkers.delete(id);
      screens[walker.desk]!.material = screenMaterials.empty;
    }
    const taken = new Set([...walkers.values()].map((walker) => walker.desk));
    for (const agent of next.values()) {
      let walker = walkers.get(agent.id);
      if (!walker) {
        let desk = 0;
        while (taken.has(desk)) desk++;
        taken.add(desk);
        // On first load everyone is already at their desk; later arrivals come in through the door.
        walker = createWalker(agent, desk, populated ? { x: -6.8, z: -1.25 } : seatPosition(desk));
        walkers.set(agent.id, walker);
        retarget(walker);
      } else if (walker.status !== agent.status) {
        walker.status = agent.status;
        retarget(walker);
      }
      screens[walker.desk]!.material = screenMaterials[agent.status];
      const offline = agent.status === "disconnected";
      for (const mesh of [walker.body, ...walker.limbs]) {
        mesh.material = offline ? offlineMaterial : material;
      }
    }
    populated = true;
    dirty = true;
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
    const seated =
      !target &&
      (walker.status === "working" || walker.status === "disconnected") &&
      Math.abs(walker.x - seat.x) + Math.abs(walker.z - seat.z) < 1e-3;
    if (seated) targetHeading = FACING_DESK;
    if (!target && walker.status === "waiting") targetHeading = FACING_VIEWER;
    const turn = Math.atan2(
      Math.sin(targetHeading - walker.heading),
      Math.cos(targetHeading - walker.heading),
    );
    walker.heading += turn * Math.min(1, dt * 10);

    const t = clock + walker.phase;
    const [leftLeg, rightLeg, leftArm, rightArm] = walker.limbs;
    const figure = walker.body.parent!;
    figure.position.y = 0;
    figure.rotation.x = 0;
    walker.alert.visible = walker.status === "waiting";
    if (target) {
      const swing = Math.sin(t * 9);
      leftLeg.rotation.x = swing * 0.6;
      rightLeg.rotation.x = -swing * 0.6;
      leftArm.rotation.x = -swing * 0.5;
      rightArm.rotation.x = swing * 0.5;
      figure.position.y = Math.abs(Math.cos(t * 9)) * 0.04;
    } else if (seated) {
      leftLeg.rotation.x = -Math.PI / 2;
      rightLeg.rotation.x = -Math.PI / 2;
      if (walker.status === "working") {
        leftArm.rotation.x = -1.15 + Math.sin(t * 18) * 0.12;
        rightArm.rotation.x = -1.15 + Math.sin(t * 18 + Math.PI) * 0.12;
      } else {
        leftArm.rotation.x = -0.6;
        rightArm.rotation.x = -0.6;
      }
      if (walker.status === "disconnected") figure.rotation.x = 0.3;
    } else {
      leftLeg.rotation.x = 0;
      rightLeg.rotation.x = 0;
      leftArm.rotation.x = Math.sin(t * 1.5) * 0.05;
      rightArm.rotation.x =
        walker.status === "waiting" ? -2.7 + Math.sin(t * 7) * 0.25 : -Math.sin(t * 1.5) * 0.05;
    }
    if (walker.alert.visible) {
      walker.alert.position.y = 1.65 + Math.sin(t * 4) * 0.06;
      walker.alert.rotation.y = t * 1.5;
    }
    walker.root.position.set(walker.x, 0, walker.z);
    walker.root.rotation.y = walker.heading;
    return target !== undefined || walker.status !== "disconnected" || Math.abs(turn) > 1e-3;
  }

  /** Advances the scene; draws only when something changed. */
  function frame(dt: number) {
    clock += dt;
    let moving = false;
    for (const walker of walkers.values()) moving = stepWalker(walker, dt) || moving;
    if (!moving && !dirty) return;
    dirty = false;
    renderer.render(scene, camera);
    gl.endFrameEXP();
  }

  const projected = new Vector3();
  /** The agent under a tap, in view coordinates. */
  function pick(x: number, y: number, viewWidth: number, viewHeight: number) {
    let best: string | undefined;
    let bestDistance = 0.11 * viewWidth;
    for (const walker of walkers.values()) {
      projected.set(walker.x, 0.8, walker.z).project(camera);
      const distance = Math.hypot(
        ((projected.x + 1) / 2) * viewWidth - x,
        ((1 - projected.y) / 2) * viewHeight - y,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = walker.id;
      }
    }
    return best;
  }

  return {
    setAgents,
    frame,
    pick,
    dispose: () => renderer.dispose(),
  };
}

export type OfficeEngine = ReturnType<typeof createOfficeEngine>;
