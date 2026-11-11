// Contact and slip sensor checks against dynamic bodies, including settled handover placement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NluModel } from '../src/services/nluModel';
import { PhysicsWorld, SIM_DT } from '../src/sim/world';
import { solveIK, tcpPosition, wristForJawYaw, linePath, GRASP_MIN_TCP_HEIGHT } from '../src/sim/kinematics';
import { GRIPPER_MAX_OPEN, MAT, OBJECT_HEIGHT } from '../src/sim/physics';
import { kindPhysics } from '../src/sim/objectPhysics';
import type { ObjectKind } from '../src/sim/objectMeshes';

const base = { x: -0.35, y: 0.45, z: -0.05 };
const nlu = new NluModel(JSON.parse(readFileSync('public/nora_nlu_model.json', 'utf8')));
for (const location of ['handover mat', 'handover tray', 'handing tray']) {
  const intent = nlu.predict(`place the water glass on the ${location}`);
  assert.equal(intent.action, 'place');
  assert.equal(intent.target_location, 'user', `${location}: wrong destination`);
}
assert.equal(nlu.predict('place the water glass in the tray').target_location, 'tray');
console.log('destination parsing: handover mat/tray and storage tray distinguished');
const kinds: [ObjectKind, string, string][] = [
  ['cube', 'Red Cube', 'box'], ['mug', 'Coffee Mug', 'mug'], ['glass', 'Water Glass', 'glass'],
  ['tennis_ball', 'Tennis Ball', 'sphere'], ['pen', 'Writing Pen', 'cylinder']
];
function run(w: PhysicsWorld, seconds: number) { for (let i = 0; i < seconds / SIM_DT; i++) w.step(); }
async function drive<T>(w: PhysicsWorld, promise: Promise<T>): Promise<T> {
  let done = false, result!: T;
  promise.then(v => { result = v; done = true; });
  for (let i = 0; i < 30 / SIM_DT && !done; i++) { w.step(); if (i % 8 === 0) await Promise.resolve(); }
  assert(done, 'Motion timed out');
  return result;
}
for (const [kind, name, shape] of kinds) {
  const w = new PhysicsWorld();
  await w.init(base);
  w.spawn({ id: 'o', name, shape }, { x: 0.15, z: 0.05, yaw: 0 });
  run(w, 0.6);
  const h = OBJECT_HEIGHT[kind];
  const graspHeight = Math.max(h / 2, h - 0.026, GRASP_MIN_TCP_HEIGHT);
  const q = solveIK(0.15, base.y + graspHeight + 0.1, 0.05, base);
  q[5] = wristForJawYaw(q, base, Math.PI / 2);
  const linear = (x: number, y: number, z: number, speed = 0.3) => {
    const from = tcpPosition(w.jointPositions(), base);
    return drive(w, w.followPath(linePath(from, { x, y, z }, base, null, w.jointPositions()[5]), { speed }));
  };
  w.commandGripper(GRIPPER_MAX_OPEN);
  await drive(w, w.followPath([w.jointPositions(), q], { speed: 0.5 }));
  await linear(0.15, base.y + graspHeight, 0.05);
  w.commandGripper(0);
  await drive(w, w.gripperSettled());
  await linear(0.15, base.y + graspHeight + 0.15, 0.05);
  run(w, 0.5);
  assert(w.tactile.pinched && w.tactile.lifted, `${kind}: no suspended grasp`);
  assert(!w.tactile.supported, `${kind}: false surface contact in the air`);
  const weight = kindPhysics(kind).colliders.reduce((m, c) => m + c.mass, 0) * 9.81;
  assert(Math.abs(w.tactile.carried - weight) < 0.15, `${kind}: incorrect load`);
  assert(w.tactile.slipSpeed < 0.005, `${kind}: unstable hold`);
  await linear(0.08, base.y + graspHeight + 0.15, 0.28);
  await linear(0.08, base.y + MAT.top + graspHeight + 0.008, 0.28);
  for (let i = 0; i < 22 && !w.tactile.supported; i++) {
    const p = tcpPosition(w.jointPositions(), base);
    await linear(p.x, p.y - 0.001, p.z, 0.1);
  }
  run(w, 0.12);
  assert(w.tactile.supported, `${kind}: surface contact not detected`);
  const releaseSpeed = w.speedOf('o');
  assert(releaseSpeed < 0.025, `${kind}: moving too fast at release`);
  const gap = w.fingerGap;
  w.commandGripper(Math.min(GRIPPER_MAX_OPEN, gap + 0.018));
  await drive(w, w.gripperSettled());
  run(w, 0.35);
  const p = tcpPosition(w.jointPositions(), base);
  await linear(p.x, p.y + 0.1, p.z);
  run(w, 0.5);
  const settled = w.pose('o')!;
  run(w, 3);
  const end = w.pose('o')!;
  const drift = Math.hypot(end.x - settled.x, end.z - settled.z);
  assert(end.x > MAT.x0 && end.x < MAT.x1 && end.z > MAT.z0 && end.z < MAT.z1, `${kind}: left handover mat`);
  assert(drift < 0.003, `${kind}: drifted after placement`);
  assert(!w.tactile.pinched, `${kind}: stale holding sensor`);
  console.log(`${kind}: supported before release, speed ${(releaseSpeed * 1000).toFixed(2)} mm/s, drift ${(drift * 1000).toFixed(2)} mm in 3 s`);
}

// A deliberately underpowered grasp must produce physical slip, not a glued attachment.
const w = new PhysicsWorld();
await w.init(base);
w.spawn({ id: 'o', name: 'Red Cube', shape: 'box' }, { x: 0.15, z: 0.05 });
run(w, 0.6);
const q = solveIK(0.15, 0.48, 0.05, base);
w.teleportArm(q, GRIPPER_MAX_OPEN);
run(w, 0.1);
w.commandGripper(0);
await drive(w, w.gripperSettled());
await drive(w, w.followPath([w.jointPositions(), solveIK(0.15, 0.65, 0.05, base)], { speed: 0.3 }));
run(w, 0.4);
assert(w.tactile.lifted, 'Slip test did not start with a held object');
w.commandGripper(0, 0.05);
let peakSlip = 0;
for (let i = 0; i < 1 / SIM_DT; i++) { w.step(); peakSlip = Math.max(peakSlip, w.tactile.slipSpeed); }
assert(peakSlip > 0.005, 'Weak grasp did not register slip');
assert(!w.tactile.pinched, 'Weak grasp kept holding unrealistically');
console.log(`weak grasp: slip detected at ${(peakSlip * 1000).toFixed(1)} mm/s; contact lost`);
