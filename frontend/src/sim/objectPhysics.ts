/**
 * Physical description of every tabletop object kind: collision shapes (in the body frame, metres), mass,
 * friction and restitution. The body frame is the one the render mesh in objectMeshes.ts is modelled in, so
 * what is drawn and what collides are the same thing.
 *
 * This file has no DOM or renderer dependency, so the physics can be run and tested headlessly in Node.
 */
import { BOOK, objectKind, type ObjectKind } from './objectMeshes';

export type ShapeSpec =
  | { t: 'box'; h: [number, number, number]; round?: number }
  | { t: 'cyl'; hh: number; r: number }
  | { t: 'ball'; r: number }
  | { t: 'hull'; pts: number[] };

export interface ColliderSpec {
  shape: ShapeSpec;
  mass: number;
  pos?: [number, number, number];
  /** Euler XYZ rotation (rad). */
  rot?: [number, number, number];
}

export interface KindPhysics {
  colliders: ColliderSpec[];
  friction: number;
  restitution: number;
  /** Height of the body origin above the surface when the object rests in its normal pose. */
  restHalf: number;
  linDamp: number;
  /** Damping of spin in the air and while sliding (1/s). */
  angDamp: number;
  /**
   * Rolling-resistance coefficient (dimensionless) for things that roll: the deceleration while rolling on a
   * surface is about Crr x g. Rigid point contacts have none, so world.ts applies it. 0 = not applied.
   */
  rollCrr?: number;
  /** Yaw the object is given when it is put on the table. */
  spawnYaw: number;
}

/** Points of a profile (radius, y) revolved around Y. */
function revolve(profile: [number, number][], segments = 20): number[] {
  const pts: number[] = [];
  for (const [r, y] of profile) {
    if (r < 1e-6) {
      pts.push(0, y, 0);
      continue;
    }
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pts.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  return pts;
}

function appleProfile(): [number, number][] {
  const r = 0.036;
  const out: [number, number][] = [];
  for (let i = 1; i < 28; i += 3) {
    const t = (i / 28) * Math.PI;
    out.push([Math.sin(t) * r * (1 + 0.07 * Math.sin(t)), -Math.cos(t) * r * 0.92]);
  }
  return out;
}

/** Hexagonal prism along X (a pencil). */
function hexPrism(halfLen: number, radius: number): number[] {
  const pts: number[] = [];
  for (const x of [-halfLen, halfLen]) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pts.push(x, Math.cos(a) * radius, Math.sin(a) * radius);
    }
  }
  return pts;
}

const HALF_PI = Math.PI / 2;

export { BOOK };

const SPECS: Record<ObjectKind, KindPhysics> = {
  cube: {
    // 6 cm painted wooden block
    colliders: [{ shape: { t: 'box', h: [0.0255, 0.0255, 0.0255], round: 0.0045 }, mass: 0.13 }],
    friction: 0.5, restitution: 0.2, restHalf: 0.03, linDamp: 0.05, angDamp: 0.1, spawnYaw: 0
  },
  book: {
    colliders: [{ shape: { t: 'box', h: [BOOK.W / 2, BOOK.H / 2, BOOK.D / 2] }, mass: 0.11 }],
    friction: 0.6, restitution: 0.05, restHalf: BOOK.H / 2, linDamp: 0.05, angDamp: 0.1, spawnYaw: 0
  },
  ruler: {
    colliders: [{ shape: { t: 'box', h: [0.08, 0.0055, 0.013] }, mass: 0.04 }],
    friction: 0.4, restitution: 0.1, restHalf: 0.0055, linDamp: 0.05, angDamp: 0.1, spawnYaw: 0
  },
  eraser: {
    colliders: [{ shape: { t: 'box', h: [0.026, 0.0105, 0.0115] }, mass: 0.03 }],
    friction: 0.9, restitution: 0.3, restHalf: 0.0105, linDamp: 0.05, angDamp: 0.1, spawnYaw: 0
  },
  can: {
    // full 330 ml drinks can
    colliders: [{ shape: { t: 'cyl', hh: 0.045, r: 0.035 }, mass: 0.37 }],
    friction: 0.4, restitution: 0.1, restHalf: 0.045, linDamp: 0.05, angDamp: 0.35, rollCrr: 0.01, spawnYaw: 0
  },
  sphere: {
    colliders: [{ shape: { t: 'ball', r: 0.035 }, mass: 0.09 }],
    friction: 0.7, restitution: 0.78, restHalf: 0.035, linDamp: 0.05, angDamp: 0.05, rollCrr: 0.015, spawnYaw: 0
  },
  orange: {
    colliders: [{ shape: { t: 'ball', r: 0.036 }, mass: 0.2 }],
    friction: 0.6, restitution: 0.25, restHalf: 0.036, linDamp: 0.05, angDamp: 0.05, rollCrr: 0.06, spawnYaw: 0
  },
  apple: {
    colliders: [{ shape: { t: 'hull', pts: revolve(appleProfile(), 14) }, mass: 0.18 }],
    friction: 0.55, restitution: 0.2, restHalf: 0.0327, linDamp: 0.05, angDamp: 0.05, rollCrr: 0.08, spawnYaw: 0
  },
  tennis_ball: {
    colliders: [{ shape: { t: 'ball', r: 0.0335 }, mass: 0.058 }],
    friction: 0.65, restitution: 0.72, restHalf: 0.0335, linDamp: 0.05, angDamp: 0.05, rollCrr: 0.035, spawnYaw: 0
  },
  mug: {
    colliders: [
      // ceramic body. A true cylinder, not a faceted hull of the slightly tapered profile: a many-sided hull standing
      // on its base creeps across the table at 2-3 mm/s in this solver (measured), a cylinder stays put.
      { shape: { t: 'cyl', hh: 0.0425, r: 0.0372 }, mass: 0.3 },
      // handle: solid D-shaped hull around the tube
      { shape: { t: 'hull', pts: [0.034, 0.0318, 0.0058, 0.034, 0.0318, -0.0058, 0.034, -0.0318, 0.0058, 0.034, -0.0318, -0.0058, 0.058, 0.027, 0.0058, 0.058, 0.027, -0.0058, 0.058, -0.027, 0.0058, 0.058, -0.027, -0.0058, 0.0678, 0, 0.0058, 0.0678, 0, -0.0058] }, mass: 0.03 }
    ],
    friction: 0.45, restitution: 0.1, restHalf: 0.0425, linDamp: 0.05, angDamp: 0.35, spawnYaw: 0
  },
  glass: {
    // tumbler with water in it (rigid: the water does not slosh or spill)
    // Upright it stands on a short true cylinder (its base): a faceted hull standing on its base creeps across the
    // table in this solver. The tapered wall (57 mm at the base, 70 mm at the rim) is a smooth hull starting 1 mm
    // above the table, so it only touches when the glass lies on its side, along a line like a real tumbler.
    // (Three stacked cylinders were tried: lying down they rest on one step's edge and roll away like a wheel.)
    colliders: [
      { shape: { t: 'cyl', hh: 0.005, r: 0.0285 }, mass: 0.12, pos: [0, -0.05, 0] },
      { shape: { t: 'hull', pts: revolve([[0.0283, -0.054], [0.0292, -0.045], [0.035, 0.055]], 32) }, mass: 0.22 }
    ],
    friction: 0.4, restitution: 0.1, restHalf: 0.055, linDamp: 0.05, angDamp: 0.35, rollCrr: 0.015, spawnYaw: 0
  },
  pen: {
    colliders: [
      { shape: { t: 'cyl', hh: 0.058, r: 0.005 }, mass: 0.011, rot: [0, 0, HALF_PI] },
      // pocket clip: stops it rolling, as on a real pen
      { shape: { t: 'box', h: [0.013, 0.001, 0.0016] }, mass: 0.001, pos: [-0.04, 0.0062, 0] }
    ],
    friction: 0.4, restitution: 0.15, restHalf: 0.0053, linDamp: 0.05, angDamp: 0.6, spawnYaw: 0.4
  },
  scissors: {
    colliders: [
      { shape: { t: 'box', h: [0.0445, 0.0025, 0.004] }, mass: 0.02, pos: [0.0405 * Math.cos(0.18), -0.0005, -0.0405 * Math.sin(0.18)], rot: [0, 0.18, 0] },
      { shape: { t: 'box', h: [0.0445, 0.0025, 0.004] }, mass: 0.02, pos: [0.0405 * Math.cos(0.18), 0.0025, 0.0405 * Math.sin(0.18)], rot: [0, -0.18, 0] },
      { shape: { t: 'cyl', hh: 0.0042, r: 0.0162 }, mass: 0.01, pos: [-0.014, -0.002, 0.013] },
      { shape: { t: 'cyl', hh: 0.0042, r: 0.0162 }, mass: 0.01, pos: [-0.014, -0.002, -0.013] }
    ],
    friction: 0.4, restitution: 0.1, restHalf: 0.0062, linDamp: 0.05, angDamp: 0.2, spawnYaw: 0
  },
  sponge: {
    // 70 x 30 x 50 mm kitchen sponge; rigid here (and in Gazebo), the foam does not compress
    colliders: [{ shape: { t: 'box', h: [0.035, 0.015, 0.025] }, mass: 0.03 }],
    friction: 0.9, restitution: 0.05, restHalf: 0.015, linDamp: 0.05, angDamp: 0.1, spawnYaw: 0
  },
  stapler: {
    colliders: [
      { shape: { t: 'box', h: [0.016, 0.004, 0.055] }, mass: 0.12, pos: [0, -0.008, 0] },
      { shape: { t: 'box', h: [0.014, 0.009, 0.05] }, mass: 0.12, pos: [0, 0.006, -0.004], rot: [0.05, 0, 0] }
    ],
    friction: 0.5, restitution: 0.1, restHalf: 0.012, linDamp: 0.05, angDamp: 0.2, spawnYaw: 0
  }
};

const PENCIL: KindPhysics = {
  colliders: [{ shape: { t: 'hull', pts: hexPrism(0.062, 0.0037) }, mass: 0.006 }],
  friction: 0.5, restitution: 0.15, restHalf: 0.0033, linDamp: 0.05, angDamp: 0.6, spawnYaw: 0.4
};

export function physicsFor(obj: { name: string; shape: string }): KindPhysics {
  const kind = objectKind(obj);
  if (kind === 'pen' && obj.name.toLowerCase().includes('pencil')) return PENCIL;
  return SPECS[kind];
}

export const kindPhysics = (kind: ObjectKind): KindPhysics => SPECS[kind];
