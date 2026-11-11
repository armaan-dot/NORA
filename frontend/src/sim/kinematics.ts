/**
 * UR5e-style arm kinematics shared by the planner, collision checker, IK and the 3D view.
 * The joint chain mirrors frontend/public/nora_arm.urdf exactly (verified by forward kinematics).
 */
import * as THREE from 'three';

export interface BasePose {
  x: number;
  y: number;
  z: number;
}

/** Closed-form IK constants (metres). Must match nora_arm.urdf. */
export const UR5E_GEOMETRY = {
  shoulderHeight: 0.1625, // base plate -> shoulder-lift axis (UR5e d1)
  upperArm: 0.425, // shoulder-lift -> elbow (UR5e a2)
  forearm: 0.3922, // elbow -> wrist 1 (UR5e a3)
  wristLateral: 0.1333, // wrist offset out of the arm plane (UR5e d4)
  wristForward: 0.0997, // wrist 1 -> wrist 2 axis (UR5e d5)
  toolDrop: 0.2136 // wrist 2 axis -> TCP between finger pads
};

/** URDF joint limits for joint1..joint6 (rad). */
export const JOINT_LIMITS: [number, number][] = [
  [-6.2832, 6.2832],
  [-6.2832, 6.2832],
  [-3.1416, 3.1416],
  [-6.2832, 6.2832],
  [-6.2832, 6.2832],
  [-6.2832, 6.2832]
];

const GRIPPER_MOUNT_Z = 0.039;
export const TCP_OFFSET_Z = 0.115; // TCP between finger pads, in gripper_link

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);
const _rot = new THREE.Matrix4();

const makeOrigin = (xyz: [number, number, number], rx = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...xyz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0, 'ZYX')),
    new THREE.Vector3(1, 1, 1)
  );

const JOINT_DEFS = [
  { origin: makeOrigin([0, 0, 0.086]), axis: new THREE.Vector3(0, 0, 1) },
  { origin: makeOrigin([0, 0, 0.0765]), axis: new THREE.Vector3(0, 1, 0) },
  { origin: makeOrigin([0, 0, 0.425]), axis: new THREE.Vector3(0, 1, 0) },
  { origin: makeOrigin([0, 0, 0.3922]), axis: new THREE.Vector3(0, 1, 0) },
  { origin: makeOrigin([0, 0.1333, 0.0997]), axis: new THREE.Vector3(0, 0, 1) },
  { origin: makeOrigin([0, 0.0596, 0], -Math.PI / 2), axis: new THREE.Vector3(0, 0, 1) }
];
const GRIPPER_MOUNT = makeOrigin([0, 0, GRIPPER_MOUNT_Z]);

/** Rotation axis of joint i, in the frame of link i+1 (the frame forwardKinematics returns at index i+1). */
export const JOINT_AXES: THREE.Vector3[] = JOINT_DEFS.map((d) => d.axis.clone());

/** Frames: 0 base_link, 1..6 link1..link6, 7 gripper_link (scene coordinates). */
export const FRAME_COUNT = 8;
const SHARED_FRAMES: THREE.Matrix4[] = Array.from({ length: FRAME_COUNT }, () => new THREE.Matrix4());

/**
 * Forward kinematics. The returned array is reused between calls unless you pass `out`;
 * copy anything you need to keep.
 */
export function forwardKinematics(q: number[], base: BasePose, out: THREE.Matrix4[] = SHARED_FRAMES): THREE.Matrix4[] {
  out[0].compose(_pos.set(base.x, base.y, base.z), _quat.setFromEuler(_euler.set(-Math.PI / 2, 0, 0)), _one);
  for (let i = 0; i < 6; i++) {
    out[i + 1].copy(out[i]).multiply(JOINT_DEFS[i].origin).multiply(_rot.makeRotationAxis(JOINT_DEFS[i].axis, q[i]));
  }
  out[7].copy(out[6]).multiply(GRIPPER_MOUNT);
  return out;
}

export function tcpPosition(q: number[], base: BasePose, target = new THREE.Vector3()): THREE.Vector3 {
  const frames = forwardKinematics(q, base);
  return target.set(0, 0, TCP_OFFSET_Z).applyMatrix4(frames[7]);
}

/** Closed-form IK with the tool pointing straight down. Returns [pan, lift, elbow, wrist1, wrist2, wrist3]. */
export function solveIK(tx: number, ty: number, tz: number, base: BasePose): number[] {
  const { shoulderHeight, upperArm, forearm, wristLateral, wristForward, toolDrop } = UR5E_GEOMETRY;

  // Robot frame: +X = scene +X, +Y = scene -Z, +Z = up.
  const rx = tx - base.x;
  const ry = -(tz - base.z);
  const rz = ty - base.y;

  // The wrist sits wristLateral off the arm plane, so the pan angle leads the target bearing.
  const rho = Math.max(wristLateral + 0.02, Math.hypot(rx, ry));
  const R = Math.sqrt(rho * rho - wristLateral * wristLateral);
  const pan = Math.atan2(ry, rx) - Math.atan2(wristLateral, R);

  const wx = R - wristForward;
  const wz = rz + toolDrop - shoulderHeight;
  const maxReach = upperArm + forearm - 0.005;
  const minReach = Math.abs(upperArm - forearm) + 0.03;
  const D = Math.min(maxReach, Math.max(minReach, Math.hypot(wx, wz)));

  const cosElbow = (D * D - upperArm * upperArm - forearm * forearm) / (2 * upperArm * forearm);
  const elbow = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
  const lift = Math.atan2(wx, wz) - Math.atan2(forearm * Math.sin(elbow), upperArm + forearm * Math.cos(elbow));

  const wrist1 = Math.PI / 2 - lift - elbow;
  return [pan, lift, elbow, wrist1, -Math.PI / 2, 0];
}

export interface ReachResult {
  reachable: boolean;
  /** Distance between the requested point and where the arm's TCP actually ends up (m). */
  error: number;
  /** Horizontal distance from the base axis (m). */
  radius: number;
  joints: number[];
}

/** A point is reachable if IK's solution, run through forward kinematics, lands on it and respects joint limits. */
export function checkReach(tx: number, ty: number, tz: number, base: BasePose): ReachResult {
  const joints = solveIK(tx, ty, tz, base);
  const tcp = tcpPosition(joints, base);
  const error = tcp.distanceTo(_pos.set(tx, ty, tz));
  const inLimits = joints.every((v, i) => v >= JOINT_LIMITS[i][0] && v <= JOINT_LIMITS[i][1]);
  return { reachable: error < 0.01 && inLimits, error, radius: Math.hypot(tx - base.x, tz - base.z), joints };
}

/** Farthest table-level point (tool down) the arm can reach, found numerically from the kinematics. */
export function computeMaxTableReach(): number {
  const base = { x: 0, y: 0.45, z: 0 };
  let best = 0;
  for (let d = 0.2; d <= 1.2; d += 0.005) {
    if (checkReach(d, base.y + 0.03, 0, base).reachable) best = d;
    else if (best > 0) break;
  }
  return Math.floor(best * 100) / 100;
}

export const MAX_TABLE_REACH = computeMaxTableReach();

/** Lowest TCP height above a surface for a grasp: the fingertips (19 mm below the TCP) stay 2 mm clear of it (m). */
export const GRASP_MIN_TCP_HEIGHT = 0.021;

/** UR5e joint speed limits (rad/s) and the acceleration limits the controller plans within (rad/s^2). */
export const JOINT_MAX_VELOCITY = [3.14, 3.14, 3.14, 3.14, 3.14, 3.14];
export const JOINT_MAX_ACCELERATION = [8, 8, 10, 16, 16, 16];

/** UR5e rated joint torques (N m): size-3 drives on the base, shoulder and elbow, size-1 on the wrists. */
export const JOINT_MAX_TORQUE = [150, 150, 150, 28, 28, 28];

/** UR5e link masses (kg) for links 1..6 (published dynamics parameters), and the gripper (frame 7, a 2F-85 class gripper). */
export const LINK_MASSES = [3.761, 8.058, 2.846, 1.37, 1.3, 0.365, 0.925];

/**
 * Inertia the motor sees through its gearbox even with no load (kg m^2): rotor inertia times the gear ratio squared.
 * Not published by UR; these are typical for 100:1 harmonic drives of these sizes. Documented approximation.
 */
export const JOINT_REFLECTED_INERTIA = [1.5, 1.5, 1.0, 0.25, 0.25, 0.25];

const _jaw = new THREE.Vector3();

/** World direction of the gripper's jaw axis (the line the fingers move along), as an angle atan2(z, x). */
export function jawYaw(q: number[], base: BasePose): number {
  const frames = forwardKinematics(q, base);
  _jaw.set(1, 0, 0).transformDirection(frames[7]);
  return Math.atan2(_jaw.z, _jaw.x);
}

/**
 * Wrist-3 angle that lines the jaw axis up with `yaw` (atan2(z, x) in the scene) for a tool-down pose `q`.
 * The jaw is symmetric, so the smaller of the two equivalent rotations is returned.
 */
export function wristForJawYaw(q: number[], base: BasePose, yaw: number, near = 0): number {
  const q0 = [q[0], q[1], q[2], q[3], q[4], 0];
  const a0 = jawYaw(q0, base);
  q0[5] = 0.1;
  const sign = Math.sin(jawYaw(q0, base) - a0) >= 0 ? 1 : -1; // which way wrist 3 turns the jaw
  const d = sign * (yaw - a0) - near;
  return near + ((((d + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2;
}

/**
 * Joint waypoints that carry the TCP along a straight line in space with the tool pointing down (a joint-space
 * interpolation between the two end poses would bow sideways by centimetres). `yaw` fixes the jaw direction in
 * the scene; null keeps wrist 3 at `wrist`.
 */
export function linePath(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  base: BasePose,
  yaw: number | null,
  wrist = 0,
  spacing = 0.01
): number[][] {
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / spacing));
  const out: number[][] = [];
  let prev = wrist;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const q = solveIK(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t, base);
    q[5] = yaw === null ? wrist : wristForJawYaw(q, base, yaw, prev);
    prev = q[5];
    out.push(q);
  }
  return out;
}

/** Collision capsules in link-local coordinates (metres). `rBox` is the (smaller) radius used against the table, tote and floor. */
export interface LocalCapsule {
  name: string;
  frame: number;
  a: [number, number, number];
  b: [number, number, number];
  r: number;
  rBox?: number;
}

export const ARM_CAPSULES: LocalCapsule[] = [
  { name: 'base', frame: 0, a: [0, 0, 0], b: [0, 0, 0.086], r: 0.085 },
  { name: 'shoulder', frame: 1, a: [0, 0, 0], b: [0, 0, 0.0765], r: 0.075 },
  { name: 'shoulder_drum', frame: 2, a: [0, 0.085, 0], b: [0, 0.155, 0], r: 0.075 },
  { name: 'upper_arm', frame: 2, a: [0, 0.12, 0.05], b: [0, 0.12, 0.425], r: 0.055 },
  { name: 'elbow_outer', frame: 2, a: [0, 0.035, 0.425], b: [0, 0.155, 0.425], r: 0.06 },
  { name: 'elbow_inner', frame: 3, a: [0, -0.03, 0], b: [0, 0.03, 0], r: 0.06 },
  { name: 'forearm', frame: 3, a: [0, 0, 0.05], b: [0, 0, 0.3922], r: 0.042 },
  { name: 'wrist1', frame: 4, a: [0, 0, 0], b: [0, 0.1333, 0], r: 0.045 },
  { name: 'wrist1_riser', frame: 4, a: [0, 0.1333, 0], b: [0, 0.1333, 0.0997], r: 0.045 },
  { name: 'wrist2', frame: 5, a: [0, 0, -0.02], b: [0, 0.0596, 0], r: 0.045 },
  { name: 'wrist3', frame: 6, a: [0, 0, 0], b: [0, 0, GRIPPER_MOUNT_Z], r: 0.045 },
  { name: 'gripper_body', frame: 7, a: [0, 0, 0.01], b: [0, 0, 0.04], r: 0.04 },
  // Two thin finger pads on the jaw axis (open stroke ~0.1 m). They may skim the table during a grasp.
  { name: 'finger_l', frame: 7, a: [-0.05, 0, 0.082], b: [-0.05, 0, 0.134], r: 0.014, rBox: 0.002 },
  { name: 'finger_r', frame: 7, a: [0.05, 0, 0.082], b: [0.05, 0, 0.134], r: 0.014, rBox: 0.002 }
];
