// Fingertip force sensor check (headless): grasp, lift and hold each kind, then compare the sensed squeeze with
// the commanded grip force and the sensed carried load with the object's true weight.   npx esbuild ... && node ...
import { PhysicsWorld, SIM_DT } from '../src/sim/world';
import { solveIK, wristForJawYaw, linePath, GRASP_MIN_TCP_HEIGHT } from '../src/sim/kinematics';
import { kindPhysics } from '../src/sim/objectPhysics';
import { OBJECT_HEIGHT, GRIPPER_MAX_OPEN, GRIPPER_FORCE } from '../src/sim/physics';
import type { ObjectKind } from '../src/sim/objectMeshes';

const base = { x: -0.35, y: 0.45, z: -0.05 };
const NAMES: Partial<Record<ObjectKind, { name: string; shape: string }>> = {
  cube: { name: 'Red Cube', shape: 'box' }, can: { name: 'Soda Can', shape: 'cylinder' }, tennis_ball: { name: 'Tennis Ball', shape: 'sphere' },
  mug: { name: 'Coffee Mug', shape: 'mug' }, glass: { name: 'Water Glass', shape: 'glass' }, pen: { name: 'Writing Pen', shape: 'cylinder' },
  book: { name: 'Notebook', shape: 'box' }, apple: { name: 'Red Apple', shape: 'apple' }
};
async function drive<T>(w: PhysicsWorld, p: Promise<T>): Promise<void> {
  let done = false;
  p.then(() => (done = true));
  for (let i = 0; i < 20 / SIM_DT && !done; i++) { w.step(); if (i % 8 === 0) await Promise.resolve(); }
  await Promise.resolve();
}
for (const [kind, spec] of Object.entries(NAMES) as [ObjectKind, { name: string; shape: string }][]) {
  const w = new PhysicsWorld();
  await w.init(base);
  w.spawn({ id: 'o', ...spec }, { x: 0.15, z: 0.05, yaw: 0 });
  for (let i = 0; i < 150; i++) w.step();
  const h = OBJECT_HEIGHT[kind];
  const y = 0.45 + Math.max(h / 2, h - 0.026, GRASP_MIN_TCP_HEIGHT);
  const q = solveIK(0.15, y + 0.1, 0.05, base);
  q[5] = wristForJawYaw(q, base, Math.PI / 2);
  w.commandGripper(GRIPPER_MAX_OPEN);
  await drive(w, w.followPath([w.jointPositions(), q], { speed: 0.6 }));
  await drive(w, w.followPath(linePath({ x: 0.15, y: y + 0.1, z: 0.05 }, { x: 0.15, y, z: 0.05 }, base, null, q[5]), { speed: 0.3 }));
  w.commandGripper(0);
  await drive(w, w.gripperSettled());
  await drive(w, w.followPath(linePath({ x: 0.15, y, z: 0.05 }, { x: 0.15, y: y + 0.15, z: 0.05 }, base, null, q[5]), { speed: 0.4 }));
  await drive(w, w.sleep(0.6));
  const t = w.tactile;
  const mass = kindPhysics(kind).colliders.reduce((s, c) => s + c.mass, 0);
  console.log(`${kind.padEnd(11)} squeeze L ${t.squeezeLeft.toFixed(1)} N, R ${t.squeezeRight.toFixed(1)} N (commanded ${GRIPPER_FORCE}); carried ${t.carried.toFixed(2)} N (true weight ${(mass * 9.81).toFixed(2)} N); friction in use ${((t.carried / (1.6 * (t.squeezeLeft + t.squeezeRight))) * 100).toFixed(1)}%; lifted ${t.lifted}`);
}
