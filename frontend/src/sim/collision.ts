/**
 * Collision world + clearance queries for the arm.
 * Capsule model of the arm vs spheres (objects), boxes (table, tote), floor, and itself.
 */
import * as THREE from 'three';
import { ARM_CAPSULES, FRAME_COUNT, forwardKinematics, type BasePose } from './kinematics';

export interface WorldSphere {
  id: string;
  c: THREE.Vector3;
  r: number;
}

export interface WorldBox {
  id: string;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface CollisionWorld {
  spheres: WorldSphere[];
  boxes: WorldBox[];
  floorY: number;
}

export interface WorldObject {
  id: string;
  x: number;
  y: number;
  z: number;
  held?: boolean;
}

export interface WorldOptions {
  /** Object the gripper is allowed to touch (the grasp target). */
  allowId?: string | null;
  tableTopY: number;
}

const OBJECT_RADIUS = 0.04;

export function buildWorld(objects: WorldObject[], opts: WorldOptions): CollisionWorld {
  const spheres: WorldSphere[] = [];
  for (const o of objects) {
    if (o.held || o.id === opts.allowId) continue;
    spheres.push({ id: o.id, c: new THREE.Vector3(o.x, o.y, o.z), r: OBJECT_RADIUS });
  }
  const top = opts.tableTopY;
  return {
    spheres,
    floorY: 0,
    boxes: [
      // tabletop slab (1.3 x 0.03 x 0.9)
      { id: 'table', min: new THREE.Vector3(-0.65, top - 0.03, -0.45), max: new THREE.Vector3(0.65, top, 0.45) },
      // storage tote: 5 mm floor and four 5 mm walls, 0.035 high, centred at (-0.05, -0.24)
      { id: 'tote_floor', min: new THREE.Vector3(-0.14, top, -0.33), max: new THREE.Vector3(0.04, top + 0.005, -0.15) },
      { id: 'tote_wall', min: new THREE.Vector3(-0.14, top, -0.33), max: new THREE.Vector3(0.04, top + 0.035, -0.325) },
      { id: 'tote_wall', min: new THREE.Vector3(-0.14, top, -0.155), max: new THREE.Vector3(0.04, top + 0.035, -0.15) },
      { id: 'tote_wall', min: new THREE.Vector3(-0.14, top, -0.33), max: new THREE.Vector3(-0.135, top + 0.035, -0.15) },
      { id: 'tote_wall', min: new THREE.Vector3(0.035, top, -0.33), max: new THREE.Vector3(0.04, top + 0.035, -0.15) }
    ]
  };
}

// ---- geometry helpers (allocation-free) ----

function segPointDistSq(ax: number, ay: number, az: number, bx: number, by: number, bz: number, p: THREE.Vector3): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - ax) * abx + (p.y - ay) * aby + (p.z - az) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + abx * t - p.x;
  const dy = ay + aby * t - p.y;
  const dz = az + abz * t - p.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Squared distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection). */
function segSegDistSq(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-9;
  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const cx = p1.x + d1x * s - (p2.x + d2x * t);
  const cy = p1.y + d1y * s - (p2.y + d2y * t);
  const cz = p1.z + d1z * s - (p2.z + d2z * t);
  return cx * cx + cy * cy + cz * cz;
}

function sdBox(p: THREE.Vector3, box: WorldBox): number {
  const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2, cz = (box.min.z + box.max.z) / 2;
  const hx = (box.max.x - box.min.x) / 2, hy = (box.max.y - box.min.y) / 2, hz = (box.max.z - box.min.z) / 2;
  const qx = Math.abs(p.x - cx) - hx, qy = Math.abs(p.y - cy) - hy, qz = Math.abs(p.z - cz) - hz;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
}

const CAP_COUNT = ARM_CAPSULES.length;
const capA = Array.from({ length: CAP_COUNT }, () => new THREE.Vector3());
const capB = Array.from({ length: CAP_COUNT }, () => new THREE.Vector3());
const frames = Array.from({ length: FRAME_COUNT }, () => new THREE.Matrix4());
const sample = new THREE.Vector3();
const SAMPLES = 5;

/** Capsule endpoints in world space for a joint configuration (arrays reused between calls). */
export function armSegments(q: number[], base: BasePose): { a: THREE.Vector3[]; b: THREE.Vector3[] } {
  forwardKinematics(q, base, frames);
  for (let i = 0; i < CAP_COUNT; i++) {
    const c = ARM_CAPSULES[i];
    capA[i].set(...c.a).applyMatrix4(frames[c.frame]);
    capB[i].set(...c.b).applyMatrix4(frames[c.frame]);
  }
  return { a: capA, b: capB };
}

export interface ClearanceInfo {
  /** Smallest gap between the arm and anything else (m). Negative = penetration. */
  clearance: number;
  /** What the arm is closest to. */
  nearest: string;
}

const MIN_SELF_GAP = 3; // frames apart before two links are tested against each other

/**
 * Minimum signed distance from the arm to every obstacle (and to itself).
 * Finger pads use a thin `rBox` against the table so a grasp can skim the surface.
 */
export function armClearance(q: number[], base: BasePose, world: CollisionWorld): ClearanceInfo {
  armSegments(q, base);
  let best = Infinity;
  let nearest = 'none';
  const note = (d: number, what: string) => {
    if (d < best) {
      best = d;
      nearest = what;
    }
  };

  for (let i = 0; i < CAP_COUNT; i++) {
    const cap = ARM_CAPSULES[i];
    const a = capA[i];
    const b = capB[i];
    const rBox = cap.rBox ?? cap.r;

    for (const s of world.spheres) {
      const d = Math.sqrt(segPointDistSq(a.x, a.y, a.z, b.x, b.y, b.z, s.c)) - cap.r - s.r;
      note(d, `${cap.name}~${s.id}`);
    }

    // The base and shoulder are bolted to the table, so they are not tested against it.
    if (cap.frame > 1) {
      for (let k = 0; k <= SAMPLES; k++) {
        const t = k / SAMPLES;
        sample.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
        for (const box of world.boxes) note(sdBox(sample, box) - rBox, `${cap.name}~${box.id}`);
        note(sample.y - world.floorY - rBox, `${cap.name}~floor`);
      }
    }

    for (let j = i + 1; j < CAP_COUNT; j++) {
      const other = ARM_CAPSULES[j];
      if (Math.abs(other.frame - cap.frame) < MIN_SELF_GAP) continue;
      const d = Math.sqrt(segSegDistSq(a, b, capA[j], capB[j])) - cap.r - other.r;
      note(d, `${cap.name}~${other.name}`);
    }
  }
  return { clearance: best, nearest };
}

export const isCollisionFree = (q: number[], base: BasePose, world: CollisionWorld, margin = 0.003): boolean =>
  armClearance(q, base, world).clearance > margin;
