/**
 * Object recognition from an RGB-D frame. No scene knowledge is used:
 *
 *   1. Back-project depth into the world and keep pixels that stand above the table (height gate),
 *      excluding the gripper's own view and the robot base footprint.
 *   2. OpenCV.js: morphological opening, connected components, contours, moments, HSV colour.
 *   3. Describe each region with scale-aware features (real-world footprint, height, roundness,
 *      solidity, flat-top fraction, Hu moments).
 *   4. A k-NN classifier trained on renders from this simulator names the region
 *      (including a "background" class for fixtures such as the tote walls).
 *   5. Colour is named from HSV. Detections are then matched to named objects (association).
 *
 * The object-ID render pass is only used to label training data and to score accuracy.
 */
import * as THREE from 'three';
import { ALL_KINDS, KIND_GROUP, objectKind, type ObjectKind } from './objectMeshes';
import type { CameraFrame } from './wristCamera';
import { TOTE_GEOM, toteBoxes } from './physics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

export type Kind = ObjectKind | 'background';

export interface Recognition {
  kind: ObjectKind | 'unknown';
  /** Vote share of the winning class among the nearest training examples (0..1). */
  confidence: number;
  scores: Record<string, number>;
  colour: string;
  /** Hue 0..360, saturation 0..1, value 0..1 of the object's interior pixels. */
  hsv: [number, number, number];
  label: string;
  /** Estimated object centre in scene coordinates. */
  position: { x: number; y: number; z: number };
  maskPixels: number;
  bbox: [number, number, number, number];
  depthM: number;
  /** Real-world size of the visible region (m). */
  extent: { major: number; minor: number; height: number };
  /** True if the region touches the image border, so its shape is incomplete. */
  truncated: boolean;
  /**
   * Smallest rectangle (on the table plane) around the object's top surface: its long-axis direction as an angle
   * atan2(z, x) in the scene, and its side lengths (m). This is what a grasp is planned from.
   */
  top: { yaw: number; major: number; minor: number; x: number; z: number };
}

/** A recognition matched to a named object in the object database. */
export type Perceived = Recognition & { id: string };

export interface Region {
  features: number[];
  /** Pixel indices (row-major) of the region. */
  pixels: Int32Array;
  rec: Recognition;
}

export interface VisionConfig {
  /** Table surface height (scene y). */
  tableY: number;
  /** Robot base axis; pixels around it are the robot itself, not an object. */
  base: { x: number; z: number };
}

// ---------------------------------------------------------------------------------------------
// OpenCV.js (lazy: ~11 MB, loaded the first time the camera is used)
// ---------------------------------------------------------------------------------------------

// NOTE: the OpenCV module is "thenable". Returning it from a promise (or awaiting it) makes JavaScript keep
// calling its then() forever, so it is only ever passed around inside a plain { cv } wrapper.
let cvPromise: Promise<{ cv: CV }> | null = null;

export function loadOpenCv(): Promise<{ cv: CV }> {
  cvPromise ??= import('./opencvLoader')
    .then(
      (loader) =>
        new Promise<{ cv: CV }>((resolve) => {
          // The Emscripten module is thenable: only ever resolve with a wrapper object, never the module.
          const cv: CV = loader.cvBox.cv;
          if (cv && cv.Mat) return resolve({ cv });
          const prev = cv.onRuntimeInitialized;
          cv.onRuntimeInitialized = () => {
            prev?.();
            resolve({ cv });
          };
          if (typeof cv.then === 'function') cv.then((m: CV) => resolve({ cv: m && m.Mat ? m : cv }));
        })
    )
    .then((box) => ({ cv: box.cv }));
  return cvPromise;
}

// ---------------------------------------------------------------------------------------------
// Colour naming
// ---------------------------------------------------------------------------------------------

export function colourName(h: number, s: number, v: number): string {
  if (v < 0.2) return 'black';
  if (s < 0.14) return v > 0.78 ? 'white' : 'grey';
  if (s < 0.22 && v > 0.85) return 'white';
  if (h < 12 || h >= 342) return v < 0.5 && s > 0.35 ? 'brown' : 'red';
  if (h < 40) return v < 0.62 ? 'brown' : 'orange';
  if (h < 68) return 'yellow';
  if (h < 160) return 'green';
  if (h < 200) return 'teal';
  if (h < 255) return 'blue';
  if (h < 298) return 'purple';
  return 'pink';
}

export function hexToHsv(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

// ---------------------------------------------------------------------------------------------
// Classifier (k-NN over z-scored region features)
// ---------------------------------------------------------------------------------------------

export const FEATURE_NAMES = [
  'extent_major_m', 'extent_minor_m', 'height_max_m', 'height_mean_m', 'fill', 'circularity', 'solidity',
  'hu1', 'hu2', 'aspect', 'flat_top_fraction',
  'cropped',
  'texture_log', 'value_std', 'specular', 'sat_mean', 'val_mean', 'hue_cos', 'hue_sin'
];

/** Number of purely geometric features (the first block of FEATURE_NAMES). */
export const GEOMETRY_FEATURES = 11;

export interface VisionModelFile {
  version: number;
  kinds: Kind[];
  feature_names: string[];
  mean: number[];
  std: number[];
  /** z-scored training features. */
  samples: number[][];
  labels: number[];
  k: number;
  /** Nearest-neighbour distance above which a region is reported as unknown. */
  unknown_distance: number;
  stats?: Record<string, unknown>;
}

export class VisionClassifier {
  constructor(private readonly m: VisionModelFile) {}

  get sampleCount() {
    return this.m.samples.length;
  }

  private normalise(f: number[]): number[] {
    // a model may use only a prefix of the available features
    return f.slice(0, this.m.mean.length).map((v, i) => (v - this.m.mean[i]) / this.m.std[i]);
  }

  classify(features: number[]): { kind: Kind | 'unknown'; confidence: number; scores: Record<string, number>; nearest: number } {
    const q = this.normalise(features);
    const { samples, labels, k, kinds } = this.m;
    // k nearest by squared distance (partial selection)
    const best: { d: number; l: number }[] = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      let d = 0;
      for (let j = 0; j < q.length; j++) {
        const x = s[j] - q[j];
        d += x * x;
      }
      if (best.length < k || d < best[best.length - 1].d) {
        best.push({ d, l: labels[i] });
        best.sort((a, b) => a.d - b.d);
        if (best.length > k) best.pop();
      }
    }
    const votes: Record<string, number> = {};
    let total = 0;
    for (const b of best) {
      const w = 1 / (Math.sqrt(b.d) + 0.15);
      votes[kinds[b.l]] = (votes[kinds[b.l]] ?? 0) + w;
      total += w;
    }
    const scores: Record<string, number> = {};
    let top: string = 'unknown';
    let topS = -1;
    for (const [kd, w] of Object.entries(votes)) {
      scores[kd] = w / total;
      if (scores[kd] > topS) {
        topS = scores[kd];
        top = kd;
      }
    }
    const nearest = Math.sqrt(best[0]?.d ?? Infinity);
    if (nearest > this.m.unknown_distance) return { kind: 'unknown', confidence: 0, scores, nearest };
    return { kind: top as Kind, confidence: topS, scores, nearest };
  }

  /** Fit a model from raw (unnormalised) feature vectors and their labels. */
  static fit(samples: number[][], labels: Kind[], k = 7): VisionModelFile {
    const kinds: Kind[] = [...ALL_KINDS, 'background'];
    const dim = samples[0].length;
    const mean = new Array<number>(dim).fill(0);
    const std = new Array<number>(dim).fill(0);
    for (const s of samples) s.forEach((v, i) => (mean[i] += v / samples.length));
    for (const s of samples) s.forEach((v, i) => (std[i] += ((v - mean[i]) ** 2) / samples.length));
    for (let i = 0; i < dim; i++) std[i] = Math.max(Math.sqrt(std[i]), 1e-6);
    const z = samples.map((s) => s.map((v, i) => Number(((v - mean[i]) / std[i]).toFixed(4))));
    const lab = labels.map((l) => kinds.indexOf(l));

    // Unknown threshold: how far genuine examples sit from their nearest *other* example.
    const sample = Array.from({ length: Math.min(700, z.length) }, (_, i) => Math.floor((i * z.length) / Math.min(700, z.length)));
    const nn: number[] = [];
    for (const i of sample) {
      let best = Infinity;
      for (let j = 0; j < z.length; j++) {
        if (j === i) continue;
        let d = 0;
        for (let t = 0; t < dim; t++) d += (z[i][t] - z[j][t]) ** 2;
        if (d < best) best = d;
      }
      nn.push(Math.sqrt(best));
    }
    nn.sort((a, b) => a - b);
    const p99 = nn[Math.floor(nn.length * 0.99)] ?? 1;
    return { version: 1, kinds, feature_names: FEATURE_NAMES.slice(0, dim), mean, std, samples: z, labels: lab, k, unknown_distance: Number((p99 * 2.2 + 0.3).toFixed(3)) };
  }
}

let classifierPromise: Promise<VisionClassifier | null> | null = null;
let classifierOverride: VisionClassifier | null = null;

export function setClassifier(c: VisionClassifier | null) {
  classifierOverride = c;
}

function getClassifier(): Promise<VisionClassifier | null> {
  if (classifierOverride) return Promise.resolve(classifierOverride);
  classifierPromise ??= fetch('/vision_model.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j ? new VisionClassifier(j as VisionModelFile) : null))
    .catch(() => null);
  return classifierPromise;
}

// ---------------------------------------------------------------------------------------------
// Segmentation + features
// ---------------------------------------------------------------------------------------------

const GATE_MIN = 0.006; // objects must stand at least this far above the table (m)
const GATE_MAX = 0.16; // ... and the arm's own links hover above this
const MIN_RANGE = 0.2; // closer than this is the gripper's own fingers
const BASE_KEEP_OUT = 0.14; // robot base footprint radius
const MIN_AREA_PX = 14;

/**
 * Known workspace fixtures (calibration data, like the robot base): the storage tote's 5 mm walls.
 * Pixels on top of a wall are ignored so an object resting against one is not merged with it.
 * Rectangles are [x0, x1, z0, z1] in scene metres, already grown by 4 mm.
 */
const FIXTURE_WALLS: [number, number, number, number][] = toteBoxes()
  .filter((b) => b.name === 'tote_wall')
  .map(({ box }) => [box[0] - 0.004, box[1] + 0.004, box[4] - 0.004, box[5] + 0.004]);
const FIXTURE_TOP = TOTE_GEOM.wallH + 0.005; // wall height + margin (m above the table)
const onFixture = (x: number, z: number, h: number) =>
  h <= FIXTURE_TOP && FIXTURE_WALLS.some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);

const KIND_COLOURS: Record<string, [number, number, number]> = {};
const kindColour = (kind: string): [number, number, number] =>
  (KIND_COLOURS[kind] ??= (() => {
    const i = Math.max(0, ALL_KINDS.indexOf(kind as ObjectKind));
    const c = new THREE.Color().setHSL(((i + 1) * 0.381966) % 1, kind === 'background' ? 0 : 0.6, kind === 'background' ? 0.35 : 0.55);
    return [c.r * 255, c.g * 255, c.b * 255] as [number, number, number];
  })());

/**
 * Split a blob that is really several objects touching (balls side by side in the tote, say).
 * Distance transform of the blob: each object's middle is a local "core" far from the edge. Two cores joined only
 * through a narrow neck are two objects; pixels go to the nearest core. One core, or a wide join, = one object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function splitTouching(cv: any, px: number[], W: number, H: number): number[][] {
  if (px.length < 4 * MIN_AREA_PX) return [px];
  const m = cv.Mat.zeros(H, W, cv.CV_8UC1);
  const d = new cv.Mat();
  const seeds = cv.Mat.zeros(H, W, cv.CV_8UC1);
  const sl = new cv.Mat();
  try {
    for (const i of px) m.data[i] = 255;
    cv.distanceTransform(m, d, cv.DIST_L2, 3);
    const dd: Float32Array = d.data32F;
    let max = 0;
    for (const i of px) if (dd[i] > max) max = dd[i];
    if (max < 3) return [px];
    for (const i of px) if (dd[i] >= 0.7 * max) seeds.data[i] = 255;
    const n: number = cv.connectedComponents(seeds, sl, 8, cv.CV_32S);
    if (n <= 2) return [px];
    const sLab: Int32Array = sl.data32S;
    const cores: { u: number; v: number; peak: number; c: number }[] = [];
    for (let k = 1; k < n; k++) cores.push({ u: 0, v: 0, peak: 0, c: 0 });
    for (const i of px) {
      const k = sLab[i];
      if (k <= 0) continue;
      const core = cores[k - 1];
      core.u += i % W;
      core.v += (i / W) | 0;
      core.c++;
      if (dd[i] > core.peak) core.peak = dd[i];
    }
    const real = cores.filter((c) => c.c >= 2).map((c) => ({ u: c.u / c.c, v: c.v / c.c, peak: c.peak }));
    if (real.length < 2) return [px];
    // keep a pair apart only if the blob narrows between them (a neck), as it does where two objects touch
    const necked = (a: (typeof real)[0], b: (typeof real)[0]) => {
      let minD = Infinity;
      for (let t = 0.2; t <= 0.8; t += 0.05) {
        const u = Math.round(a.u + (b.u - a.u) * t);
        const v = Math.round(a.v + (b.v - a.v) * t);
        minD = Math.min(minD, dd[v * W + u] ?? 0);
      }
      return minD < 0.55 * Math.min(a.peak, b.peak);
    };
    const groups = real.map((c) => [c]);
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        if (!groups[a].some((x) => groups[b].some((y) => !necked(x, y)))) continue;
        groups[a].push(...groups[b]);
        groups.splice(b, 1);
        b = a;
      }
    }
    if (groups.length < 2) return [px];
    const parts: number[][] = groups.map(() => []);
    for (const i of px) {
      const u = i % W;
      const v = (i / W) | 0;
      let best = 0;
      let bestD = Infinity;
      groups.forEach((g, gi) => {
        for (const c of g) {
          // distance to the core's edge, so a big object keeps its own pixels against a small neighbour
          const dist = Math.hypot(u - c.u, v - c.v) - c.peak;
          if (dist < bestD) {
            bestD = dist;
            best = gi;
          }
        }
      });
      parts[best].push(i);
    }
    return parts.every((p) => p.length >= MIN_AREA_PX) ? parts : [px];
  } finally {
    m.delete();
    d.delete();
    seeds.delete();
    sl.delete();
  }
}

export async function describeRegions(frame: CameraFrame, cfg: VisionConfig): Promise<Region[]> {
  const { cv } = await loadOpenCv();
  const W = frame.width;
  const H = frame.height;
  const { fx, fy, cx, cy } = frame.intrinsics;
  const M = new THREE.Matrix4().compose(
    new THREE.Vector3(...frame.position),
    new THREE.Quaternion(...frame.quaternion),
    new THREE.Vector3(1, 1, 1)
  );
  const e = M.elements;

  // ---- depth -> world, height above the table, candidate mask ----
  const wx = new Float32Array(W * H);
  const wz = new Float32Array(W * H);
  const hgt = new Float32Array(W * H);
  const cand = new Uint8Array(W * H);
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const i = v * W + u;
      const z = frame.depth[i];
      if (z <= 0) continue;
      const xc = ((u - cx) / fx) * z;
      const yc = (-(v - cy) / fy) * z;
      const zc = -z;
      const X = e[0] * xc + e[4] * yc + e[8] * zc + e[12];
      const Y = e[1] * xc + e[5] * yc + e[9] * zc + e[13];
      const Z = e[2] * xc + e[6] * yc + e[10] * zc + e[14];
      wx[i] = X;
      wz[i] = Z;
      const h = Y - cfg.tableY;
      hgt[i] = h;
      const nearBase = Math.hypot(X - cfg.base.x, Z - cfg.base.z) < BASE_KEEP_OUT && h < 0.22;
      if (h >= GATE_MIN && h <= GATE_MAX && z >= MIN_RANGE && Math.abs(X) < 0.66 && Math.abs(Z) < 0.46 && !nearBase && !onFixture(X, Z, h)) cand[i] = 255;
    }
  }

  // ---- OpenCV: open, label, describe ----
  const mats: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(m: T): T => {
    mats.push(m);
    return m;
  };
  try {
    const mask = keep(cv.matFromArray(H, W, cv.CV_8UC1, cand));
    const kernel = keep(cv.Mat.ones(3, 3, cv.CV_8U));
    const opened = keep(new cv.Mat());
    cv.morphologyEx(mask, opened, cv.MORPH_OPEN, kernel);

    const labels = keep(new cv.Mat());
    const stats = keep(new cv.Mat());
    const cents = keep(new cv.Mat());
    const count: number = cv.connectedComponentsWithStats(opened, labels, stats, cents, 8, cv.CV_32S);

    const rgba = keep(cv.matFromArray(H, W, cv.CV_8UC4, frame.rgba));
    const rgb = keep(new cv.Mat());
    const hsv = keep(new cv.Mat());
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    const hsvData: Uint8Array = hsv.data;
    // texture: Laplacian of the grey image (felt, rind and skin are rough; rubber and paint are smooth)
    const gray = keep(new cv.Mat());
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    const lapMat = keep(new cv.Mat());
    cv.Laplacian(gray, lapMat, cv.CV_32F, 1, 1, 0, cv.BORDER_DEFAULT);
    const lap: Float32Array = lapMat.data32F;
    const lab: Int32Array = labels.data32S;

    // gather pixels per component
    const byLabel: number[][] = Array.from({ length: count }, () => []);
    for (let i = 0; i < lab.length; i++) if (lab[i] > 0) byLabel[lab[i]].push(i);

    // touching objects come out of connected components as one blob: split them
    const parts: number[][] = [];
    for (let li = 1; li < count; li++) {
      if (stats.intAt(li, 4) < MIN_AREA_PX) continue;
      parts.push(...splitTouching(cv, byLabel[li], W, H));
    }
    const partLab = new Int32Array(lab.length);
    parts.forEach((p, k) => {
      for (const i of p) partLab[i] = k + 1;
    });

    const regions: Region[] = [];
    for (let li = 1; li <= parts.length; li++) {
      const px = parts[li - 1];
      if (px.length < MIN_AREA_PX) continue;
      let left = W, top = H, right = 0, bottom = 0;
      for (const i of px) {
        const u = i % W;
        const v = (i / W) | 0;
        if (u < left) left = u;
        if (u > right) right = u;
        if (v < top) top = v;
        if (v > bottom) bottom = v;
      }
      const bw = right - left + 1;
      const bh = bottom - top + 1;
      const truncated = left <= 0 || top <= 0 || left + bw >= W || top + bh >= H;

      // contour-based shape descriptors (OpenCV)
      const regionMask = cv.Mat.zeros(H, W, cv.CV_8UC1);
      for (const i of px) regionMask.data[i] = 255;
      const contours = new cv.MatVector();
      const hier = new cv.Mat();
      cv.findContours(regionMask, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let best = -1;
      let bestArea = 0;
      for (let c = 0; c < contours.size(); c++) {
        const a = cv.contourArea(contours.get(c));
        if (a > bestArea) {
          bestArea = a;
          best = c;
        }
      }
      let fill = 1, circ = 1, solid = 1, hu1 = 0, hu2 = 0, aspect = 1;
      if (best >= 0) {
        const cnt = contours.get(best);
        const per = cv.arcLength(cnt, true);
        const hull = new cv.Mat();
        cv.convexHull(cnt, hull, false, true);
        const hullArea = cv.contourArea(hull);
        const rect = cv.minAreaRect(cnt);
        const rw = Math.max(rect.size.width, 1e-3);
        const rh = Math.max(rect.size.height, 1e-3);
        const mo = cv.moments(cnt, false);
        fill = bestArea / (rw * rh);
        circ = per > 0 ? (4 * Math.PI * bestArea) / (per * per) : 1;
        solid = hullArea > 0 ? bestArea / hullArea : 1;
        aspect = Math.max(rw, rh) / Math.min(rw, rh);
        hu1 = mo.nu20 + mo.nu02;
        hu2 = (mo.nu20 - mo.nu02) ** 2 + 4 * mo.nu11 ** 2;
        hull.delete();
        cnt.delete();
      }
      regionMask.delete();
      contours.delete();
      hier.delete();

      // metric size from the back-projected points: principal axes of the footprint on the table
      let mx = 0, mz = 0, hmax = 0, hsum = 0, dsum = 0;
      for (const i of px) {
        mx += wx[i];
        mz += wz[i];
        hsum += hgt[i];
        dsum += frame.depth[i];
        if (hgt[i] > hmax) hmax = hgt[i];
      }
      const n = px.length;
      mx /= n;
      mz /= n;
      let cxx = 0, cxz = 0, czz = 0;
      for (const i of px) {
        const a = wx[i] - mx;
        const b = wz[i] - mz;
        cxx += a * a;
        cxz += a * b;
        czz += b * b;
      }
      const th = 0.5 * Math.atan2(2 * cxz, cxx - czz);
      const ct = Math.cos(th);
      const st = Math.sin(th);
      let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
      for (const i of px) {
        const a = wx[i] - mx;
        const b = wz[i] - mz;
        const p = a * ct + b * st;
        const q = -a * st + b * ct;
        if (p < p0) p0 = p;
        if (p > p1) p1 = p;
        if (q < q0) q0 = q;
        if (q > q1) q1 = q;
      }
      const e1 = p1 - p0;
      const e2 = q1 - q0;
      const major = Math.max(e1, e2);
      const minor = Math.min(e1, e2);

      // top surface: centre estimate + how much of the region is a flat top
      let tx = 0, tz = 0, tn = 0;
      for (const i of px) {
        if (hgt[i] >= hmax - 0.012) {
          tx += wx[i];
          tz += wz[i];
          tn++;
        }
      }
      const flatTop = tn / n;

      // smallest enclosing rectangle of the top surface (what the fingers have to fit around)
      const topPts: number[] = [];
      const stride = Math.max(1, Math.floor(tn / 300));
      let seenTop = 0;
      for (const i of px) {
        if (hgt[i] < hmax - 0.012) continue;
        if (seenTop++ % stride === 0) topPts.push(wx[i], wz[i]);
      }
      const rectAt = (ang: number) => {
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (let k = 0; k < topPts.length; k += 2) {
          const a = topPts[k] * c + topPts[k + 1] * sn;
          const b = -topPts[k] * sn + topPts[k + 1] * c;
          if (a < a0) a0 = a;
          if (a > a1) a1 = a;
          if (b < b0) b0 = b;
          if (b > b1) b1 = b;
        }
        return { along: a1 - a0, across: b1 - b0, ca: (a0 + a1) / 2, cb: (b0 + b1) / 2 };
      };
      let bestAng = 0;
      let bestRect = topPts.length >= 6 ? rectAt(0) : { along: major, across: minor, ca: mx, cb: mz };
      if (topPts.length >= 6) {
        const search = (from: number, to: number, step: number) => {
          for (let ang = from; ang < to; ang += step) {
            const r = rectAt(ang);
            if (r.along * r.across < bestRect.along * bestRect.across) {
              bestRect = r;
              bestAng = ang;
            }
          }
        };
        search(0, Math.PI / 2, Math.PI / 60);
        search(bestAng - Math.PI / 60, bestAng + Math.PI / 60, Math.PI / 360);
      }
      // rectangle centre back in scene coordinates
      const rcx = bestRect.ca * Math.cos(bestAng) - bestRect.cb * Math.sin(bestAng);
      const rcz = bestRect.ca * Math.sin(bestAng) + bestRect.cb * Math.cos(bestAng);
      const topRect =
        bestRect.along >= bestRect.across
          ? { yaw: bestAng, major: bestRect.along, minor: bestRect.across, x: rcx, z: rcz }
          : { yaw: bestAng + Math.PI / 2, major: bestRect.across, minor: bestRect.along, x: rcx, z: rcz };

      // colour + texture from interior pixels only (edges blend with the table)
      const inner: number[] = [];
      for (const i of px) {
        const u = i % W;
        const v = (i / W) | 0;
        if (u < 1 || v < 1 || u >= W - 1 || v >= H - 1) continue;
        if (partLab[i - 1] !== li || partLab[i + 1] !== li || partLab[i - W] !== li || partLab[i + W] !== li) continue;
        inner.push(i);
      }
      const use = inner.length >= 6 ? inner : px;
      let sx = 0, sy = 0, cn = 0, ss = 0, sv = 0, lapSq = 0;
      const vals: number[] = [];
      for (const i of use) {
        const hh = hsvData[i * 3] * 2; // OpenCV hue is 0..179
        const sat0 = hsvData[i * 3 + 1] / 255;
        const vv = hsvData[i * 3 + 2] / 255;
        ss += sat0;
        sv += vv;
        vals.push(vv);
        lapSq += lap[i] * lap[i];
        if (sat0 < 0.12 || vv < 0.15) continue; // ignore specular highlights and deep shadow for hue
        sx += Math.cos((hh * Math.PI) / 180) * sat0;
        sy += Math.sin((hh * Math.PI) / 180) * sat0;
        cn++;
      }
      const ic = use.length;
      const hue = cn > 0 ? ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360 : 0;
      const sat = ss / ic;
      const val = sv / ic;
      const colour = colourName(hue, cn > 0 ? sat : 0, val);
      vals.sort((p, q) => p - q);
      const vMed = vals[Math.floor(vals.length / 2)];
      const vStd = Math.sqrt(vals.reduce((acc, x) => acc + (x - val) * (x - val), 0) / vals.length);
      const specular = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))] - vMed;
      const textureLog = Math.log10(lapSq / ic + 1e-4);

      const features = [major, minor, hmax, hsum / n, fill, circ, solid, Math.log10(hu1 + 1e-9), Math.log10(hu2 + 1e-9), aspect, flatTop,
        truncated ? 1 : 0,
        textureLog, vStd, specular, sat, val, cn > 0 ? sx / cn : 0, cn > 0 ? sy / cn : 0];
      const topCx = tn ? tx / tn : mx;
      const topCz = tn ? tz / tn : mz;
      const rec: Recognition = {
        kind: 'unknown',
        confidence: 0,
        scores: {},
        colour,
        hsv: [hue, sat, val],
        label: `${colour} object`,
        position: { x: topCx, y: cfg.tableY + hmax / 2, z: topCz },
        maskPixels: n,
        bbox: [left, top, left + bw - 1, top + bh - 1],
        depthM: dsum / n,
        extent: { major, minor, height: hmax },
        truncated,
        top: topRect
      };
      regions.push({ features, pixels: Int32Array.from(px), rec });
    }
    return regions;
  } finally {
    for (const m of mats) m.delete();
  }
}

const KIND_WORD: Record<string, string> = { tennis_ball: 'tennis ball', cube: 'cube', book: 'notebook', can: 'can' };

/** Run the full recogniser on a frame: fills `frame.detections` and paints the segmentation overlay. */
export async function annotate(frame: CameraFrame, cfg: VisionConfig): Promise<Region[]> {
  const [regions, clf] = await Promise.all([describeRegions(frame, cfg), getClassifier()]);
  const out: Recognition[] = [];
  for (const r of regions) {
    const c = clf ? clf.classify(r.features) : null;
    const kind = c?.kind ?? 'unknown';
    // paint overlay (background-class clutter is dimmed)
    const [pr, pg, pb] = kindColour(kind === 'unknown' ? 'background' : kind);
    for (const i of r.pixels) {
      frame.segRgba[i * 4] = pr;
      frame.segRgba[i * 4 + 1] = pg;
      frame.segRgba[i * 4 + 2] = pb;
    }
    if (kind === 'background') continue;
    r.rec.kind = kind as ObjectKind | 'unknown';
    r.rec.confidence = c?.confidence ?? 0;
    r.rec.scores = c?.scores ?? {};
    const word = kind === 'unknown' ? 'object' : KIND_WORD[kind] ?? kind;
    r.rec.label = `${r.rec.colour} ${word}`;
    out.push(r.rec);
  }
  frame.detections = out.sort((a, b) => b.maskPixels - a.maskPixels);
  return regions;
}

// ---------------------------------------------------------------------------------------------
// Association: which named object is this detection?
// ---------------------------------------------------------------------------------------------

export interface RegistryEntry {
  id: string;
  name: string;
  shape: string;
  color: string;
  /** Optional prior only; the object database does not know where things are. */
  position?: { x: number; z: number };
}

/** Kinds whose visible colour is not the object's nominal colour (transparent, metal, mixed from above). */
const COLOUR_UNRELIABLE = new Set<string>(['glass', 'can', 'scissors', 'stapler', 'mug', 'tennis_ball']);

function colourScore(rec: Recognition, regHex: string, kind: ObjectKind): number {
  if (COLOUR_UNRELIABLE.has(kind)) return 0.5;
  const [rh, rs, rv] = rec.hsv;
  const [h, s, v] = hexToHsv(regHex);
  const achRec = rs < 0.2 || rv < 0.18;
  const achReg = s < 0.18 || v < 0.15;
  if (achRec && achReg) return 1 - Math.min(1, Math.abs(rv - v));
  if (achRec !== achReg) return 0;
  const d = Math.abs(rh - h);
  const dh = Math.min(d, 360 - d);
  return Math.max(0, 1 - dh / 45);
}

export interface Association {
  rec: Recognition;
  id: string | null;
  score: number;
}

/**
 * Greedy one-to-one matching of detections to named objects by kind, colour and (as a tie-breaker between
 * look-alikes) distance to where that object was last seen.
 */
export function associate(recs: Recognition[], registry: RegistryEntry[], lastSeen: Record<string, { x: number; z: number }>): Association[] {
  const pairs: { ri: number; oi: number; score: number }[] = [];
  recs.forEach((rec, ri) => {
    const rk = rec.kind;
    if (rk === 'unknown') return;
    registry.forEach((o, oi) => {
      const kind = objectKind(o);
      const exact = kind === rk;
      if (!exact && KIND_GROUP[kind] !== KIND_GROUP[rk]) return;
      const col = colourScore(rec, o.color, kind);
      if (col < 0.2) return;
      const ref = lastSeen[o.id] ?? o.position;
      if (!exact) {
        // a looser kind match is only trusted from a complete view, and not as a big jump from where the object was last seen
        if (rec.truncated) return;
        if (ref && Math.hypot(rec.position.x - ref.x, rec.position.z - ref.z) > 0.15) return;
      }
      const proximity = ref ? Math.exp(-Math.hypot(rec.position.x - ref.x, rec.position.z - ref.z) / 0.08) : 0.15;
      const score = (exact ? 1 : 0.55) + 0.8 * col + 0.2 * rec.confidence + 0.3 * proximity;
      pairs.push({ ri, oi, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);
  const usedR = new Set<number>();
  const usedO = new Set<number>();
  const out: Association[] = recs.map((rec) => ({ rec, id: null, score: 0 }));
  for (const p of pairs) {
    if (usedR.has(p.ri) || usedO.has(p.oi)) continue;
    usedR.add(p.ri);
    usedO.add(p.oi);
    out[p.ri] = { rec: recs[p.ri], id: registry[p.oi].id, score: p.score };
  }
  return out;
}
