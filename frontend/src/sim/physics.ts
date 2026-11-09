/**
 * The simulated world's physical rules. These belong to the WORLD, not to the robot: the robot's control
 * code never calls them to decide anything. It acts (close the gripper, open the gripper) and the world
 * answers with what physically happened, which the robot can only observe through its sensors
 * (finger stroke) and its camera.
 */
import type { ObjectKind } from './objectMeshes';

/** Width of each object between the finger pads when grasped from above (m). */
export const GRASP_WIDTH: Record<ObjectKind, number> = {
  cube: 0.06,
  book: 0.022,
  ruler: 0.011,
  eraser: 0.02,
  can: 0.07,
  sphere: 0.07,
  orange: 0.072,
  apple: 0.072,
  tennis_ball: 0.067,
  mug: 0.076,
  glass: 0.065,
  pen: 0.0095,
  scissors: 0.012,
  stapler: 0.03
};

/** Overall height of each object lying/standing in its normal pose (m). */
export const OBJECT_HEIGHT: Record<ObjectKind, number> = {
  cube: 0.06, book: 0.022, ruler: 0.011, eraser: 0.02, can: 0.09, sphere: 0.07, orange: 0.072, apple: 0.072,
  tennis_ball: 0.067, mug: 0.085, glass: 0.11, pen: 0.011, scissors: 0.012, stapler: 0.03
};

export const GRIPPER_MAX_OPEN = 0.085; // total finger stroke (m)

/**
 * Where a dropped object comes to rest vertically: on its surface, or on top of whatever is already there.
 * `below` are the other objects lying in the same area; `ownHalf` is half its own height above the surface.
 */
export function settleHeight(
  surfaceY: number,
  ownHalf: number,
  x: number,
  z: number,
  below: { x: number; z: number; y: number; height: number }[]
): number {
  let top = surfaceY;
  for (const b of below) {
    if (Math.hypot(b.x - x, b.z - z) < 0.045) top = Math.max(top, b.y + b.height / 2);
  }
  return top + ownHalf;
}

export interface WorldObjectState {
  id: string;
  kind: ObjectKind;
  x: number;
  y: number;
  z: number;
}

/** How far off-centre the tool point may be and still close on the object (m). */
export function graspTolerance(width: number, opening: number): number {
  const slack = Math.max(0, (opening - width) / 2);
  return Math.min(0.035, Math.max(0.012, slack + 0.01));
}

/**
 * What does the gripper close on? The nearest object whose centre is inside the grasp envelope around the
 * tool point and which fits between the open fingers. Returns null if the fingers close on air.
 */
export function findGraspedObject(
  tcp: { x: number; y: number; z: number },
  objects: WorldObjectState[],
  opening: number
): { id: string; width: number; offset: number } | null {
  let best: { id: string; width: number; offset: number } | null = null;
  for (const o of objects) {
    const width = GRASP_WIDTH[o.kind];
    if (width > opening + 0.003) continue; // does not fit between the open fingers
    const horizontal = Math.hypot(o.x - tcp.x, o.z - tcp.z);
    const vertical = Math.abs(o.y - tcp.y);
    if (horizontal > graspTolerance(width, opening) || vertical > 0.035) continue;
    if (!best || horizontal < best.offset) best = { id: o.id, width, offset: horizontal };
  }
  return best;
}

// ---- where things come to rest ----

/** Storage tote interior (scene metres) and handover mat; both are fixtures of the workspace. */
export const TOTE = { x0: -0.135, x1: 0.035, z0: -0.325, z1: -0.155, floor: 0.005 };
export const MAT = { x0: -0.03, x1: 0.19, z0: 0.2, z1: 0.36, top: 0.004 };

export type RestRegion = 'tray' | 'user' | 'table';

export function dropRegion(x: number, z: number): RestRegion {
  if (x >= TOTE.x0 && x <= TOTE.x1 && z >= TOTE.z0 && z <= TOTE.z1) return 'tray';
  if (x >= MAT.x0 && x <= MAT.x1 && z >= MAT.z0 && z <= MAT.z1) return 'user';
  return 'table';
}

/** Height added to an object's table-resting height by the surface it lands on. */
export const restLift = (region: RestRegion): number => (region === 'tray' ? TOTE.floor : region === 'user' ? MAT.top : 0);

/**
 * Candidate drop spots inside the tote: a 2x2 grid spaced for 7 cm objects (a tennis ball or a mug fits each
 * quarter without touching its neighbours or the walls), then the middle, where later objects start to pile up.
 */
const TOTE_SLOTS = [
  { x: -0.092, z: -0.198 },
  { x: -0.008, z: -0.282 },
  { x: -0.008, z: -0.198 },
  { x: -0.092, z: -0.282 },
  { x: -0.05, z: -0.24 }
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
