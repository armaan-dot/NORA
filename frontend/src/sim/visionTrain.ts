/**
 * Training-data generation and evaluation for the vision classifier (run from the browser with ?debug).
 *
 * Scenes are rendered in the simulator with random objects, colours, positions, yaw and camera poses.
 * The OpenCV region features are what the classifier sees; the object-ID render pass is used ONLY to say
 * which object a region really is (the label). At run time that pass is never used.
 */
import { ALL_KINDS, KIND_GROUP, objectKind, type ObjectKind } from './objectMeshes';
import { associate, describeRegions, VisionClassifier, type Kind, type VisionConfig } from './vision';
import type { WristCamera } from './wristCamera';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Sample {
  features: number[];
  label: Kind;
  scene: number;
}

const PALETTE = [
  '#c0392b', '#e11d48', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#10b981', '#14b8a6', '#0ea5e9', '#2563eb',
  '#6366f1', '#a855f7', '#ec4899', '#8B4513', '#f8fafc', '#334155', '#cbd5e1', '#38bdf8', '#65a30d', '#e11d48'
];

const SPEC: Record<ObjectKind, { names: string[]; shape: string }> = {
  cube: { names: ['Block', 'Red Cube', 'Yellow Box', 'Blue Package'], shape: 'box' },
  book: { names: ['Notebook', 'Notebook Journal'], shape: 'box' },
  ruler: { names: ['Ruler', 'Desk Ruler'], shape: 'box' },
  eraser: { names: ['Eraser', 'Pink Eraser'], shape: 'box' },
  can: { names: ['Soda Can', 'Blue Cylinder', 'Purple Canister'], shape: 'cylinder' },
  sphere: { names: ['Rubber Ball', 'Green Sphere'], shape: 'sphere' },
  orange: { names: ['Orange Fruit', 'Orange'], shape: 'sphere' },
  apple: { names: ['Red Apple', 'Green Apple'], shape: 'apple' },
  tennis_ball: { names: ['Tennis Ball'], shape: 'sphere' },
  mug: { names: ['Coffee Mug', 'Tea Cup'], shape: 'mug' },
  glass: { names: ['Water Glass', 'Glass'], shape: 'glass' },
  pen: { names: ['Writing Pen', 'Yellow Pencil', 'Highlighter'], shape: 'cylinder' },
  scissors: { names: ['Office Scissors'], shape: 'box' },
  stapler: { names: ['Paper Stapler'], shape: 'box' }
};

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

interface Ctx {
  ros: any;
  cam: WristCamera;
  meshes: () => Record<string, any>;
  cfg: VisionConfig;
}

function ctx(): Ctx {
  const w = window as any;
  const ros = w.__nora.rosService;
  return {
    ros,
    cam: w.__noraView.wristCam,
    meshes: () => w.__noraView.objectMeshes.current,
    cfg: { tableY: ros.robotBasePos.y, base: { x: ros.robotBasePos.x, z: ros.robotBasePos.z } }
  };
}

interface Placed {
  id: string;
  kind: ObjectKind;
}

/** Fill the table with a random arrangement. Objects keep the stored height the app gives them. */
async function randomScene(c: Ctx, rand: () => number, kinds: ObjectKind[], crowd: number): Promise<Placed[]> {
  c.ros.clearAllObjects();
  await nextFrame();
  const placed: { x: number; z: number }[] = [];
  const out: Placed[] = [];
  const base = c.ros.robotBasePos;
  for (const kind of kinds) {
    const spec = SPEC[kind];
    const name = spec.names[Math.floor(rand() * spec.names.length)];
    const colour = PALETTE[Math.floor(rand() * PALETTE.length)];
    const obj = c.ros.addObject({ name, shape: spec.shape, color: colour, zone: 'auto' });
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 60; tries++) {
      x = -0.12 + rand() * 0.67;
      z = -0.34 + rand() * 0.68;
      if (Math.hypot(x - base.x, z - base.z) < 0.22) continue;
      if (placed.every((p) => Math.hypot(p.x - x, p.z - z) > crowd)) break;
    }
    placed.push({ x, z });
    c.ros.setObjectPosition(obj.id, { x, y: obj.position.y, z });
    const mesh = c.meshes()[obj.id];
    if (mesh) {
      mesh.position.set(x, obj.position.y, z);
      mesh.rotation.y = rand() * Math.PI * 2;
    }
    out.push({ id: obj.id, kind: objectKind(obj) });
  }
  await nextFrame();
  return out;
}

async function randomPose(c: Ctx, rand: () => number) {
  const base = c.ros.robotBasePos;
  const t = rand();
  let q: number[];
  if (t < 0.55) {
    const ik = c.ros.solveDynamicIK(-0.05 + rand() * 0.5, base.y + 0.38 + rand() * 0.17, -0.24 + rand() * 0.48);
    q = [ik[0] + (rand() - 0.5) * 0.3, ik[1], ik[2], ik[3], ik[4], (rand() - 0.5) * 1.2];
  } else if (t < 0.8) {
    const s = [-0.33, -0.3, 1.3, Math.PI / 4 - 1.0, -Math.PI / 2, 0];
    q = s.map((v, i) => v + (i < 4 ? (rand() - 0.5) * 0.25 : 0));
  } else {
    const h = [-0.37, -0.35, 1.9, 0.02, -Math.PI / 2, 0];
    q = h.map((v, i) => v + (i < 4 ? (rand() - 0.5) * 0.25 : 0));
  }
  c.ros.currentJointPositions = [...q, 0.03];
  c.ros.publishJointState();
  await nextFrame();
}

/** Render scenes and collect labelled region features. */
export async function collect(opts: { scenes: number; seed: number; minObjects?: number; maxObjects?: number; viewsPerScene?: number }): Promise<Sample[]> {
  const c = ctx();
  const rand = mulberry(opts.seed);
  const samples: Sample[] = [];
  const views = opts.viewsPerScene ?? 3;
  for (let s = 0; s < opts.scenes; s++) {
    const n = (opts.minObjects ?? 3) + Math.floor(rand() * ((opts.maxObjects ?? 7) - (opts.minObjects ?? 3) + 1));
    // cycle kinds so every class is well represented, plus random extras
    const kinds: ObjectKind[] = [];
    for (let i = 0; i < n; i++) kinds.push(ALL_KINDS[(s * 3 + i * 5 + Math.floor(rand() * 3)) % ALL_KINDS.length]);
    const placed = await randomScene(c, rand, kinds, 0.1 + rand() * 0.06);
    const kindById = new Map(placed.map((p) => [p.id, p.kind]));
    for (let v = 0; v < views; v++) {
      await randomPose(c, rand);
      const frame = c.cam.capture({ truth: true });
      const regions = await describeRegions(frame, c.cfg);
      const { mask, ids } = frame.truth!;
      const visible = new Array(ids.length + 1).fill(0);
      for (let i = 0; i < mask.length; i++) visible[mask[i]]++;
      for (const r of regions) {
        const tally = new Array(ids.length + 1).fill(0);
        for (const i of r.pixels) tally[mask[i]]++;
        let best = 0;
        for (let t = 1; t < tally.length; t++) if (tally[t] > tally[best]) best = t;
        const share = tally[best] / r.pixels.length;
        let label: Kind | null = null;
        if (best === 0 && share >= 0.85) label = 'background';
        else if (best > 0 && share >= 0.7 && tally[best] >= 0.4 * visible[best]) label = kindById.get(ids[best - 1]) ?? null;
        if (label) samples.push({ features: r.features, label, scene: s });
      }
    }
  }
  return samples;
}

export interface EvalReport {
  samples: number;
  accuracy: number;
  perClass: Record<string, { n: number; recall: number }>;
  confusions: { truth: string; predicted: string; n: number }[];
}

export function evaluate(clf: VisionClassifier, samples: Sample[]): EvalReport {
  const per: Record<string, { n: number; ok: number }> = {};
  const conf = new Map<string, number>();
  let ok = 0;
  for (const s of samples) {
    const p = clf.classify(s.features).kind;
    (per[s.label] ??= { n: 0, ok: 0 }).n++;
    if (p === s.label) {
      ok++;
      per[s.label].ok++;
    } else conf.set(`${s.label}>${p}`, (conf.get(`${s.label}>${p}`) ?? 0) + 1);
  }
  return {
    samples: samples.length,
    accuracy: ok / Math.max(1, samples.length),
    perClass: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { n: v.n, recall: v.ok / v.n }])),
    confusions: [...conf.entries()].map(([k, n]) => ({ truth: k.split('>')[0], predicted: k.split('>')[1], n })).sort((a, b) => b.n - a.n).slice(0, 12)
  };
}

/** Fit a model from samples. */
export function fit(samples: Sample[], k = 7) {
  return VisionClassifier.fit(samples.map((s) => s.features), samples.map((s) => s.label), k);
}

export interface RuntimeReport {
  scenes: number;
  detections: number;
  kindAccuracy: number;
  groupAccuracy: number;
  idAccuracy: number;
  positionErrorMm: { median: number; p90: number; max: number };
  recall: number;
  visibleObjects: number;
  falsePositives: number;
  perKind: Record<string, { n: number; kindOk: number; idOk: number }>;
  confusions: { truth: string; predicted: string; n: number }[];
  complete: { n: number; kindOk: number; idOk: number };
  cropped: { n: number; kindOk: number; idOk: number };
}

/**
 * Score the full run-time path on fresh random scenes: RGB + depth -> OpenCV -> classifier -> association.
 * The object-ID pass is used here only to know what was really there.
 */
export async function evaluateRuntime(opts: { scenes: number; seed: number; views?: number }): Promise<RuntimeReport> {
  const c = ctx();
  const rand = mulberry(opts.seed);
  let det = 0, kindOk = 0, groupOk = 0, idOk = 0, fp = 0, visible = 0, found = 0;
  const errs: number[] = [];
  const perKind: RuntimeReport['perKind'] = {};
  const conf = new Map<string, number>();
  const complete = { n: 0, kindOk: 0, idOk: 0 };
  const cropped = { n: 0, kindOk: 0, idOk: 0 };
  for (let s = 0; s < opts.scenes; s++) {
    const n = 3 + Math.floor(rand() * 5);
    const kinds: ObjectKind[] = Array.from({ length: n }, () => ALL_KINDS[Math.floor(rand() * ALL_KINDS.length)]);
    await randomScene(c, rand, kinds, 0.12 + rand() * 0.05);
    for (let v = 0; v < (opts.views ?? 2); v++) {
      await randomPose(c, rand);
      const frame = await c.ros.perceptionProvider(); // exactly what the robot runs
      const objs = c.ros.getObjects() as any[];
      const registry = objs.map((o) => ({ id: o.id, name: o.name, shape: o.shape, color: o.color, position: { x: o.position.x, z: o.position.z } }));
      const matched = associate(frame.detections, registry, {});
      const truthFrame = c.cam.capture({ truth: true });
      const { mask, ids } = truthFrame.truth!;
      const W = truthFrame.width;
      const seenIds = new Set<string>();
      // what is really there and fully in view
      const visPx = new Array(ids.length + 1).fill(0);
      for (let i = 0; i < mask.length; i++) visPx[mask[i]]++;
      for (const m of matched) {
        const [x0, y0, x1, y1] = m.rec.bbox;
        const tally = new Array(ids.length + 1).fill(0);
        let total = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { tally[mask[y * W + x]]++; total++; }
        let best = 1;
        for (let t = 2; t < tally.length; t++) if (tally[t] > tally[best]) best = t;
        if (tally[best] / Math.max(1, total) < 0.25) {
          fp++;
          continue;
        }
        const truthObj = objs.find((o) => o.id === ids[best - 1]);
        if (!truthObj) continue;
        const tk = objectKind(truthObj);
        seenIds.add(truthObj.id);
        det++;
        const kOk = tk === m.rec.kind;
        if (kOk) kindOk++;
        else conf.set(tk + '>' + m.rec.kind, (conf.get(tk + '>' + m.rec.kind) ?? 0) + 1);
        if (m.rec.kind !== 'unknown' && KIND_GROUP[tk] === KIND_GROUP[m.rec.kind]) groupOk++;
        const iOk = m.id === truthObj.id;
        if (iOk) idOk++;
        const bucket = m.rec.truncated ? cropped : complete;
        bucket.n++;
        if (kOk) bucket.kindOk++;
        if (iOk) bucket.idOk++;
        const pk = (perKind[tk] ??= { n: 0, kindOk: 0, idOk: 0 });
        pk.n++;
        if (kOk) pk.kindOk++;
        if (iOk) pk.idOk++;
        errs.push(Math.hypot(m.rec.position.x - truthObj.position.x, m.rec.position.z - truthObj.position.z) * 1000);
      }
      ids.forEach((id, idx) => {
        if (visPx[idx + 1] >= 60) {
          visible++;
          if (seenIds.has(id)) found++;
        }
      });
    }
  }
  errs.sort((a, b) => a - b);
  const q = (p: number) => errs[Math.min(errs.length - 1, Math.floor(errs.length * p))] ?? 0;
  return {
    scenes: opts.scenes,
    detections: det,
    kindAccuracy: kindOk / Math.max(1, det),
    groupAccuracy: groupOk / Math.max(1, det),
    idAccuracy: idOk / Math.max(1, det),
    positionErrorMm: { median: q(0.5), p90: q(0.9), max: errs[errs.length - 1] ?? 0 },
    recall: found / Math.max(1, visible),
    visibleObjects: visible,
    falsePositives: fp,
    perKind,
    confusions: [...conf.entries()].map(([k, n]) => ({ truth: k.split('>')[0], predicted: k.split('>')[1], n })).sort((a, b) => b.n - a.n).slice(0, 10),
    complete,
    cropped
  };
}
