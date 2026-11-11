// Headless physics checks (no browser): free fall and bounce against theory, sliding friction, and scripted
// pick / carry / set-down trials for every object kind with perfect perception, so a failure here is the physics
// or the gripper, not the camera.   npm run test:physics [basic|grasp] [kind|-] [trials]
import { PhysicsWorld, SIM_DT } from '../src/sim/world';
import { solveIK, tcpPosition, wristForJawYaw, linePath, GRASP_MIN_TCP_HEIGHT } from '../src/sim/kinematics';
import { kindPhysics } from '../src/sim/objectPhysics';
import { OBJECT_HEIGHT, GRIPPER_MAX_OPEN } from '../src/sim/physics';
import { ALL_KINDS, type ObjectKind } from '../src/sim/objectMeshes';

const base = { x: -0.35, y: 0.45, z: -0.05 };
const NAMES: Record<ObjectKind, { name: string; shape: string }> = {
  cube: { name: 'Red Cube', shape: 'box' }, book: { name: 'Notebook', shape: 'box' }, ruler: { name: 'Ruler', shape: 'box' },
  eraser: { name: 'Eraser', shape: 'box' }, can: { name: 'Soda Can', shape: 'cylinder' }, sphere: { name: 'Rubber Ball', shape: 'sphere' },
  orange: { name: 'Orange', shape: 'sphere' }, apple: { name: 'Red Apple', shape: 'apple' }, tennis_ball: { name: 'Tennis Ball', shape: 'sphere' },
  mug: { name: 'Coffee Mug', shape: 'mug' }, glass: { name: 'Water Glass', shape: 'glass' }, pen: { name: 'Writing Pen', shape: 'cylinder' },
  scissors: { name: 'Office Scissors', shape: 'box' }, stapler: { name: 'Paper Stapler', shape: 'box' }
};

function run(w: PhysicsWorld, seconds: number) {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) w.step();
}
async function drive<T>(w: PhysicsWorld, p: Promise<T>, maxSeconds = 20): Promise<T> {
  let done = false;
  let val!: T;
  p.then((v) => { done = true; val = v; });
  for (let i = 0; i < maxSeconds / SIM_DT && !done; i++) {
    w.step();
    if (i % 8 === 0) await Promise.resolve();
  }
  await Promise.resolve();
  if (!done) throw new Error('timeout');
  return val;
}
const pose = (x: number, y: number, z: number, yaw: number | null) => {
  const q = solveIK(x, y, z, base);
  if (yaw !== null) q[5] = wristForJawYaw(q, base, yaw);
  return q;
};

async function freeFall() {
  const w = new PhysicsWorld();
  await w.init(base);
  const r = 0.0335;
  w.spawn({ id: 'b', ...NAMES.tennis_ball }, { x: 0.2, z: 0.1, y: 0.45 + r + 1.0 });
  let tHit = -1, peak = 0, hit = false;
  for (let i = 0; i < 3 / SIM_DT; i++) {
    w.step();
    const y = w.pose('b')!.y - 0.45 - r;
    if (!hit && y <= 0.0015) { hit = true; tHit = w.time; }
    else if (hit && w.time > tHit + 0.03) peak = Math.max(peak, y);
  }
  console.log(`free fall 1 m: hit at ${tHit.toFixed(4)} s (ideal ${Math.sqrt(2 / 9.81).toFixed(4)} s); first bounce ${peak.toFixed(3)} m (e^2 h = ${(0.72 * 0.72).toFixed(3)} m)`);
}

async function slope() {
  // friction: a block pushed at 1 m/s on the table should stop after v^2 / (2 mu g)
  const w = new PhysicsWorld();
  await w.init(base);
  w.spawn({ id: 'c', ...NAMES.cube }, { x: 0.0, z: 0.0 });
  run(w, 0.5);
  const x0 = w.pose('c')!.x;
  (w as any).objects.get('c').body.setLinvel({ x: 1, y: 0, z: 0 }, true);
  run(w, 2);
  const d = w.pose('c')!.x - x0;
  console.log(`sliding block: travelled ${d.toFixed(3)} m at 1 m/s (ideal for mu=0.5: ${(1 / (2 * 0.5 * 9.81)).toFixed(3)} m, plus damping)`);
}

async function graspTrial(kind: ObjectKind, yawObj: number, off: { x: number; z: number }, verbose = false) {
  const w = new PhysicsWorld();
  await w.init(base);
  const X = 0.15, Z = 0.05;
  w.spawn({ id: 'o', ...NAMES[kind] }, { x: X, z: Z, yaw: yawObj });
  run(w, 0.6);
  const p0 = w.pose('o')!;
  const h = OBJECT_HEIGHT[kind];
  const tcpY = 0.45 + Math.max(h / 2, h - 0.026, GRASP_MIN_TCP_HEIGHT);
  // jaw across the narrow side
  const jaw = kind === 'stapler' ? -yawObj : Math.PI / 2 - yawObj;
  const round = ['can', 'sphere', 'orange', 'apple', 'tennis_ball', 'glass'].includes(kind);
  const yaw = round ? null : jaw;
  const gx = p0.x + off.x, gz = p0.z + off.z;
  const P = (x: number, y: number, z: number) => ({ x, y, z });
  w.commandGripper(GRIPPER_MAX_OPEN);
  await drive(w, w.followPath([w.jointPositions(), pose(gx, tcpY + 0.1, gz, yaw)], { speed: 0.6 }));
  const wr = w.jointPositions()[5];
  await drive(w, w.followPath(linePath(P(gx, tcpY + 0.1, gz), P(gx, tcpY, gz), base, null, wr), { speed: 0.3 }));
  const tcp = tcpPosition(w.jointPositions(), base);
  w.commandGripper(0);
  await drive(w, w.gripperSettled());
  const width = w.fingerGap;
  const eff = w.gripEffort;
  await drive(w, w.followPath(linePath(P(gx, tcpY, gz), P(gx, tcpY + 0.15, gz), base, null, wr), { speed: 0.5 }));
  const lifted = w.pose('o')!.y - p0.y;
  await drive(w, w.followPath([w.jointPositions(), pose(gx + 0.15, tcpY + 0.15, gz + 0.12, null)], { speed: 0.6 }));
  run(w, 0.2);
  const carried = w.pose('o')!;
  const heldAfterCarry = carried.y - p0.y > 0.1 && w.isPinched('o');
  const widthAfter = w.fingerGap;
  // put down
  await drive(w, w.followPath(linePath(P(gx + 0.15, tcpY + 0.15, gz + 0.12), P(gx + 0.15, tcpY + 0.004, gz + 0.12), base, null, 0), { speed: 0.3 }));
  w.commandGripper(Math.min(GRIPPER_MAX_OPEN, width + 0.025));
  await drive(w, w.gripperSettled());
  run(w, 0.6);
  await drive(w, w.followPath(linePath(P(gx + 0.15, tcpY + 0.004, gz + 0.12), P(gx + 0.15, tcpY + 0.15, gz + 0.12), base, null, 0), { speed: 0.5 }));
  run(w, 0.5);
  const end = w.pose('o')!;
  const placed = Math.hypot(end.x - (gx + 0.15), end.z - (gz + 0.12)) < 0.04 && end.y > 0.44;
  const ok = heldAfterCarry && placed;
  if (verbose || !ok)
    console.log(
      `  ${kind.padEnd(11)} yaw ${yawObj.toFixed(2)} off(${(off.x * 1000).toFixed(0)},${(off.z * 1000).toFixed(0)}) width ${(width * 1000).toFixed(1)} mm effort ${eff.toFixed(0)} N lift ${(lifted * 1000).toFixed(0)} mm carried ${heldAfterCarry} widthAfter ${(widthAfter * 1000).toFixed(1)} placed ${placed} (end ${end.x.toFixed(3)},${end.y.toFixed(3)},${end.z.toFixed(3)}; tcp err ${(Math.hypot(tcp.x - gx, tcp.z - gz) * 1000).toFixed(1)} mm) stepMs ${w.stepMs.toFixed(3)}`
    );
  return ok;
}

const mode = process.argv[2] ?? 'all';
if (mode === 'all' || mode === 'basic') {
  await freeFall();
  await slope();
}
if (mode === 'all' || mode === 'grasp') {
  const only = process.argv[3] as ObjectKind | undefined;
  const trials = Number(process.argv[4] ?? 6);
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const kind of only && only !== ('-' as any) ? [only] : ALL_KINDS) {
    let ok = 0;
    for (let t = 0; t < trials; t++) {
      const yaw = t === 0 ? kindPhysics(kind).spawnYaw : rand() * Math.PI * 2;
      const off = t === 0 ? { x: 0, z: 0 } : { x: (rand() - 0.5) * 0.008, z: (rand() - 0.5) * 0.008 };
      try {
        if (await graspTrial(kind, yaw, off, trials <= 2)) ok++;
      } catch (e) {
        console.log(`  ${kind} trial ${t} error: ${(e as Error).message}`);
      }
    }
    console.log(`${kind.padEnd(11)} ${ok}/${trials}`);
  }
}
