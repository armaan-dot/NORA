/**
 * Workspace layout and object-database facts shared by the world and the robot.
 *
 * Nothing in here decides what physically happens: that is the rigid-body simulation in world.ts. These are the
 * fixture dimensions the workcell was built to (used to build the colliders, the meshes, the planner's obstacle
 * boxes and the camera's fixture mask), plus what the robot has been told about each kind of object.
 */
import type { ObjectKind } from './objectMeshes';
import { BOOK } from './objectPhysics';

/** Expected width between the finger pads when each kind is grasped across its narrow side (m). */
export const GRASP_WIDTH: Record<ObjectKind, number> = {
  cube: 0.06,
  book: BOOK.D,
  ruler: 0.026,
  eraser: 0.022,
  can: 0.07,
  sphere: 0.07,
  orange: 0.072,
  apple: 0.074,
  tennis_ball: 0.067,
  mug: 0.075,
  glass: 0.067,
  pen: 0.0095,
  scissors: 0.02,
  stapler: 0.03,
  sponge: 0.05
};

/** Overall height of each object lying/standing in its normal pose (m). */
export const OBJECT_HEIGHT: Record<ObjectKind, number> = {
  cube: 0.06, book: BOOK.H, ruler: 0.011, eraser: 0.021, can: 0.09, sphere: 0.07, orange: 0.072, apple: 0.066,
  tennis_ball: 0.067, mug: 0.085, glass: 0.11, pen: 0.011, scissors: 0.012, stapler: 0.027, sponge: 0.03
};

/** Parallel-jaw gripper: distance between the pads when fully open (m), and its drive limits. */
export const GRIPPER_MAX_OPEN = 0.085;
export const GRIPPER_SPEED = 0.11; // m/s, gap closing rate
export const GRIPPER_FORCE = 25; // N per finger

/** Finger geometry in the gripper frame (m): pads run from PAD_TOP_Z to the fingertip. */
export const FINGER_TIP_Z = 0.134;
export const FINGER_ROOT_Z = 0.082;

// ---- fixtures ----

/** Storage tote: open plastic bin, outer `size` square, `wall` thick, `wallH` tall, centred at (cx, cz). */
export const TOTE_GEOM = { cx: -0.03, cz: -0.28, size: 0.27, wall: 0.005, wallH: 0.04 };

const half = TOTE_GEOM.size / 2;
/** Tote interior (scene metres) and the handover mat. */
export const TOTE = {
  x0: TOTE_GEOM.cx - half + TOTE_GEOM.wall,
  x1: TOTE_GEOM.cx + half - TOTE_GEOM.wall,
  z0: TOTE_GEOM.cz - half + TOTE_GEOM.wall,
  z1: TOTE_GEOM.cz + half - TOTE_GEOM.wall,
  floor: TOTE_GEOM.wall
};
export const MAT = { x0: -0.03, x1: 0.19, z0: 0.2, z1: 0.36, top: 0.004 };
export const TABLE = { halfX: 0.65, halfZ: 0.45, thickness: 0.03 };

/** The tote's floor and four walls as boxes [x0, x1, y0, y1, z0, z1], heights relative to the table top. */
export function toteBoxes(): { name: string; box: [number, number, number, number, number, number] }[] {
  const { cx, cz, wall, wallH } = TOTE_GEOM;
  const x0 = cx - half, x1 = cx + half, z0 = cz - half, z1 = cz + half;
  return [
    { name: 'tote_floor', box: [x0, x1, 0, wall, z0, z1] },
    { name: 'tote_wall', box: [x0, x1, 0, wallH, z0, z0 + wall] },
    { name: 'tote_wall', box: [x0, x1, 0, wallH, z1 - wall, z1] },
    { name: 'tote_wall', box: [x0, x0 + wall, 0, wallH, z0, z1] },
    { name: 'tote_wall', box: [x1 - wall, x1, 0, wallH, z0, z1] }
  ];
}

export type RestRegion = 'tray' | 'user' | 'table';

export function dropRegion(x: number, z: number): RestRegion {
  if (x >= TOTE.x0 && x <= TOTE.x1 && z >= TOTE.z0 && z <= TOTE.z1) return 'tray';
  if (x >= MAT.x0 && x <= MAT.x1 && z >= MAT.z0 && z <= MAT.z1) return 'user';
  return 'table';
}

/** Height of each region's surface above the table top. */
export const restLift = (region: RestRegion): number => (region === 'tray' ? TOTE.floor : region === 'user' ? MAT.top : 0);

/**
 * Candidate drop spots inside the tote: a 2x2 grid, spaced so the open gripper fits between neighbours and the
 * walls, then the middle, where later objects start to pile up.
 */
const S = 0.065;
const TOTE_SLOTS = [
  { x: TOTE_GEOM.cx - S, z: TOTE_GEOM.cz + S },
  { x: TOTE_GEOM.cx + S, z: TOTE_GEOM.cz - S },
  { x: TOTE_GEOM.cx + S, z: TOTE_GEOM.cz + S },
  { x: TOTE_GEOM.cx - S, z: TOTE_GEOM.cz - S },
  { x: TOTE_GEOM.cx, z: TOTE_GEOM.cz }
];

/** The free spot furthest from what is already in the tote (as the robot believes it). */
export function chooseToteSlot(occupied: { x: number; z: number }[]): { x: number; z: number } {
  let best = TOTE_SLOTS[0];
  let bestGap = -1;
  for (const s of TOTE_SLOTS) {
    const gap = occupied.length ? Math.min(...occupied.map((o) => Math.hypot(o.x - s.x, o.z - s.z))) : Infinity;
    if (gap > bestGap) {
      bestGap = gap;
      best = s;
    }
  }
  return best;
}
