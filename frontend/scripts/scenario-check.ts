// Physical failure and limit scenarios, run headlessly against the Rapier world (no browser, no camera).
// Every outcome below comes out of the simulation; nothing is scripted to fail.   npm run test:scenarios
import assert from 'node:assert/strict';
import { PhysicsWorld, SIM_DT } from '../src/sim/world';
import { solveIK, tcpPosition, wristForJawYaw, linePath, JOINT_MAX_VELOCITY, JOINT_MAX_ACCELERATION, JOINT_MAX_TORQUE } from '../src/sim/kinematics';
import { GRIPPER_MAX_OPEN } from '../src/sim/physics';

const base = { x: -0.35, y: 0.45, z: -0.05 };
const T = base.y;
const results: string[] = [];
const ok = (name: string, detail: string) => results.push(`PASS  ${name}: ${detail}`);

function run(w: PhysicsWorld, s: number, each?: () => void) {
  for (let i = 0; i < s / SIM_DT; i++) { w.step(); each?.(); }
}
async function drive<T>(w: PhysicsWorld, p: Promise<T>, each?: () => void): Promise<T> {
  let done = false, val!: T;
  p.then((v) => { done = true; val = v; });
  for (let i = 0; i < 30 / SIM_DT && !done; i++) { w.step(); each?.(); if (i % 8 === 0) await Promise.resolve(); }
  await Promise.resolve();
  assert(done, 'motion timed out');
  return val;
}
const world = async () => { const w = new PhysicsWorld(); await w.init(base); return w; };
const P = (x: number, y: number, z: number) => ({ x, y, z });
async function pickAt(w: PhysicsWorld, x: number, z: number, tcpY: number, force?: number) {
  const q = solveIK(x, tcpY + 0.1, z, base);
  q[5] = wristForJawYaw(q, base, Math.PI / 2);
  w.commandGripper(GRIPPER_MAX_OPEN);
  await drive(w, w.followPath([w.jointPositions(), q], { speed: 0.6 }));
  await drive(w, w.followPath(linePath(P(x, tcpY + 0.1, z), P(x, tcpY, z), base, null, q[5]), { speed: 0.3 }));
  w.commandGripper(0, force);
  await drive(w, w.gripperSettled());
  return q[5];
}

// 1. Joint limits: a fast move across the workspace stays inside velocity, acceleration and torque ratings.
{
  const w = await world();
  let vMax = 0, aMax = 0, tMax = 0;
  let prev = w.jointVelocities();
  const watch = () => {
    const v = w.jointVelocities(), e = w.jointEfforts;
    for (let i = 0; i < 6; i++) {
      vMax = Math.max(vMax, Math.abs(v[i]) / JOINT_MAX_VELOCITY[i]);
      aMax = Math.max(aMax, Math.abs(v[i] - prev[i]) / SIM_DT / JOINT_MAX_ACCELERATION[i]);
      tMax = Math.max(tMax, Math.abs(e[i]) / JOINT_MAX_TORQUE[i]);
    }
    prev = v;
  };
  for (const [x, z] of [[0.4, 0.3], [-0.05, -0.3], [0.35, -0.2], [0.0, 0.3]]) {
    const r = await drive(w, w.followPath([w.jointPositions(), solveIK(x, T + 0.2, z, base)], { speed: 1 }), watch);
    assert.equal(r.saturated.length, 0, 'unloaded arm saturated a joint');
  }
  assert(vMax <= 1.0001, `velocity limit exceeded: ${vMax}`);
  // the servo may use up to 2x the planning acceleration to correct tracking error
  assert(aMax <= 2.0001, `acceleration limit exceeded: ${aMax}`);
  assert(tMax < 1, `torque limit reached unloaded: ${tMax}`);
  ok('joint limits', `peak ${(vMax * 100).toFixed(0)}% of rated speed, ${(aMax * 50).toFixed(0)}% of servo acceleration headroom, ${(tMax * 100).toFixed(0)}% of rated torque at full speed`);
}

// 2. Falling and colliding: a cube dropped on a cube stacks; a ball rolled into a can knocks it.
{
  const w = await world();
  w.spawn({ id: 'a', name: 'Red Cube', shape: 'box' }, { x: 0.2, z: 0.1 });
  w.spawn({ id: 'b', name: 'Blue Cube', shape: 'box' }, { x: 0.205, z: 0.1, y: T + 0.3 });
  run(w, 2);
  const top = w.pose('b')!;
  assert(Math.abs(top.y - (T + 0.09)) < 0.004, `cube did not stack: y ${top.y}`);
  w.spawn({ id: 'c', name: 'Soda Can', shape: 'cylinder' }, { x: 0.25, z: -0.06 });
  w.spawn({ id: 'd', name: 'Tennis Ball', shape: 'sphere' }, { x: 0.0, z: -0.06 });
  run(w, 0.3);
  (w as any).objects.get('d').body.setLinvel({ x: 1.5, y: 0, z: 0 }, true);
  run(w, 2);
  const can = w.pose('c')!;
  assert(can.x > 0.2535 && w.pose('d')!.x < 0.18, `ball did not move the can (x ${can.x})`);
  ok('falling and collisions', `dropped cube settled ${((top.y - T) * 1000).toFixed(1)} mm up (stacked on a 60 mm cube); ball at 1.5 m/s bounced back off the 370 g can and slid it ${((can.x - 0.25) * 1000).toFixed(1)} mm (momentum + friction predict about 4.6 mm)`);
}

// 3. Obstacle collision: an arm sweep through a can pushes it (the links are collision bodies).
{
  const w = await world();
  w.spawn({ id: 'c', name: 'Soda Can', shape: 'cylinder' }, { x: 0.15, z: 0.05 });
  run(w, 0.5);
  await drive(w, w.followPath([w.jointPositions(), solveIK(0.0, T + 0.045, 0.05, base)], { speed: 0.6 }));
  await drive(w, w.followPath(linePath(P(0.0, T + 0.045, 0.05), P(0.3, T + 0.045, 0.05), base, null, w.jointPositions()[5]), { speed: 0.4 }));
  run(w, 1);
  const c = w.pose('c')!;
  const moved = Math.hypot(c.x - 0.15, c.z - 0.05);
  assert(moved > 0.03, 'sweep did not disturb the can');
  ok('obstacle collision', `sweeping the gripper through the can moved it ${(moved * 1000).toFixed(0)} mm${1 - 2 * (c.qx * c.qx + c.qz * c.qz) < 0.5 ? ' and knocked it over' : ''}`);
}

// 4. Failed finger contact: closing over empty table.
{
  const w = await world();
  await pickAt(w, 0.15, 0.05, T + 0.03);
  assert(w.fingerGap < 0.002 && !w.tactile.pinched, 'fingers report contact with nothing');
  ok('failed finger contact', `fingers closed to ${(w.fingerGap * 1000).toFixed(1)} mm with no pad contact`);
}

// 5. Insufficient gripper friction: worn pads (mu 0.05) cannot hold a 370 g can with a 25 N squeeze. (A straight-walled
//    object: a tapered glass is wedged upward by the squeeze itself, so friction alone does not decide it.)
{
  const w = await world();
  w.setPadFriction(0.05);
  w.spawn({ id: 'g', name: 'Soda Can', shape: 'cylinder' }, { x: 0.15, z: 0.05 });
  run(w, 0.5);
  const wr = await pickAt(w, 0.15, 0.05, T + 0.064);
  let slip = 0;
  await drive(w, w.followPath(linePath(P(0.15, T + 0.064, 0.05), P(0.15, T + 0.2, 0.05), base, null, wr), { speed: 0.4 }), () => (slip = Math.max(slip, w.tactile.slipSpeed)));
  run(w, 0.5);
  const g = w.pose('g')!;
  assert(g.y < T + 0.06, 'can was lifted with worn pads');
  assert(slip > 0.01, 'slip was not sensed');
  ok('insufficient friction', `pads at mu 0.05 need ${(3.63 / (2 * 0.05)).toFixed(0)} N per finger; with 25 N the can stayed down, slip sensed at ${(slip * 1000).toFixed(0)} mm/s`);
}

// 6. Excessive payload, part 1: a 15 kg block at the normal 25 N squeeze slides out of the pads.
{
  const w = await world();
  w.spawn({ id: 'h', name: 'Red Cube', shape: 'box', mass: 15 }, { x: 0.15, z: 0.05 });
  run(w, 0.5);
  const wr = await pickAt(w, 0.15, 0.05, T + 0.034);
  let slip = 0;
  await drive(w, w.followPath(linePath(P(0.15, T + 0.034, 0.05), P(0.15, T + 0.18, 0.05), base, null, wr), { speed: 0.4 }), () => (slip = Math.max(slip, w.tactile.slipSpeed)));
  run(w, 0.5);
  assert(w.pose('h')!.y < T + 0.05, '15 kg block was lifted with a 25 N squeeze');
  ok('payload beyond grip', `15 kg needs ${(147 / (2 * 1.6)).toFixed(0)} N per finger at mu 1.6; at 25 N it stayed on the table, slip ${(slip * 1000).toFixed(0)} mm/s`);
}

// 7. Excessive payload, part 2: squeezed hard enough to hold, 22 kg far out exceeds the shoulder and elbow ratings.
{
  const w = await world();
  const x = 0.42, z = 0.25;
  w.spawn({ id: 'h', name: 'Red Cube', shape: 'box', mass: 22 }, { x, z });
  run(w, 0.5);
  const wr = await pickAt(w, x, z, T + 0.034, 140);
  let peak = [0, 0, 0, 0, 0, 0];
  const r = await drive(w, w.followPath(linePath(P(x, T + 0.034, z), P(x, T + 0.2, z), base, null, wr), { speed: 0.4 }), () => {
    const e = w.jointEfforts;
    peak = peak.map((v, i) => Math.max(v, Math.abs(e[i])));
  });
  run(w, 1, () => { const e = w.jointEfforts; peak = peak.map((v, i) => Math.max(v, Math.abs(e[i]))); });
  const tcp = tcpPosition(w.jointPositions(), base);
  const sag = T + 0.2 - tcp.y;
  assert(r.saturated.length > 0, 'no joint saturated under 22 kg');
  assert(w.tactile.pinched && w.pose('h')!.y > T + 0.05, 'the 22 kg block was not held: this scenario must isolate motor saturation from slip');
  assert(sag > 0.01, `arm reached the target under 22 kg (sag ${sag})`);
  ok('joint motor saturation', `22 kg held at ${Math.hypot(x - base.x, z - base.z).toFixed(2)} m reach: joint${r.saturated.length > 1 ? "s" : ""} ${r.saturated.map((i) => i + 1).join(', ')} at ${r.saturated.length > 1 ? 'their limits' : 'its limit'} (peak ${peak.slice(0, 3).map((v) => v.toFixed(0)).join(' / ')} N m of 150), tool ended ${(sag * 1000).toFixed(0)} mm below target`);
}

// 8. Normal payload for comparison: a 330 g mug stays well inside the ratings.
{
  const w = await world();
  w.spawn({ id: 'm', name: 'Coffee Mug', shape: 'mug' }, { x: 0.42, z: 0.25 });
  run(w, 0.5);
  const wr = await pickAt(w, 0.42, 0.25, T + 0.059);
  const r = await drive(w, w.followPath(linePath(P(0.42, T + 0.059, 0.25), P(0.42, T + 0.2, 0.25), base, null, wr), { speed: 0.4 }));
  assert.equal(r.saturated.length, 0);
  assert(w.pose('m')!.y > T + 0.15, 'mug not lifted');
  ok('normal payload', `330 g mug at the same reach: peak ${(r.peakTorqueRatio * 100).toFixed(0)}% of rated torque, lifted`);
}

console.log(results.join('\n'));
