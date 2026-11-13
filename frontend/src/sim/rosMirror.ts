/**
 * Mirrors the running simulator onto real ROS 2 topics through rosbridge, so Foxglove shows the same arm, objects,
 * camera, plans and logs, and asks MoveIt (move_group) to plan the joint-space moves.
 *
 * Everything is published in `base_link` (ROS, z up). The scene is three.js (y up) with the robot base at `base`:
 * ROS x = scene x - base.x, ROS y = base.z - scene z, ROS z = scene y - base.y.
 */
import * as ROSLIB from 'roslib';
import * as THREE from 'three';
import { topicBus } from './topicBus';
import { simWorld } from './world';
import { cameraFeed, type CameraFrame } from './wristCamera';
import { physicsFor } from './objectPhysics';
import { MAT, TABLE, toteBoxes } from './physics';
import type { CollisionWorld } from './collision';
import type { TabletopObject } from '../types';

type V3 = { x: number; y: number; z: number };
type Msg = Record<string, unknown>;

const ARM_JOINTS = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6'];
const Q0 = { x: 0, y: 0, z: 0, w: 1 };
const ONE = new THREE.Vector3(1, 1, 1);

let ros: ROSLIB.Ros | null = null;
let base: V3 = { x: 0, y: 0, z: 0 };
let getObjects: () => TabletopObject[] = () => [];
let hooked = false;
let moveitDown = false;
const topics = new Map<string, ROSLIB.Topic>();

const pos = (x: number, y: number, z: number): V3 => ({ x: x - base.x, y: base.z - z, z: y - base.y });
const header = (frame_id = 'base_link') => {
  const t = Date.now();
  return { frame_id, stamp: { sec: Math.floor(t / 1000), nanosec: (t % 1000) * 1e6 } };
};

function pub(name: string, messageType: string, msg: Msg): void {
  if (!ros || !ros.isConnected) return;
  let t = topics.get(name);
  if (!t) topics.set(name, (t = new ROSLIB.Topic({ ros, name, messageType })));
  t.publish(msg);
}

/** Scene-frame axis-aligned box -> centre and size in base_link. */
const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => ({
  c: pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
  s: { x: x1 - x0, y: z1 - z0, z: y1 - y0 }
});

/** Table, tote and handover mat as scene-frame boxes [x0, x1, y0, y1, z0, z1]. */
function fixtures(): { id: string; b: number[]; rgb: number[] }[] {
  const top = base.y;
  return [
    { id: 'table', b: [-TABLE.halfX, TABLE.halfX, top - TABLE.thickness, top, -TABLE.halfZ, TABLE.halfZ], rgb: [0.72, 0.6, 0.45] },
    ...toteBoxes().map(({ name, box: t }, i) => ({ id: `${name}_${i}`, b: [t[0], t[1], top + t[2], top + t[3], t[4], t[5]], rgb: [0.2, 0.35, 0.6] })),
    { id: 'handover_mat', b: [MAT.x0, MAT.x1, top, top + MAT.top, MAT.z0, MAT.z1], rgb: [0.15, 0.5, 0.35] }
  ];
}

function marker(ns: string, id: number, type: number, p: V3, q: typeof Q0, s: V3, rgb: number[], extra: Msg = {}): Msg {
  return {
    header: header(), ns, id, type, action: 0, pose: { position: p, orientation: q }, scale: s,
    color: { r: rgb[0], g: rgb[1], b: rgb[2], a: 1 }, lifetime: { sec: 1, nanosec: 0 }, ...extra
  };
}

/** Fixtures plus every object at its true physics pose, drawn from its collision shapes. */
function sceneMarkers(): Msg[] {
  const out: Msg[] = [];
  let id = 0;
  for (const f of fixtures()) {
    const b = box(f.b[0], f.b[1], f.b[2], f.b[3], f.b[4], f.b[5]);
    out.push(marker('fixtures', id++, 1, b.c, Q0, b.s, f.rgb));
  }
  const wp = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  const ws = new THREE.Vector3();
  for (const o of getObjects()) {
    const p = simWorld.pose(o.id);
    if (!p) continue;
    const body = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw), ONE);
    const hex = parseInt((o.color || '#3b82f6').replace('#', ''), 16) || 0x3b82f6;
    const rgb = [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
    for (const c of physicsFor(o).colliders) {
      const lp = new THREE.Vector3(...(c.pos ?? [0, 0, 0]));
      const s = c.shape;
      let type = 1;
      let e: [number, number, number]; // extents along the collider's own x, y, z
      if (s.t === 'box') e = [2 * s.h[0], 2 * s.h[1], 2 * s.h[2]];
      else if (s.t === 'cyl') (type = 3), (e = [2 * s.r, 2 * s.hh, 2 * s.r]);
      else if (s.t === 'ball') (type = 2), (e = [2 * s.r, 2 * s.r, 2 * s.r]);
      else {
        // convex hull: its bounding box (a cylinder when it is round about y)
        const bb = new THREE.Box3().setFromArray(s.pts);
        const size = bb.getSize(new THREE.Vector3());
        e = [size.x, size.y, size.z];
        if (Math.abs(size.x - size.z) < 0.002) type = 3;
        lp.add(bb.getCenter(new THREE.Vector3()));
      }
      const local = new THREE.Matrix4().compose(lp, new THREE.Quaternion().setFromEuler(new THREE.Euler(...(c.rot ?? [0, 0, 0]), 'XYZ')), ONE);
      body.clone().multiply(local).decompose(wp, wq, ws);
      out.push(marker('objects', id++, type, pos(wp.x, wp.y, wp.z), { x: wq.x, y: -wq.z, z: wq.y, w: wq.w }, { x: e[0], y: e[2], z: e[1] }, rgb));
    }
    out.push(marker('labels', id++, 9, pos(p.x, p.y + 0.1, p.z), Q0, { x: 0, y: 0, z: 0.025 }, [1, 1, 1], { text: o.name }));
  }
  return out;
}

let canvas: HTMLCanvasElement | null = null;
function jpeg(rgba: Uint8ClampedArray, w: number, h: number): string {
  canvas = canvas ?? document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

let lastImage = 0;
function publishCamera(f: CameraFrame): void {
  if (!ros || !ros.isConnected || performance.now() - lastImage < 200) return;
  lastImage = performance.now();
  const image = (topic: string, rgba: Uint8ClampedArray) =>
    pub(topic, 'sensor_msgs/msg/CompressedImage', { header: header('camera_color_optical_frame'), format: 'jpeg', data: jpeg(rgba, f.width, f.height) });
  image('/camera/color/image_raw/compressed', f.rgba);
  image('/camera/depth/image_colorized/compressed', f.depthRgba);
  image('/camera/segmentation/compressed', f.segRgba);
}

function hook(): void {
  hooked = true;
  setInterval(() => {
    if (!ros || !ros.isConnected || !simWorld.isReady) return;
    const [xl, xr] = simWorld.fingerOffsets();
    pub('/joint_states', 'sensor_msgs/msg/JointState', {
      header: header(''),
      name: [...ARM_JOINTS, 'gripper_joint', 'left_finger_joint', 'right_finger_joint'],
      position: [...simWorld.jointPositions(), simWorld.fingerGap, xl + 0.0055, xr - 0.0055],
      velocity: [...simWorld.jointVelocities(), simWorld.fingerGapRate, 0, 0],
      effort: [...simWorld.jointEfforts, simWorld.gripEffort, 0, 0]
    });
  }, 33);
  setInterval(() => {
    if (ros && ros.isConnected && simWorld.isReady) pub('/visualization_marker_array', 'visualization_msgs/msg/MarkerArray', { markers: sceneMarkers() });
  }, 200);
  cameraFeed.subscribe(publishCamera);

  const json = (from: string, to = from) => topicBus.subscribe(from, (m) => pub(to, 'std_msgs/msg/String', { data: JSON.stringify(m) }));
  json('/nora/intent', '/nora/intent_parsed');
  json('/nora/perception/detections');
  json('/nora/gripper/state');
  json('/nora/controller/state');
  json('/nora/orchestrator/state', '/nora/pipeline');
  topicBus.subscribe('/nora/orchestrator/state', (m) => pub('/nora/orchestrator/state', 'std_msgs/msg/String', { data: String((m as { stage?: string }).stage ?? '') }));
  topicBus.subscribe('/rosout', (m) => {
    const l = m as { level: number; nodeName: string; message: string };
    pub('/rosout', 'rcl_interfaces/msg/Log', { stamp: header().stamp, level: l.level, name: `sim/${l.nodeName}`, msg: l.message });
  });
  topicBus.subscribe('/move_group/display_planned_path', (m) => {
    const p = m as { tcp_path: [number, number, number][]; success: boolean };
    pub('/nora/planned_path', 'std_msgs/msg/String', { data: JSON.stringify({ ...p, tcp_path: undefined }) });
    pub('/visualization_marker_array', 'visualization_msgs/msg/MarkerArray', {
      markers: [marker('planned_path', 0, 4, { x: 0, y: 0, z: 0 }, Q0, { x: 0.006, y: 0, z: 0 }, p.success ? [0, 0.9, 1] : [1, 0.3, 0.2], {
        points: p.tcp_path.map(([x, y, z]) => pos(x, y, z)),
        lifetime: { sec: 0, nanosec: 0 }
      })]
    });
  });
}

/** Call on every rosbridge connection. */
export function startRosMirror(r: ROSLIB.Ros, basePos: V3, objects: () => TabletopObject[]): void {
  ros = r;
  base = basePos;
  getObjects = objects;
  topics.clear();
  moveitDown = false;
  if (!hooked) hook();
}

function call(name: string, serviceType: string, request: Msg, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timed out`)), timeoutMs);
    new ROSLIB.Service({ ros: ros!, name, serviceType }).callService(
      request,
      (res: unknown) => (clearTimeout(timer), resolve(res)),
      (err: unknown) => (clearTimeout(timer), reject(new Error(String(err))))
    );
  });
}

/**
 * Plan start -> goal (6 arm joints) with MoveIt's OMPL pipeline, against the obstacles the robot currently believes in.
 * Returns the joint waypoints, `{ error }` when MoveIt found no plan, or null when move_group is not reachable.
 */
export async function planWithMoveIt(start: number[], goal: number[], world: CollisionWorld): Promise<{ path: number[][]; ms: number } | { error: string } | null> {
  if (!ros || !ros.isConnected || moveitDown) return null;
  const solid = (id: string, type: number, dimensions: number[], p: V3): Msg => ({
    header: header(), id, primitives: [{ type, dimensions }], primitive_poses: [{ position: p, orientation: Q0 }], operation: 0
  });
  const top = base.y;
  const collision_objects: Msg[] = [
    { header: header(), id: '', operation: 1 }, // remove everything from the previous plan
    ...fixtures().slice(0, -1).map((f) => {
      // the table top sits 3 mm low so the base plate bolted to it is not reported as a collision
      const b = box(f.b[0], f.b[1], f.b[2], f.id === 'table' ? top - 0.003 : f.b[3], f.b[4], f.b[5]);
      return solid(f.id, 1, [b.s.x, b.s.y, b.s.z], b.c);
    }),
    ...world.spheres.map((s) => solid(s.id, 2, [s.r], pos(s.c.x, s.c.y, s.c.z)))
  ];
  try {
    await call('/apply_planning_scene', 'moveit_msgs/srv/ApplyPlanningScene', { scene: { is_diff: true, robot_state: { is_diff: true }, world: { collision_objects } } }, 3000);
    const res = await call('/plan_kinematic_path', 'moveit_msgs/srv/GetMotionPlan', {
      motion_plan_request: {
        group_name: 'arm',
        planner_id: 'RRTConnect',
        num_planning_attempts: 1,
        allowed_planning_time: 2.0,
        max_velocity_scaling_factor: 1.0,
        max_acceleration_scaling_factor: 1.0,
        start_state: { is_diff: true, joint_state: { name: ARM_JOINTS, position: start } },
        goal_constraints: [{ joint_constraints: ARM_JOINTS.map((joint_name, i) => ({ joint_name, position: goal[i], tolerance_above: 0.001, tolerance_below: 0.001, weight: 1.0 })) }]
      }
    }, 8000);
    const r = res.motion_plan_response;
    const jt = r.trajectory.joint_trajectory;
    if (r.error_code.val !== 1 || !jt.points.length) return { error: `MoveIt error code ${r.error_code.val}` };
    const order = ARM_JOINTS.map((n) => jt.joint_names.indexOf(n));
    return { path: jt.points.map((pt: { positions: number[] }) => order.map((k) => pt.positions[k])), ms: r.planning_time * 1000 };
  } catch {
    moveitDown = true; // move_group is not running: stop asking until the next connection
    return null;
  }
}
