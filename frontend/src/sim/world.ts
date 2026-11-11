/**
 * THE PHYSICAL WORLD: a rigid-body simulation (Rapier, fixed 240 Hz step) of the workcell.
 *
 *   - Objects are dynamic rigid bodies with mass, friction and restitution. Nothing places or carries them except
 *     contact forces and gravity: a grasp holds because the finger pads squeeze and friction resists the weight.
 *   - The arm's six joints are servo axes with velocity and acceleration limits that track a time-parameterised
 *     trajectory. The links are moved by those joint angles and push whatever they touch.
 *   - The two fingers are dynamic bodies on prismatic joints, driven by a position motor with a force limit, so
 *     they stop on whatever is between them and keep squeezing with a bounded force.
 *
 * The robot's software never reads object poses from here. It gets joint encoders, the finger gap, the finger
 * drive effort, and camera images rendered from these poses. Pose getters exist for the renderer and the UI.
 *
 * No DOM or renderer dependency: the same world runs headlessly in Node for tests.
 */
import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { ARM_CAPSULES, FRAME_COUNT, JOINT_AXES, JOINT_MAX_ACCELERATION, JOINT_MAX_TORQUE, JOINT_MAX_VELOCITY, JOINT_REFLECTED_INERTIA, LINK_MASSES, TCP_OFFSET_Z, forwardKinematics, type BasePose } from './kinematics';
import { samplePath } from './planner';
import { physicsFor, type KindPhysics, type ShapeSpec } from './objectPhysics';
import { FINGER_ROOT_Z, GRIPPER_FORCE, GRIPPER_MAX_OPEN, GRIPPER_SPEED, MAT, TABLE, dropRegion, restLift, toteBoxes } from './physics';

type Rapier = typeof RAPIER_NS;

export const SIM_DT = 1 / 240;
const MAX_SUBSTEPS = 24; // per rendered frame; beyond this the simulation runs slower than real time rather than skipping

// collision groups
const G_OBJ = 0x1, G_ARM = 0x2, G_FINGER = 0x4, G_FIX = 0x8;
const groups = (member: number, filter: number) => ((member << 16) | filter) >>> 0;

// joint servo (critically damped position loop with velocity feed-forward)
const SERVO_KP = 900; // 1/s^2  (30 rad/s bandwidth)
const SERVO_KD = 60; // 1/s
const SERVO_ACCEL_HEADROOM = 2;

// finger drive
const FINGER_K = 9000; // N/m
const FINGER_C = 55; // N s/m
const FINGER_STALL_FORCE = 140; // N, what the drive can physically deliver

// the user's hand when dragging an object with the mouse
const HAND_SPEED = 0.4; // m/s
const HAND_FORCE = 15; // N
/** Distance from a finger body's origin to its pad face (m): the gap between the pads is (xR - xL) - 2 * this. */
const PAD_FACE = 0.0055;

export interface ObjectPose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface TrajectoryResult {
  completed: boolean;
  /** Planned duration (s) and how long it actually took in simulated time. */
  planned: number;
  elapsed: number;
  /** Largest joint tracking error during the motion (rad). */
  peakError: number;
  /** Largest |torque| / rated torque reached by any joint during the motion (1 = at its limit). */
  peakTorqueRatio: number;
  /** Joints that hit their torque limit for longer than a few milliseconds (0-based index). */
  saturated: number[];
}

interface SimObject {
  id: string;
  body: RAPIER_NS.RigidBody;
  colliders: RAPIER_NS.Collider[];
  spec: KindPhysics;
  drag: { x: number; z: number } | null;
  /** True for things that roll (rolling resistance is applied while they touch a surface). */
  rollCrr: number;
}

interface Trajectory {
  path: number[][];
  T: number;
  t: number;
  goal: number[];
  prevRef: number[];
  peakError: number;
  peakTorqueRatio: number;
  saturatedSteps: number[];
  shouldAbort?: () => boolean;
  resolve: (r: TrajectoryResult) => void;
}

interface Waiter {
  pred: () => boolean;
  deadline: number;
  resolve: (ok: boolean) => void;
}


const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class PhysicsWorld {
  private R!: Rapier;
  private world!: RAPIER_NS.World;
  isReady = false;
  readonly ready: Promise<void>;
  private readyResolve!: () => void;
  private initStarted = false;

  /** Simulated time (s). */
  time = 0;
  steps = 0;
  /** Smoothed cost of one physics step (ms) and the ratio of simulated to wall-clock time. */
  stepMs = 0;
  realTimeFactor = 1;

  private base: BasePose = { x: -0.35, y: 0.45, z: -0.05 };
  private readonly frames = Array.from({ length: FRAME_COUNT }, () => new THREE.Matrix4());
  private linkBodies: RAPIER_NS.RigidBody[] = [];
  private readonly linkQuat = Array.from({ length: FRAME_COUNT }, () => new THREE.Quaternion());
  private fingerL!: RAPIER_NS.RigidBody;
  private fingerR!: RAPIER_NS.RigidBody;
  private jointL!: RAPIER_NS.PrismaticImpulseJoint;
  private jointR!: RAPIER_NS.PrismaticImpulseJoint;
  private padL!: RAPIER_NS.Collider;
  private padR!: RAPIER_NS.Collider;
  private events!: RAPIER_NS.EventQueue;
  // fingertip force sensors (filtered): squeeze on each pad, and the load carried across both pads
  private padSqueeze: [number, number] = [0, 0];
  private padCarried = new THREE.Vector3();
  private padFree = false;
  private padTouch: [boolean, boolean] = [false, false];
  private padSupported = false;
  private padContact = false;
  private padSlipSpeed = 0;
  private lastVel = new Map<number, { x: number; y: number; z: number }>();

  // arm joint state (what the encoders read)
  private q = [-0.37, -0.35, 1.9, 0.02, -Math.PI / 2, 0];
  private qd = [0, 0, 0, 0, 0, 0];
  private hold = [...this.q];
  // joint drive torques (N m) applied last step, and which joints were at their torque limit
  private tau = [0, 0, 0, 0, 0, 0];
  private tauSat = [false, false, false, false, false, false];
  // per-link centre of mass in its own frame, from the collision capsules
  private readonly linkCom: THREE.Vector3[] = Array.from({ length: FRAME_COUNT }, (_, f) => {
    const caps = ARM_CAPSULES.filter((c) => c.frame === f);
    if (f === 7) return new THREE.Vector3(0, 0, 0.065);
    const c = new THREE.Vector3();
    for (const k of caps) c.add(new THREE.Vector3(...k.a).add(new THREE.Vector3(...k.b)).multiplyScalar(0.5));
    return caps.length ? c.multiplyScalar(1 / caps.length) : c;
  });
  private traj: Trajectory | null = null;

  // gripper drive
  private gripGoal = 0.03;
  private gripCmd = 0.03;
  private gripForce = GRIPPER_FORCE;
  private gapNow = 0.03;
  private gapRate = 0;
  private fingerX: [number, number] = [0, 0];

  private objects = new Map<string, SimObject>();
  private waiters: Waiter[] = [];
  private timers: { at: number; cb: () => void }[] = [];
  private frameListeners = new Set<() => void>();
  private accumulator = 0;
  private lastWall = 0;
  private lastAdvance = 0;

  constructor() {
    this.ready = new Promise((res) => (this.readyResolve = res));
  }

  // -------------------------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------------------------

  async init(base?: BasePose): Promise<void> {
    if (this.initStarted) return this.ready;
    this.initStarted = true;
    if (base) this.base = { ...base };
    const mod = await import('@dimforge/rapier3d-compat');
    const R = ((mod as unknown as { default?: Rapier }).default ?? mod) as Rapier;
    await R.init();
    this.R = R;
    const world = new R.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = SIM_DT;
    // Solver settings found by test (scripts/physics-test.ts): with fewer inner iterations a pinched object creeps
    // out of the fingers at mm/s, and with the default (soft) contact frequency a 20 N squeeze sinks millimetres into
    // a light object instead of stopping on its surface.
    world.integrationParameters.numSolverIterations = 8;
    world.integrationParameters.numInternalPgsIterations = 12;
    world.integrationParameters.contact_natural_frequency = 240;
    world.integrationParameters.lengthUnit = 0.1; // objects are ~10 cm: scales contact slop and sleep thresholds
    this.world = world;
    this.events = new R.EventQueue(true);
    this.buildFixtures();
    this.buildArm();
    this.isReady = true;
    this.readyResolve();
  }

  private buildFixtures(): void {
    const { R, world } = this;
    const top = this.base.y;
    const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
    const add = (hx: number, hy: number, hz: number, x: number, y: number, z: number, friction: number, restitution = 0.05) =>
      world.createCollider(
        R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction).setRestitution(restitution).setCollisionGroups(groups(G_FIX, G_OBJ | G_FINGER)),
        fixed
      );
    add(7, 0.05, 7, 0, -0.05, 0, 0.7); // concrete floor
    add(TABLE.halfX, TABLE.thickness / 2, TABLE.halfZ, 0, top - TABLE.thickness / 2, 0, 0.5); // laminate tabletop
    for (const { box } of toteBoxes()) {
      const [x0, x1, y0, y1, z0, z1] = box;
      add((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, (x0 + x1) / 2, top + (y0 + y1) / 2, (z0 + z1) / 2, 0.4);
    }
    // rubber handover mat
    add((MAT.x1 - MAT.x0) / 2, MAT.top / 2, (MAT.z1 - MAT.z0) / 2, (MAT.x0 + MAT.x1) / 2, top + MAT.top / 2, (MAT.z0 + MAT.z1) / 2, 0.9);
  }

  private buildArm(): void {
    const { R, world } = this;
    forwardKinematics(this.q, this.base, this.frames);
    for (let f = 0; f < FRAME_COUNT; f++) {
      this.frames[f].decompose(_p, _q, _s);
      this.linkQuat[f].copy(_q);
      this.linkBodies.push(world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(_p.x, _p.y, _p.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })));
    }
    const armGroups = groups(G_ARM, G_OBJ);
    for (const cap of ARM_CAPSULES) {
      if (cap.frame === 7) continue; // the gripper is modelled with its real boxes below
      const a = new THREE.Vector3(...cap.a);
      const b = new THREE.Vector3(...cap.b);
      const dir = b.clone().sub(a);
      const len = dir.length();
      const rot = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, len > 1e-6 ? dir.normalize() : Y_AXIS);
      const mid = a.add(b).multiplyScalar(0.5);
      world.createCollider(
        R.ColliderDesc.capsule(len / 2, cap.r).setTranslation(mid.x, mid.y, mid.z).setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }).setFriction(0.3).setCollisionGroups(armGroups),
        this.linkBodies[cap.frame]
      );
    }
    // gripper body and the camera housing bolted to it (gripper_link frame)
    const palm = this.linkBodies[7];
    world.createCollider(R.ColliderDesc.cuboid(0.039, 0.022, 0.039).setTranslation(0, 0, 0.039).setFriction(0.3).setCollisionGroups(armGroups), palm);
    world.createCollider(R.ColliderDesc.cuboid(0.055, 0.015, 0.0025).setTranslation(0, 0, 0.0795).setFriction(0.3).setCollisionGroups(armGroups), palm);
    world.createCollider(R.ColliderDesc.cuboid(0.045, 0.012, 0.012).setTranslation(0, -0.036, 0.042).setFriction(0.3).setCollisionGroups(armGroups), palm);

    // fingers: dynamic bodies sliding on the jaw axis
    const fingerGroups = groups(G_FINGER, G_OBJ | G_FIX);
    const makeFinger = (side: -1 | 1) => {
      const x = side * (PAD_FACE + this.gripCmd / 2);
      _v.set(x, 0, FINGER_ROOT_Z).applyMatrix4(this.frames[7]);
      this.frames[7].decompose(_p, _q, _s);
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic().setTranslation(_v.x, _v.y, _v.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }).setCanSleep(false).setCcdEnabled(true)
      );
      // finger bar, then the rubber pad on its inner face (runs down to the fingertip)
      world.createCollider(R.ColliderDesc.cuboid(0.006, 0.015, 0.026).setTranslation(side * 0.004, 0, 0.026).setMass(0.06).setFriction(0.5).setCollisionGroups(fingerGroups), body);
      const pad = world.createCollider(
        R.ColliderDesc.cuboid(0.002, 0.013, 0.018)
          .setTranslation(-side * 0.0035, 0, 0.034)
          .setMass(0.01)
          .setFriction(1.6)
          .setFrictionCombineRule(R.CoefficientCombineRule.Max)
          .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(0)
          .setCollisionGroups(fingerGroups),
        body
      );
      const joint = world.createImpulseJoint(R.JointData.prismatic({ x: 0, y: 0, z: FINGER_ROOT_Z }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), palm, body, true) as RAPIER_NS.PrismaticImpulseJoint;
      const lo = PAD_FACE;
      const hi = PAD_FACE + GRIPPER_MAX_OPEN / 2 + 0.0005;
      joint.setLimits(side < 0 ? -hi : lo, side < 0 ? -lo : hi);
      joint.configureMotorModel(R.MotorModel.ForceBased);
      joint.configureMotorPosition(x, FINGER_K, FINGER_C);
      joint.setMotorMaxForce(FINGER_STALL_FORCE);
      return { body, pad, joint };
    };
    const l = makeFinger(-1);
    const r = makeFinger(1);
    this.fingerL = l.body;
    this.fingerR = r.body;
    this.padL = l.pad;
    this.padR = r.pad;
    this.jointL = l.joint;
    this.jointR = r.joint;
    this.fingerX = [-(PAD_FACE + this.gripCmd / 2), PAD_FACE + this.gripCmd / 2];
    this.gapNow = this.gripCmd;
  }

  // -------------------------------------------------------------------------------------------
  // Clock
  // -------------------------------------------------------------------------------------------

  /** Drive the simulation from the display refresh (with a timer fallback while the tab is hidden). Browser only. */
  start(): void {
    if (typeof window === 'undefined' || this.lastWall) return;
    this.lastWall = performance.now();
    const tick = () => {
      const now = performance.now();
      this.advance((now - this.lastWall) / 1000);
      this.lastWall = now;
    };
    const loop = () => {
      tick();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    setInterval(() => {
      if (performance.now() - this.lastWall > 120) tick();
    }, 50);
  }

  /** Advance by a wall-clock interval using fixed steps. */
  advance(wallDt: number): void {
    if (!this.isReady) return;
    this.accumulator += Math.min(Math.max(wallDt, 0), 0.25);
    let n = Math.floor(this.accumulator / SIM_DT);
    if (n > MAX_SUBSTEPS) {
      n = MAX_SUBSTEPS;
      this.accumulator = 0;
    } else this.accumulator -= n * SIM_DT;
    if (wallDt > 0) this.realTimeFactor += ((n * SIM_DT) / wallDt - this.realTimeFactor) * 0.05;
    if (n > 0) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) this.step();
      this.stepMs += ((performance.now() - t0) / n - this.stepMs) * 0.1;
    }
    this.lastAdvance = n;
    this.frameListeners.forEach((cb) => cb());
  }

  /** One fixed step. */
  step(): void {
    const dt = SIM_DT;
    this.stepServo(dt);
    forwardKinematics(this.q, this.base, this.frames);
    for (let f = 0; f < FRAME_COUNT; f++) {
      this.frames[f].decompose(_p, _q, _s);
      // q and -q are the same orientation, but a sign flip between steps would read as a full turn in one step
      const last = this.linkQuat[f];
      if (last.dot(_q) < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
      last.copy(_q);
      this.linkBodies[f].setNextKinematicTranslation(_p);
      this.linkBodies[f].setNextKinematicRotation(_q);
    }
    this.stepGripper(dt);
    for (const o of this.objects.values()) {
      if (o.drag) this.stepHand(o, dt);
      else if (o.rollCrr > 0) this.stepRolling(o, dt);
    }
    this.world.step(this.events);
    this.readPads();
    this.time += dt;
    this.steps++;
    this.readFingers(dt);
    this.runWaiters();
  }

  private stepServo(dt: number): void {
    const tr = this.traj;
    let ref = this.hold;
    let refVel: number[] | null = null;
    if (tr) {
      if (tr.shouldAbort?.()) {
        this.endTrajectory(false);
      } else {
        tr.t += dt;
        const tau = Math.min(1, tr.t / tr.T);
        const s = (1 - Math.cos(Math.PI * tau)) / 2;
        ref = samplePath(tr.path, s);
        refVel = ref.map((v, i) => (v - tr.prevRef[i]) / dt);
        tr.prevRef = ref;
      }
    }
    let err = 0;
    let speed = 0;
    const dyn = this.jointDynamics();
    let ratio = 0;
    for (let i = 0; i < 6; i++) {
      const aMax = JOINT_MAX_ACCELERATION[i] * SERVO_ACCEL_HEADROOM;
      let acc = SERVO_KP * (ref[i] - this.q[i]) + SERVO_KD * ((refVel ? refVel[i] : 0) - this.qd[i]);
      acc = Math.max(-aMax, Math.min(aMax, acc));
      // The drive has to supply inertia x acceleration and cancel the load torque (gravity on the links and on
      // whatever the fingers carry). It cannot exceed its rated torque: if it would, the joint gets only what the
      // remaining torque buys, and a load beyond the rating drags the joint backwards.
      let motor = dyn.inertia[i] * acc - dyn.load[i];
      const lim = JOINT_MAX_TORQUE[i];
      this.tauSat[i] = Math.abs(motor) > lim;
      motor = Math.max(-lim, Math.min(lim, motor));
      this.tau[i] = motor;
      ratio = Math.max(ratio, Math.abs(motor) / lim);
      acc = (motor + dyn.load[i]) / dyn.inertia[i];
      if (this.traj && this.tauSat[i]) this.traj.saturatedSteps[i]++;
      this.qd[i] = Math.max(-JOINT_MAX_VELOCITY[i], Math.min(JOINT_MAX_VELOCITY[i], this.qd[i] + acc * dt));
      this.q[i] += this.qd[i] * dt;
      err = Math.max(err, Math.abs(ref[i] - this.q[i]));
      speed = Math.max(speed, Math.abs(this.qd[i]));
    }
    if (this.traj) {
      const t = this.traj;
      t.peakError = Math.max(t.peakError, err);
      t.peakTorqueRatio = Math.max(t.peakTorqueRatio, ratio);
      if (t.t >= t.T) {
        let goalErr = 0;
        for (let i = 0; i < 6; i++) goalErr = Math.max(goalErr, Math.abs(t.goal[i] - this.q[i]));
        if ((goalErr < 0.0015 && speed < 0.02) || t.t > t.T + 1.5) {
          this.hold = [...t.goal];
          this.endTrajectory(true);
        }
      }
    }
  }

  /**
   * Rigid-body statics of the arm at the current pose: for each joint, the torque gravity (on the links beyond it
   * and on the load the fingers carry) applies about its axis, and the inertia it has to accelerate (links as point
   * masses at their centres of mass, plus reflected motor inertia). Velocity-product (Coriolis) terms are ignored:
   * at these speeds they are a few percent of gravity. The carried load comes from the finger contacts (readPads).
   */
  private jointDynamics(): { load: number[]; inertia: number[] } {
    const frames = forwardKinematics(this.q, this.base, this.frames);
    const com = this.linkCom.map((c, f) => c.clone().applyMatrix4(frames[f]));
    const tcp = new THREE.Vector3(0, 0, TCP_OFFSET_Z).applyMatrix4(frames[7]);
    // force the carried object exerts on the gripper = -(force the pads exert on it), when the pads carry it alone
    const payloadForce = this.padFree ? this.padCarried.clone().multiplyScalar(-1) : new THREE.Vector3();
    const payloadMass = this.padFree ? Math.max(0, this.padCarried.y) / 9.81 : 0;
    const load: number[] = [];
    const inertia: number[] = [];
    const g = new THREE.Vector3();
    const r = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      const axis = JOINT_AXES[i].clone().transformDirection(frames[i + 1]);
      const p = new THREE.Vector3().setFromMatrixPosition(frames[i + 1]);
      let tq = 0;
      let I = JOINT_REFLECTED_INERTIA[i];
      for (let f = i + 1; f < FRAME_COUNT; f++) {
        const m = LINK_MASSES[f - 1];
        r.copy(com[f]).sub(p);
        tq += g.set(0, -9.81 * m, 0).cross(r).multiplyScalar(-1).dot(axis); // (r x F) . axis
        I += m * r.clone().cross(axis).lengthSq();
      }
      r.copy(tcp).sub(p);
      tq += r.clone().cross(payloadForce).dot(axis);
      I += payloadMass * r.clone().cross(axis).lengthSq();
      load.push(tq);
      inertia.push(I);
    }
    return { load, inertia };
  }

  /** Joint drive torques (N m) applied in the last step: what joint torque sensors would read. */
  get jointEfforts(): number[] {
    return [...this.tau];
  }

  /** Joints whose drive was at its torque limit in the last step. */
  get jointSaturation(): boolean[] {
    return [...this.tauSat];
  }

  private endTrajectory(completed: boolean): void {
    const t = this.traj;
    if (!t) return;
    this.traj = null;
    if (!completed) {
      // brake: come to rest where the joints can actually stop
      this.hold = this.q.map((v, i) => v + (this.qd[i] * Math.abs(this.qd[i])) / (2 * JOINT_MAX_ACCELERATION[i] * SERVO_ACCEL_HEADROOM));
    }
    const saturated = t.saturatedSteps.map((n, i) => (n * SIM_DT > 0.02 ? i : -1)).filter((i) => i >= 0);
    t.resolve({ completed, planned: t.T, elapsed: t.t, peakError: t.peakError, peakTorqueRatio: t.peakTorqueRatio, saturated });
  }

  private stepGripper(dt: number): void {
    // The two fingers are one mechanism: their targets are always symmetric about the gripper axis, which is what
    // centres a grasp. The drive ramps the commanded gap at the gripper's speed and regulates force by never
    // commanding more than (force limit / drive stiffness) past where the fingers actually are.
    const maxStep = GRIPPER_SPEED * dt;
    this.gripCmd += Math.max(-maxStep, Math.min(maxStep, this.gripGoal - this.gripCmd));
    const lead = (2 * this.gripForce) / FINGER_K;
    if (this.gripCmd < this.gapNow - lead) this.gripCmd = Math.max(this.gripGoal, this.gapNow - lead);
    if (this.gripCmd > this.gapNow + lead) this.gripCmd = Math.min(this.gripGoal, this.gapNow + lead);
    const x = PAD_FACE + this.gripCmd / 2;
    this.jointL.configureMotorPosition(-x, FINGER_K, FINGER_C);
    this.jointR.configureMotorPosition(x, FINGER_K, FINGER_C);
  }

  private readFingers(dt: number): void {
    const palm = this.linkBodies[7];
    const pt = palm.translation();
    const pr = palm.rotation();
    _inv.compose(_p.set(pt.x, pt.y, pt.z), _q.set(pr.x, pr.y, pr.z, pr.w), _s.set(1, 1, 1)).invert();
    const l = this.fingerL.translation();
    const r = this.fingerR.translation();
    const xl = _v.set(l.x, l.y, l.z).applyMatrix4(_inv).x;
    const xr = _v.set(r.x, r.y, r.z).applyMatrix4(_inv).x;
    this.fingerX = [xl, xr];
    const gap = xr - xl - 2 * PAD_FACE;
    this.gapRate += ((gap - this.gapNow) / dt - this.gapRate) * 0.2;
    this.gapNow = gap;
  }

  /**
   * Fingertip force sensors.
   *   squeeze: the force pressing on each pad along the jaw axis, as the engine's contact solver reports it.
   *   carried: the force the pads are transmitting to what they hold by friction. The engine does not report the
   *            friction part of a contact, so it is obtained from Newton's second law on the pinched body:
   *            (force from the pads) = m * (a - g), valid while that body touches nothing but the pads.
   * Both are low-pass filtered (~70 ms), like a strain-gauge channel.
   */
  /**
   * The user's hand holding an object (mouse drag). The object stays a dynamic body with its real mass and its
   * orientation held; the hand pulls it toward the cursor (lifted 35 mm) at up to HAND_SPEED with at most
   * HAND_FORCE, plus its weight. So it pushes what it bumps into with the force and speed of a careful hand,
   * and is stopped by anything heavier, instead of moving like an unstoppable infinitely heavy body.
   */
  private stepHand(o: SimObject, dt: number): void {
    const drag = o.drag as { x: number; z: number };
    const t = o.body.translation();
    const v = o.body.linvel();
    const m = o.body.mass();
    const y = this.surfaceAt(drag.x, drag.z) + o.spec.restHalf + 0.035;
    const want = _v.set(drag.x - t.x, y - t.y, drag.z - t.z).multiplyScalar(8); // position loop, 1/s
    if (want.length() > HAND_SPEED) want.setLength(HAND_SPEED);
    const imp = new THREE.Vector3(want.x - v.x, want.y - v.y, want.z - v.z).multiplyScalar(m);
    const cap = HAND_FORCE * dt;
    if (imp.length() > cap) imp.setLength(cap);
    imp.y += m * 9.81 * dt; // carry its weight
    o.body.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true);
  }

  /**
   * Rolling resistance for things that roll. While touching a surface below it and rolling, the body loses speed
   * at Crr x g (constant deceleration, as on a real table); spin is reduced by the same fraction so rolling
   * stays consistent. Rigid contacts in Rapier have no such loss, so a nudged ball would otherwise roll for metres.
   */
  private stepRolling(o: SimObject, dt: number): void {
    const v = o.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    if (speed < 1e-4 || Math.abs(v.y) > 0.05) return; // airborne or bouncing
    let onSurface = false;
    const y = o.body.translation().y;
    for (const c of o.colliders) {
      this.world.contactPairsWith(c, (other) => {
        if (onSurface) return;
        this.world.contactPair(c, other, (m) => {
          for (let i = 0; i < m.numSolverContacts(); i++) {
            const p = m.solverContactPoint(i);
            if (p && p.y < y - 0.5 * o.spec.restHalf) onSurface = true;
          }
        });
      });
      if (onSurface) break;
    }
    if (!onSurface) return;
    const k = Math.max(0, speed - o.rollCrr * 9.81 * dt) / speed;
    o.body.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
    const w = o.body.angvel();
    o.body.setAngvel({ x: w.x * k, y: w.y, z: w.z * k }, true);
  }

  private readPads(): void {
    const jaw = _v.set(1, 0, 0).transformDirection(this.frames[7]);
    const squeeze: [number, number] = [0, 0];
    const hL = this.padL.handle, hR = this.padR.handle;
    this.events.drainContactForceEvents((e) => {
      const c1 = e.collider1(), c2 = e.collider2();
      const f = e.totalForce();
      const along = Math.abs(f.x * jaw.x + f.y * jaw.y + f.z * jaw.z);
      if (c1 === hL || c2 === hL) squeeze[0] += along;
      else if (c1 === hR || c2 === hR) squeeze[1] += along;
    });
    const a = 0.06;
    this.padSqueeze[0] += (squeeze[0] - this.padSqueeze[0]) * a;
    this.padSqueeze[1] += (squeeze[1] - this.padSqueeze[1]) * a;

    let fx = 0, fy = 0, fz = 0;
    let free = false;
    let supported = false, pinched = false, slip = 0;
    let touchL = false, touchR = false;
    const seen = new Set<number>();
    for (const o of this.objects.values()) {
      if (o.drag) continue;
      let onL = false, onR = false, elsewhere = false, support = false;
      for (const c of o.colliders) {
        this.world.contactPairsWith(c, (other) => {
          this.world.contactPair(c, other, (m) => {
            if (m.numContacts() === 0) return;
            // Rapier retains pad contacts within its contact skin while solving a squeeze.
            if (other.handle === hL) { onL = true; return; }
            if (other.handle === hR) { onR = true; return; }
            let touching = false;
            for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) <= 0.0003) touching = true;
            if (!touching) return;
            elsewhere = true;
            // A side collision is not a set-down. Look for a surface contact below the body,
            // excluding the arm/fingers. This is simulated contact sensing, not a pose estimate.
            if ((other.collisionGroups() >>> 16 & (G_FIX | G_OBJ)) && Math.abs(m.normal().y) > 0.7) {
              for (let i = 0; i < m.numSolverContacts(); i++) {
                const p = m.solverContactPoint(i);
                if (p && p.y < o.body.translation().y && m.solverContactDist(i) <= 0.0003) support = true;
              }
            }
          });
        });
      }
      if (!onL && !onR) continue;
      touchL ||= onL;
      touchR ||= onR;
      const h = o.body.handle;
      seen.add(h);
      const v = o.body.linvel();
      if (onL && onR) {
        pinched = true;
        supported ||= support;
        const at = o.body.translation();
        const l = this.fingerL.velocityAtPoint(at), r = this.fingerR.velocityAtPoint(at);
        const dx = v.x - (l.x + r.x) / 2, dy = v.y - (l.y + r.y) / 2, dz = v.z - (l.z + r.z) / 2;
        const along = dx * jaw.x + dy * jaw.y + dz * jaw.z;
        slip = Math.max(slip, Math.hypot(dx - along * jaw.x, dy - along * jaw.y, dz - along * jaw.z));
      }
      const prev = this.lastVel.get(h);
      this.lastVel.set(h, { x: v.x, y: v.y, z: v.z });
      if (!prev || elsewhere || !(onL && onR)) continue; // resting on something else: the pads are not carrying it alone
      free = true;
      const m = o.body.mass();
      fx += m * ((v.x - prev.x) / SIM_DT);
      fy += m * ((v.y - prev.y) / SIM_DT + 9.81);
      fz += m * ((v.z - prev.z) / SIM_DT);
    }
    for (const h of this.lastVel.keys()) if (!seen.has(h)) this.lastVel.delete(h);
    this.padFree = free;
    this.padTouch = [touchL, touchR];
    this.padSupported = supported;
    this.padContact = pinched;
    this.padSlipSpeed += (slip - this.padSlipSpeed) * a;
    this.padCarried.x += (fx - this.padCarried.x) * a;
    this.padCarried.y += (fy - this.padCarried.y) * a;
    this.padCarried.z += (fz - this.padCarried.z) * a;
  }

  private runWaiters(): void {
    if (this.timers.length) {
      for (let i = this.timers.length - 1; i >= 0; i--) {
        if (this.time >= this.timers[i].at) {
          const [t] = this.timers.splice(i, 1);
          t.cb();
        }
      }
    }
    if (this.waiters.length) {
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i];
        const ok = w.pred();
        if (ok || this.time >= w.deadline) {
          this.waiters.splice(i, 1);
          w.resolve(ok);
        }
      }
    }
  }

  /** Call `cb` after `seconds` of SIMULATED time. Returns a cancel function. */
  after(seconds: number, cb: () => void): () => void {
    if (!this.isReady) {
      const h = setTimeout(cb, seconds * 1000);
      return () => clearTimeout(h);
    }
    const entry = { at: this.time + seconds, cb };
    this.timers.push(entry);
    return () => {
      const i = this.timers.indexOf(entry);
      if (i >= 0) this.timers.splice(i, 1);
    };
  }

  sleep(seconds: number): Promise<void> {
    return new Promise((res) => this.after(seconds, res));
  }

  /** Resolve true once `pred` holds (checked every step), or false after `timeout` simulated seconds. */
  until(pred: () => boolean, timeout: number): Promise<boolean> {
    return new Promise((resolve) => this.waiters.push({ pred, deadline: this.time + timeout, resolve }));
  }

  /** Called once per display frame after the world has advanced. */
  onFrame(cb: () => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  get substepsLastFrame(): number {
    return this.lastAdvance;
  }

  // -------------------------------------------------------------------------------------------
  // Arm: commands and encoders
  // -------------------------------------------------------------------------------------------

  /** Joint encoders (rad). */
  jointPositions(): number[] {
    return [...this.q];
  }

  jointVelocities(): number[] {
    return [...this.qd];
  }

  get moving(): boolean {
    return this.traj !== null;
  }

  /**
   * Execute a joint-space path. It is timed so that no joint exceeds `speed` x its velocity / acceleration limit,
   * then tracked by the joint servos. Resolves when the arm has settled on the goal (or was stopped).
   */
  followPath(path: number[][], opts: { speed?: number; shouldAbort?: () => boolean } = {}): Promise<TrajectoryResult> {
    if (this.traj) this.endTrajectory(false);
    const speed = Math.max(0.05, Math.min(1, opts.speed ?? 0.5));
    const full = [this.q.slice(), ...path.slice(1).map((p) => p.slice(0, 6))]; // start from where the arm really is
    const N = 96;
    let tv = 0;
    let ta = 0;
    let prev = samplePath(full, 0);
    for (let k = 1; k <= N; k++) {
      const cur = samplePath(full, k / N);
      for (let i = 0; i < 6; i++) {
        const rate = Math.abs(cur[i] - prev[i]) * N; // |dq/ds|
        tv = Math.max(tv, rate / (JOINT_MAX_VELOCITY[i] * speed));
        ta = Math.max(ta, rate / (JOINT_MAX_ACCELERATION[i] * speed));
      }
      prev = cur;
    }
    // s(t) = (1 - cos(pi t / T)) / 2: peak ds/dt = pi / 2T, peak d2s/dt2 = pi^2 / 2T^2
    const T = Math.max((Math.PI / 2) * tv, Math.sqrt((Math.PI * Math.PI * ta) / 2), 0.12);
    return new Promise((resolve) => {
      this.traj = { path: full, T, t: 0, goal: full[full.length - 1].slice(), prevRef: this.q.slice(), peakError: 0, peakTorqueRatio: 0, saturatedSteps: [0, 0, 0, 0, 0, 0], shouldAbort: opts.shouldAbort, resolve };
    });
  }

  /** Stop the arm: the current trajectory is abandoned and the joints brake to rest. */
  halt(): void {
    if (this.traj) this.endTrajectory(false);
    else this.hold = this.q.map((v, i) => v + (this.qd[i] * Math.abs(this.qd[i])) / (2 * JOINT_MAX_ACCELERATION[i] * SERVO_ACCEL_HEADROOM));
  }

  /** Put the arm in a configuration instantly. For dataset generation and tests only: nothing in the robot uses it. */
  teleportArm(q: number[], gap = this.gripGoal): void {
    if (this.traj) this.endTrajectory(false);
    this.q = q.slice(0, 6);
    this.qd = [0, 0, 0, 0, 0, 0];
    this.hold = [...this.q];
    this.gripGoal = this.gripCmd = Math.max(0, Math.min(GRIPPER_MAX_OPEN, gap));
    if (!this.isReady) return;
    forwardKinematics(this.q, this.base, this.frames);
    for (let f = 0; f < FRAME_COUNT; f++) {
      this.frames[f].decompose(_p, _q, _s);
      this.linkQuat[f].copy(_q);
      this.linkBodies[f].setTranslation(_p, true);
      this.linkBodies[f].setRotation(_q, true);
    }
    this.frames[7].decompose(_p, _q, _s);
    for (const [body, side] of [[this.fingerL, -1], [this.fingerR, 1]] as const) {
      _v.set(side * (PAD_FACE + this.gripCmd / 2), 0, FINGER_ROOT_Z).applyMatrix4(this.frames[7]);
      body.setTranslation(_v, true);
      body.setRotation(_q, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.gapNow = this.gripCmd;
    this.gapRate = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Gripper: command and sensors
  // -------------------------------------------------------------------------------------------

  /** Drive the fingers toward a pad gap (m) with a force limit per finger (N). */
  commandGripper(gap: number, force = GRIPPER_FORCE): void {
    this.gripGoal = Math.max(0, Math.min(GRIPPER_MAX_OPEN, gap));
    this.gripForce = force;
    if (!this.isReady) this.gripCmd = this.gripGoal;
  }

  /** Measured distance between the finger pads (m). */
  get fingerGap(): number {
    return this.gapNow;
  }

  get fingerGapRate(): number {
    return this.gapRate;
  }

  get gripperGoal(): number {
    return this.gripGoal;
  }

  /** Each finger body's position along the jaw axis in the gripper frame (m), for drawing them where they are. */
  fingerOffsets(): [number, number] {
    return this.fingerX;
  }

  /** Finger drive effort (N, per finger): the motor spring's pull toward its commanded position, saturated. */
  get gripEffort(): number {
    const x = PAD_FACE + this.gripCmd / 2;
    return FINGER_K * ((this.fingerX[1] - x - (this.fingerX[0] + x)) / 2);
  }

  /**
   * Fingertip force sensor reading (N): squeeze on each pad, and the force the pads carry by friction (`lifted` is
   * false while the object still rests on something else, when that force cannot be told apart from its support).
   */
  get tactile(): { squeezeLeft: number; squeezeRight: number; carried: number; carriedUp: number; lifted: boolean; supported: boolean; pinched: boolean; slipSpeed: number; contactLeft: boolean; contactRight: boolean } {
    return { squeezeLeft: this.padSqueeze[0], squeezeRight: this.padSqueeze[1], carried: this.padCarried.length(), carriedUp: this.padCarried.y, lifted: this.padFree, supported: this.padSupported, pinched: this.padContact, slipSpeed: this.padSlipSpeed, contactLeft: this.padTouch[0], contactRight: this.padTouch[1] };
  }

  /** Wait until the fingers have stopped moving (reached the commanded gap or stalled on something). */
  async gripperSettled(timeout = 2.5): Promise<void> {
    let still = 0;
    await this.until(() => {
      const stalled = Math.abs(this.gripCmd - this.gapNow) > (2 * this.gripForce) / FINGER_K - 0.0006;
      const arrived = Math.abs(this.gripCmd - this.gripGoal) < 1e-4 || stalled;
      still = arrived && Math.abs(this.gapRate) < 0.004 ? still + SIM_DT : 0;
      return still > 0.12;
    }, timeout);
  }

  // -------------------------------------------------------------------------------------------
  // Objects (world management: the user's hands, not the robot)
  // -------------------------------------------------------------------------------------------

  /** Height of the supporting surface under (x, z). */
  surfaceAt(x: number, z: number): number {
    if (Math.abs(x) > TABLE.halfX || Math.abs(z) > TABLE.halfZ) return 0;
    return this.base.y + restLift(dropRegion(x, z));
  }

  private makeShape(s: ShapeSpec): RAPIER_NS.ColliderDesc {
    const R = this.R;
    switch (s.t) {
      case 'box':
        return s.round ? R.ColliderDesc.roundCuboid(s.h[0], s.h[1], s.h[2], s.round) : R.ColliderDesc.cuboid(s.h[0], s.h[1], s.h[2]);
      case 'cyl':
        return R.ColliderDesc.cylinder(s.hh, s.r);
      case 'ball':
        return R.ColliderDesc.ball(s.r);
      case 'hull': {
        const d = R.ColliderDesc.convexHull(new Float32Array(s.pts));
        if (!d) throw new Error('convex hull failed');
        return d;
      }
    }
  }

  /** Set an object down at (x, z) with the given yaw. It is released just above the surface and settles under gravity. */
  spawn(obj: { id: string; name: string; shape: string; mass?: number }, at: { x: number; z: number; y?: number; yaw?: number }): void {
    if (!this.isReady) return;
    this.remove(obj.id);
    const { R, world } = this;
    const spec = physicsFor(obj);
    const yaw = at.yaw ?? spec.spawnYaw;
    const y = at.y ?? this.surfaceAt(at.x, at.z) + spec.restHalf + 0.0015;
    _q.setFromAxisAngle(Y_AXIS, yaw);
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(at.x, y, at.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinearDamping(spec.linDamp)
        .setAngularDamping(spec.angDamp)
        .setCcdEnabled(true)
    );
    // A mass given for this object (the user's setting) scales every part of it; otherwise the kind's real mass.
    const nominal = spec.colliders.reduce((s, c) => s + c.mass, 0);
    const scale = obj.mass && obj.mass > 0 ? obj.mass / nominal : 1;
    const colliders = spec.colliders.map((c) => {
      const desc = this.makeShape(c.shape)
        .setMass(c.mass * scale)
        .setFriction(spec.friction)
        .setRestitution(spec.restitution)
        .setRestitutionCombineRule(R.CoefficientCombineRule.Max)
        .setCollisionGroups(groups(G_OBJ, G_OBJ | G_ARM | G_FINGER | G_FIX));
      if (c.pos) desc.setTranslation(c.pos[0], c.pos[1], c.pos[2]);
      if (c.rot) {
        const e = new THREE.Quaternion().setFromEuler(new THREE.Euler(c.rot[0], c.rot[1], c.rot[2], 'XYZ'));
        desc.setRotation({ x: e.x, y: e.y, z: e.z, w: e.w });
      }
      return world.createCollider(desc, body);
    });
    this.objects.set(obj.id, { id: obj.id, body, colliders, spec, drag: null, rollCrr: spec.rollCrr ?? 0 });
  }

  has(id: string): boolean {
    return this.objects.has(id);
  }

  remove(id: string): void {
    const o = this.objects.get(id);
    if (!o) return;
    this.world.removeRigidBody(o.body);
    this.objects.delete(id);
  }

  clearObjects(): void {
    for (const id of [...this.objects.keys()]) this.remove(id);
  }

  /** Pick an object up and set it down somewhere else (the user rearranging the table). */
  place(id: string, at: { x: number; z: number; yaw?: number; tipped?: boolean }): void {
    const o = this.objects.get(id);
    if (!o) return;
    const y = this.surfaceAt(at.x, at.z) + (at.tipped ? 0.06 : o.spec.restHalf + 0.0015);
    _q.setFromAxisAngle(Y_AXIS, at.yaw ?? o.spec.spawnYaw);
    if (at.tipped) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)); // laid on its side
    o.body.setTranslation({ x: at.x, y, z: at.z }, true);
    o.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    o.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    o.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** The user takes hold of an object (mouse drag): it follows the hand until released, then falls. */
  grab(id: string): void {
    const o = this.objects.get(id);
    if (!o || o.drag) return;
    const t = o.body.translation();
    o.drag = { x: t.x, z: t.z };
    o.body.lockRotations(true, true); // held in the hand: it does not tumble
    o.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  dragTo(id: string, x: number, z: number): void {
    const o = this.objects.get(id);
    if (o?.drag) o.drag = { x, z };
  }

  release(id: string): void {
    const o = this.objects.get(id);
    if (!o?.drag) return;
    o.drag = null;
    o.body.lockRotations(false, true);
    o.body.setLinvel({ x: 0, y: 0, z: 0 }, true); // let go of it gently
    o.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /**
   * Finger pad friction coefficient. New rubber pads are 1.6 and dominate whatever they touch; a lower value models
   * worn, dusty or oily pads, and then the pad sets the friction of the pair (the smaller of the two is used).
   */
  setPadFriction(mu: number): void {
    for (const pad of [this.padL, this.padR]) {
      pad.setFriction(mu);
      pad.setFrictionCombineRule(mu < 1.6 ? this.R.CoefficientCombineRule.Min : this.R.CoefficientCombineRule.Max);
    }
  }

  get padFriction(): number {
    return this.padL.friction();
  }

  /** True mass of an object (kg), for the UI and tests. */
  massOf(id: string): number {
    return this.objects.get(id)?.body.mass() ?? 0;
  }

  /** Ground-truth pose, for the renderer and the UI. The robot's software does not call this. */
  pose(id: string): ObjectPose | null {
    const o = this.objects.get(id);
    if (!o) return null;
    const t = o.body.translation();
    const r = o.body.rotation();
    return { x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w };
  }

  objectIds(): string[] {
    return [...this.objects.keys()];
  }

  speedOf(id: string): number {
    const o = this.objects.get(id);
    if (!o) return 0;
    const v = o.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /** Ground truth for the UI: is this object pinched between both finger pads right now? */
  isPinched(id: string): boolean {
    const o = this.objects.get(id);
    if (!o) return false;
    const touches = (pad: RAPIER_NS.Collider) => {
      let hit = false;
      for (const c of o.colliders) {
        this.world.contactPair(pad, c, (m) => {
          if (m.numContacts() > 0) hit = true;
        });
        if (hit) break;
      }
      return hit;
    };
    return touches(this.padL) && touches(this.padR);
  }

  /** True once every object has (nearly) stopped moving. */
  allAtRest(threshold = 0.01): boolean {
    for (const o of this.objects.values()) {
      const v = o.body.linvel();
      const w = o.body.angvel();
      if (Math.hypot(v.x, v.y, v.z) > threshold || Math.hypot(w.x, w.y, w.z) > threshold * 20) return false;
    }
    return true;
  }

  /** Collider wireframe (line segment vertices + RGBA colours) for the debug overlay. */
  debugRender(): { vertices: Float32Array; colors: Float32Array } | null {
    return this.isReady ? this.world.debugRender() : null;
  }

  get bodyCount(): number {
    return this.isReady ? this.world.bodies.len() : 0;
  }
}

export const simWorld = new PhysicsWorld();
