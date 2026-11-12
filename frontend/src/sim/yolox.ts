/**
 * YOLOX-Tiny (COCO, Apache-2.0, Megvii) as a second opinion next to the recogniser in sim/vision.ts.
 *
 * It only watches the wrist-camera frames and reports how often it agrees with the recogniser; the
 * grasp pipeline never reads it. onnxruntime-web and the model are loaded the first time it is enabled.
 */
import type { InferenceSession } from 'onnxruntime-web';
import type { ObjectKind } from './objectMeshes';
import type { Recognition } from './vision';
import { cameraFeed, type CameraFrame } from './wristCamera';
import { topicBus } from './topicBus';

export const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle',
  'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed',
  'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven',
  'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
];

/** COCO class -> simulator label and the recogniser kinds it is compatible with. Cube and pen have no COCO class. */
const KIND_MAP: Record<string, { label: string; kinds: ObjectKind[] }> = {
  cup: { label: 'mug', kinds: ['mug', 'glass'] },
  'wine glass': { label: 'glass', kinds: ['glass'] },
  'sports ball': { label: 'tennis ball', kinds: ['tennis_ball', 'sphere', 'orange'] },
  orange: { label: 'tennis ball', kinds: ['orange', 'tennis_ball', 'sphere'] },
  apple: { label: 'apple', kinds: ['apple'] },
  bottle: { label: 'can', kinds: ['can'] },
  book: { label: 'notebook', kinds: ['book'] },
  scissors: { label: 'scissors', kinds: ['scissors'] }
};

export const INPUT = 416;
const STRIDES = [8, 16, 32];

export interface YoloxBox {
  cocoClass: string;
  /** Simulator name where a mapping exists, else the COCO name. */
  label: string;
  kinds: ObjectKind[];
  score: number;
  /** x0, y0, x1, y1 in camera pixels. */
  bbox: [number, number, number, number];
}

/** Letterbox (top-left, pad 114, bilinear) into a 1x3x416x416 BGR 0-255 tensor. */
export function preprocess(rgba: Uint8ClampedArray, w: number, h: number): { data: Float32Array; ratio: number } {
  const ratio = Math.min(INPUT / w, INPUT / h);
  const rw = Math.round(w * ratio);
  const rh = Math.round(h * ratio);
  const plane = INPUT * INPUT;
  const data = new Float32Array(3 * plane).fill(114);
  for (let y = 0; y < rh; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / ratio - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < rw; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / ratio - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
      const o = y * INPUT + x;
      for (let ch = 0; ch < 3; ch++) {
        const src = 2 - ch; // BGR
        const top = rgba[a + src] + (rgba[b + src] - rgba[a + src]) * fx;
        const bot = rgba[c + src] + (rgba[d + src] - rgba[c + src]) * fx;
        data[ch * plane + o] = top + (bot - top) * fy;
      }
    }
  }
  return { data, ratio };
}

const iou = (a: number[], b: number[]) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter || 1);
};

/** Decode the raw 1x3549x85 output, then per-class NMS. */
export function decode(out: Float32Array, ratio: number, w: number, h: number, threshold = 0.3, nmsIou = 0.45): YoloxBox[] {
  const cands: { cls: number; score: number; box: number[] }[] = [];
  let row = 0;
  for (const s of STRIDES) {
    const g = INPUT / s;
    for (let gy = 0; gy < g; gy++) {
      for (let gx = 0; gx < g; gx++, row++) {
        const p = row * 85;
        const obj = out[p + 4];
        if (obj < threshold) continue;
        let cls = 0;
        for (let k = 1; k < 80; k++) if (out[p + 5 + k] > out[p + 5 + cls]) cls = k;
        const score = obj * out[p + 5 + cls];
        if (score < threshold) continue;
        const cx = ((out[p] + gx) * s) / ratio;
        const cy = ((out[p + 1] + gy) * s) / ratio;
        const bw = (Math.exp(out[p + 2]) * s) / ratio;
        const bh = (Math.exp(out[p + 3]) * s) / ratio;
        cands.push({
          cls, score,
          box: [Math.max(0, cx - bw / 2), Math.max(0, cy - bh / 2), Math.min(w, cx + bw / 2), Math.min(h, cy + bh / 2)]
        });
      }
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const kept: typeof cands = [];
  for (const c of cands) if (!kept.some((k) => k.cls === c.cls && iou(k.box, c.box) > nmsIou)) kept.push(c);
  return kept.map((c) => {
    const name = COCO_CLASSES[c.cls];
    const m = KIND_MAP[name];
    return { cocoClass: name, label: m?.label ?? name, kinds: m?.kinds ?? [], score: c.score, bbox: c.box as YoloxBox['bbox'] };
  });
}

/** A box agrees with a recognition when the recognition's image centre is inside it and the kinds are compatible. */
export const agrees = (b: YoloxBox, r: Recognition) => {
  const cx = (r.bbox[0] + r.bbox[2]) / 2;
  const cy = (r.bbox[1] + r.bbox[3]) / 2;
  return r.kind !== 'unknown' && b.kinds.includes(r.kind) && cx >= b.bbox[0] && cx <= b.bbox[2] && cy >= b.bbox[1] && cy <= b.bbox[3];
};

// ---------------------------------------------------------------------------------------------
// Runtime (lazy)
// ---------------------------------------------------------------------------------------------

let sessionPromise: Promise<InferenceSession> | null = null;

function loadSession(): Promise<InferenceSession> {
  sessionPromise ??= (async () => {
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1; // no COOP/COEP on the static host, so no SharedArrayBuffer
    const res = await fetch('/models/yolox_tiny.onnx');
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) throw new Error('model file not found (/models/yolox_tiny.onnx)');
    return ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), { executionProviders: ['wasm'] });
  })();
  sessionPromise.catch(() => (sessionPromise = null));
  return sessionPromise;
}

export async function detect(session: InferenceSession, frame: Pick<CameraFrame, 'rgba' | 'width' | 'height'>, threshold = 0.3): Promise<YoloxBox[]> {
  const { Tensor } = await import('onnxruntime-web/wasm');
  const { data, ratio } = preprocess(frame.rgba, frame.width, frame.height);
  const res = await session.run({ images: new Tensor('float32', data, [1, 3, INPUT, INPUT]) });
  return decode(res[session.outputNames[0]].data as Float32Array, ratio, frame.width, frame.height, threshold);
}

export interface YoloxTally {
  frames: number;
  recognised: number;
  matched: number;
  yoloxBoxes: number;
  yoloxOnly: number;
}

export interface YoloxState {
  enabled: boolean;
  status: 'off' | 'loading' | 'ready' | 'error';
  error: string | null;
  threshold: number;
  /** Boxes for the frame with this stamp. */
  boxes: YoloxBox[];
  stamp: number;
  inferMs: number;
  tally: YoloxTally;
}

const MIN_INTERVAL_MS = 500;
const emptyTally = (): YoloxTally => ({ frames: 0, recognised: 0, matched: 0, yoloxBoxes: 0, yoloxOnly: 0 });

class YoloxMonitor {
  state: YoloxState = { enabled: false, status: 'off', error: null, threshold: 0.3, boxes: [], stamp: 0, inferMs: 0, tally: emptyTally() };
  private listeners = new Set<(s: YoloxState) => void>();
  private unsub: (() => void) | null = null;
  private busy = false;
  private lastRun = 0;

  private set(patch: Partial<YoloxState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((cb) => cb(this.state));
  }

  subscribe(cb: (s: YoloxState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setThreshold(t: number) {
    this.set({ threshold: t });
  }

  setEnabled(on: boolean) {
    if (on === this.state.enabled) return;
    if (!on) {
      this.unsub?.();
      this.unsub = null;
      this.set({ enabled: false, status: 'off', boxes: [] });
      return;
    }
    this.set({ enabled: true, status: 'loading', error: null, tally: emptyTally() });
    loadSession().then(
      (session) => {
        if (!this.state.enabled) return;
        this.set({ status: 'ready' });
        this.unsub = cameraFeed.subscribe((f) => this.onFrame(session, f));
      },
      (e: unknown) => this.set({ enabled: false, status: 'error', error: e instanceof Error ? e.message : String(e) })
    );
  }

  private onFrame(session: InferenceSession, f: CameraFrame) {
    const now = performance.now();
    if (this.busy || now - this.lastRun < MIN_INTERVAL_MS) return;
    this.busy = true;
    this.lastRun = now;
    detect(session, f, this.state.threshold)
      .then((boxes) => {
        if (!this.state.enabled) return;
        const matchedRecs = f.detections.filter((r) => boxes.some((b) => agrees(b, r))).length;
        const onlyYolox = boxes.filter((b) => !f.detections.some((r) => agrees(b, r))).length;
        const t = this.state.tally;
        topicBus.publish('/nora/perception/yolox_detections', 'nora_interfaces/msg/Detections', {
          count: boxes.length,
          detections: boxes.map((b) => ({
            label: b.label, coco_class: b.cocoClass, confidence: Number(b.score.toFixed(2)),
            bbox: b.bbox.map((v) => Math.round(v)), agrees_with_recogniser: f.detections.some((r) => agrees(b, r))
          }))
        });
        this.set({
          boxes, stamp: f.stamp, inferMs: performance.now() - now,
          tally: {
            frames: t.frames + 1, recognised: t.recognised + f.detections.length, matched: t.matched + matchedRecs,
            yoloxBoxes: t.yoloxBoxes + boxes.length, yoloxOnly: t.yoloxOnly + onlyYolox
          }
        });
      })
      .catch((e: unknown) => {
        this.unsub?.();
        this.unsub = null;
        this.set({ enabled: false, status: 'error', error: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => {
        this.busy = false;
      });
  }
}

export const yoloxMonitor = new YoloxMonitor();
