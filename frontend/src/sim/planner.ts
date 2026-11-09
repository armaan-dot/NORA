/**
 * Joint-space motion planner (RRT-Connect + shortcut smoothing), the same algorithm family
 * MoveIt's OMPL RRTConnect uses, running against the collision world in collision.ts.
 */
import { armClearance, type CollisionWorld } from './collision';
import { JOINT_LIMITS, type BasePose } from './kinematics';

export interface PlanResult {
  ok: boolean;
  /** Joint waypoints (6 arm joints), start first and goal last. */
  path: number[][];
  iterations: number;
  planningMs: number;
  /** Smallest arm-to-obstacle gap along the final path (m). */
  minClearance: number;
  /** Closest obstacle along the final path. */
  nearest: string;
  reason?: string;
}

export interface PlanOptions {
  maxIterations?: number;
  timeBudgetMs?: number;
  stepSize?: number; // RRT extension step (rad, max-norm)
  edgeResolution?: number; // collision check spacing along edges (rad)
  seed?: number;
}

const DIM = 6;
const MARGIN = 0.003;

// Small deterministic PRNG so plans are repeatable.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = (a: number[], b: number[]) => {
  let m = 0;
  for (let i = 0; i < DIM; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

interface Node {
  q: number[];
  parent: number; // index in the same tree, -1 for the root
}

/** Check a straight joint-space segment; returns the smallest clearance seen, or -Infinity if blocked. */
function edgeClearance(
  a: number[],
  b: number[],
  base: BasePose,
  world: CollisionWorld,
  res: number
): { clearance: number; nearest: string } {
  const n = Math.max(1, Math.ceil(dist(a, b) / res));
  let min = Infinity;
  let nearest = 'none';
  const q = new Array<number>(DIM);
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    for (let i = 0; i < DIM; i++) q[i] = a[i] + (b[i] - a[i]) * t;
    const info = armClearance(q, base, world);
    if (info.clearance < min) {
      min = info.clearance;
      nearest = info.nearest;
    }
    if (min <= MARGIN) return { clearance: -Infinity, nearest };
  }
  return { clearance: min, nearest };
}

export function pathClearance(path: number[][], base: BasePose, world: CollisionWorld, res = 0.05) {
  let min = armClearance(path[0], base, world).clearance;
  let nearest = 'none';
  for (let i = 1; i < path.length; i++) {
    const e = edgeClearance(path[i - 1], path[i], base, world, res);
    if (e.clearance < min) {
      min = e.clearance;
      nearest = e.nearest;
    }
  }
  return { clearance: min, nearest };
}

export function planJointPath(
  start: number[],
  goal: number[],
  base: BasePose,
  world: CollisionWorld,
  opts: PlanOptions = {}
): PlanResult {
  const t0 = performance.now();
  const maxIterations = opts.maxIterations ?? 4000;
  const timeBudget = opts.timeBudgetMs ?? 400;
  const step = opts.stepSize ?? 0.35;
  const res = opts.edgeResolution ?? 0.06;
  const rand = mulberry32(opts.seed ?? 7);
  const s = start.slice(0, DIM);
  const g = goal.slice(0, DIM);

  const fail = (reason: string, iterations = 0): PlanResult => ({
    ok: false,
    path: [],
    iterations,
    planningMs: performance.now() - t0,
    minClearance: -Infinity,
    nearest: 'none',
    reason
  });

  const startInfo = armClearance(s, base, world);
  if (startInfo.clearance <= MARGIN) return fail(`start state in collision (${startInfo.nearest})`);
  const goalInfo = armClearance(g, base, world);
  if (goalInfo.clearance <= MARGIN) return fail(`goal state in collision (${goalInfo.nearest})`);

  // Direct connection first (most skill moves are short and unobstructed).
  const direct = edgeClearance(s, g, base, world, res);
  if (direct.clearance > MARGIN) {
    return finish([s, g], 0);
  }

  const sample = (): number[] => {
    const q = new Array<number>(DIM);
    for (let i = 0; i < DIM; i++) {
      const lo = Math.max(JOINT_LIMITS[i][0], -Math.PI);
      const hi = Math.min(JOINT_LIMITS[i][1], Math.PI);
      q[i] = lo + (hi - lo) * rand();
    }
    return q;
  };

  const treeA: Node[] = [{ q: s, parent: -1 }];
  const treeB: Node[] = [{ q: g, parent: -1 }];
  const nearestIdx = (tree: Node[], q: number[]) => {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < tree.length; i++) {
      let d = 0;
      for (let k = 0; k < DIM; k++) {
        const x = tree[i].q[k] - q[k];
        d += x * x;
      }
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi;
  };

  /** Move one step from the nearest node toward q; returns index of the new node, or -1 if blocked. */
  const extend = (tree: Node[], q: number[]): number => {
    const ni = nearestIdx(tree, q);
    const from = tree[ni].q;
    const d = dist(from, q);
    const next = d <= step ? q.slice() : from.map((v, i) => v + ((q[i] - v) * step) / d);
    const e = edgeClearance(from, next, base, world, res);
    if (e.clearance <= MARGIN) return -1;
    tree.push({ q: next, parent: ni });
    return tree.length - 1;
  };

  const connect = (tree: Node[], q: number[]): number => {
    let last = -1;
    for (let guard = 0; guard < 60; guard++) {
      const idx = extend(tree, q);
      if (idx < 0) return last === -1 ? -1 : -2; // trapped
      last = idx;
      if (dist(tree[idx].q, q) < 1e-6) return idx; // reached
    }
    return -2;
  };

  const trace = (tree: Node[], idx: number): number[][] => {
    const out: number[][] = [];
    for (let i = idx; i >= 0; i = tree[i].parent) out.push(tree[i].q);
    return out.reverse();
  };

  let a = treeA;
  let b = treeB;
  let swapped = false;
  for (let it = 1; it <= maxIterations; it++) {
    if (performance.now() - t0 > timeBudget) return fail('planning time budget exceeded', it);
    const target = rand() < 0.1 ? (swapped ? s : g) : sample();
    const ia = extend(a, target);
    if (ia >= 0) {
      const ib = connect(b, a[ia].q);
      if (ib >= 0) {
        // root(a) -> meeting point -> root(b); `a` may be either tree, so orient start -> goal afterwards.
        const joined = [...trace(a, ia), ...trace(b, ib).reverse().slice(1)];
        return finish(dist(joined[0], s) < 1e-6 ? joined : joined.reverse(), it);
      }
    }
    [a, b] = [b, a];
    swapped = !swapped;
  }
  return fail('no path found within iteration limit', maxIterations);

  function finish(raw: number[][], iterations: number): PlanResult {
    const smooth = shortcut(raw);
    const pc = pathClearance(smooth, base, world, res);
    return {
      ok: true,
      path: smooth,
      iterations,
      planningMs: performance.now() - t0,
      minClearance: pc.clearance,
      nearest: pc.nearest
    };
  }

  function shortcut(path: number[][]): number[][] {
    let p = path.map((q) => q.slice());
    for (let k = 0; k < 60 && p.length > 2; k++) {
      const i = Math.floor(rand() * (p.length - 2));
      const j = i + 2 + Math.floor(rand() * (p.length - i - 2));
      if (j >= p.length) continue;
      if (edgeClearance(p[i], p[j], base, world, res).clearance > MARGIN) p = [...p.slice(0, i + 1), ...p.slice(j)];
    }
    return p;
  }
}

/** Total joint-space length of a path (max-norm per segment, rad). */
export function pathLength(path: number[][]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += dist(path[i - 1], path[i]);
  return len;
}

/** Position along a polyline at fraction t in [0,1] (by joint-space arc length). */
export function samplePath(path: number[][], t: number): number[] {
  if (path.length === 1) return path[0].slice();
  const total = pathLength(path);
  if (total < 1e-9) return path[path.length - 1].slice();
  let remaining = Math.min(1, Math.max(0, t)) * total;
  for (let i = 1; i < path.length; i++) {
    const seg = dist(path[i - 1], path[i]);
    if (remaining <= seg || i === path.length - 1) {
      const f = seg > 1e-9 ? Math.min(1, remaining / seg) : 1;
      return path[i - 1].map((v, k) => v + (path[i][k] - v) * f);
    }
    remaining -= seg;
  }
  return path[path.length - 1].slice();
}
