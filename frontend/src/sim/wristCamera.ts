/**
 * Simulated eye-in-hand RGB-D camera (RealSense D435 colour stream geometry: 69 x 42 degree FOV).
 *
 * Like Gazebo's camera plugin, this renders the scene from the sensor's pose and returns what a real
 * RGB-D camera would: a colour image and metric depth. Recognition (sim/vision.ts) works from those
 * two images only.
 *
 * A third "instance ID" pass exists, but only when `capture({ truth: true })` is requested. It is used
 * to label training data and to measure recognition accuracy, never by the robot at run time.
 */
import * as THREE from 'three';
import { topicBus } from './topicBus';
import type { Recognition } from './vision';

export interface CameraFrame {
  width: number;
  height: number;
  stamp: number;
  /** sRGB RGBA, top row first. */
  rgba: Uint8ClampedArray;
  /** Metric depth along the optical axis in metres, 0 = no return. Top row first. */
  depth: Float32Array;
  /** Depth colourised for display, RGBA. */
  depthRgba: Uint8ClampedArray;
  /** Segmentation overlay painted by the vision stage, RGBA. */
  segRgba: Uint8ClampedArray;
  depthMin: number;
  depthMax: number;
  /** Filled in by the vision stage. */
  detections: Recognition[];
  intrinsics: { fx: number; fy: number; cx: number; cy: number };
  /** Camera pose in the scene frame (three.js camera: looks down -Z). */
  position: [number, number, number];
  quaternion: [number, number, number, number];
  /** Ground-truth instance mask. Only present for `capture({ truth: true })`. */
  truth?: { mask: Uint8Array; ids: string[] };
}

type FrameListener = (f: CameraFrame) => void;

class CameraFeed {
  latest: CameraFrame | null = null;
  private listeners = new Set<FrameListener>();
  publish(f: CameraFrame) {
    this.latest = f;
    topicBus.publish('/camera/color/image_raw', 'sensor_msgs/msg/Image', {
      frame_id: 'camera_color_optical_frame', width: f.width, height: f.height, encoding: 'rgb8', step: f.width * 3, data_bytes: f.width * f.height * 3
    });
    topicBus.publish('/camera/aligned_depth_to_color/image_raw', 'sensor_msgs/msg/Image', {
      frame_id: 'camera_color_optical_frame', width: f.width, height: f.height, encoding: '32FC1', depth_min_m: Number(f.depthMin.toFixed(3)), depth_max_m: Number(f.depthMax.toFixed(3))
    });
    topicBus.publish('/camera/color/camera_info', 'sensor_msgs/msg/CameraInfo', {
      width: f.width, height: f.height, fx: Number(f.intrinsics.fx.toFixed(2)), fy: Number(f.intrinsics.fy.toFixed(2)), cx: f.intrinsics.cx, cy: f.intrinsics.cy, distortion_model: 'plumb_bob'
    });
    topicBus.publish('/nora/perception/detections', 'nora_interfaces/msg/Detections', {
      count: f.detections.length,
      detections: f.detections.map((d) => ({
        label: d.label, kind: d.kind, confidence: Number(d.confidence.toFixed(2)), mask_px: d.maskPixels, depth_m: Number(d.depthM.toFixed(3)),
        x: Number(d.position.x.toFixed(3)), y: Number(d.position.y.toFixed(3)), z: Number(d.position.z.toFixed(3)), truncated: d.truncated
      }))
    });
    this.listeners.forEach((cb) => cb(f));
  }
  subscribe(cb: FrameListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  get hasSubscribers() {
    return this.listeners.size > 0;
  }
}
export const cameraFeed = new CameraFeed();

export const CAM_W = 256;
export const CAM_H = 144;
const VFOV = 42;
const NEAR = 0.03;
const FAR = 3;

const srgb = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
};

/** Compact blue->green->yellow->red ramp for the depth view. */
function ramp(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const stops: [number, number, number][] = [[30, 40, 120], [30, 150, 190], [60, 190, 110], [235, 210, 70], [220, 70, 50]];
  const p = x * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p));
  const f = p - i;
  return [0, 1, 2].map((k) => stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f) as [number, number, number];
}

export class WristCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly buf = new Uint8Array(CAM_W * CAM_H * 4);
  private readonly depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  private readonly blackMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false });
  readonly fx: number;
  readonly fy: number;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    mount: THREE.Object3D,
    private readonly getObjects: () => Record<string, THREE.Object3D>
  ) {
    this.camera = new THREE.PerspectiveCamera(VFOV, CAM_W / CAM_H, NEAR, FAR);
    // The sensor looks along +Z of the gripper frame; a three.js camera looks along -Z, so flip it.
    this.camera.rotation.y = Math.PI;
    this.camera.position.set(0, -0.036, 0.056); // optical centre, matches the bracket on the gripper
    mount.add(this.camera);
    this.target = new THREE.WebGLRenderTarget(CAM_W, CAM_H, { depthBuffer: true, samples: 0 });
    this.fy = CAM_H / 2 / Math.tan(THREE.MathUtils.degToRad(VFOV / 2));
    this.fx = this.fy; // square pixels
  }

  /** Render colour + depth (and, only if `truth`, the instance-ID pass used for training labels). */
  capture(opts: { truth?: boolean } = {}): CameraFrame {
    const { renderer, scene, camera, target, buf } = this;
    const W = CAM_W;
    const H = CAM_H;
    // Joint updates may have happened since the last render: bring every matrix up to date first.
    scene.updateMatrixWorld(true);

    const prevTarget = renderer.getRenderTarget();
    const prevBg = scene.background;
    const prevFog = scene.fog;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.shadowMap.autoUpdate = false;

    // ---- RGB ----
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x1a1c1f, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, W, H, buf);
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      for (let x = 0; x < W; x++) {
        const s = src + x * 4;
        const d = (y * W + x) * 4;
        rgba[d] = srgb(buf[s] / 255) * 255;
        rgba[d + 1] = srgb(buf[s + 1] / 255) * 255;
        rgba[d + 2] = srgb(buf[s + 2] / 255) * 255;
        rgba[d + 3] = 255;
      }
    }

    // ---- depth (packed RGBA depth, decoded to metres) ----
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = this.depthMat;
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, W, H, buf);
    scene.overrideMaterial = null;
    const depth = new Float32Array(W * H);
    const n = NEAR;
    const f = FAR;
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      for (let x = 0; x < W; x++) {
        const s = src + x * 4;
        // three.js RGBA depth packing: R is the most significant byte, A the least (unpackRGBAToDepth).
        const d01 =
          (buf[s] / 255) * (255 / 256) +
          (buf[s + 1] / 255) * (255 / 256 / 256) +
          (buf[s + 2] / 255) * (255 / 256 / 65536) +
          (buf[s + 3] / 255) / 16777216;
        const ndc = d01 * 2 - 1;
        const z = (2 * n * f) / (f + n - ndc * (f - n));
        depth[y * W + x] = d01 > 0.9999 ? 0 : z;
      }
    }

    // ---- ground-truth instance IDs (training / evaluation only) ----
    let truth: CameraFrame['truth'];
    if (opts.truth) {
      const objects = this.getObjects();
      const ids = Object.keys(objects);
      const idMats = new Map<string, THREE.MeshBasicMaterial>();
      ids.forEach((id, i) => {
        const m = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
        m.color.setRGB((i + 1) / 255, 0, 0, THREE.LinearSRGBColorSpace);
        idMats.set(id, m);
      });
      const owner = new Map<THREE.Object3D, string>();
      for (const id of ids) objects[id].traverse((o) => owner.set(o, id));
      const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) return;
        swapped.push([mesh, mesh.material]);
        const id = owner.get(mesh);
        mesh.material = id ? idMats.get(id)! : this.blackMat;
      });
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, W, H, buf);
      for (const [mesh, mat] of swapped) mesh.material = mat;
      idMats.forEach((m) => m.dispose());
      const mask = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        const src = (H - 1 - y) * W * 4;
        for (let x = 0; x < W; x++) mask[y * W + x] = Math.round(buf[src + x * 4]);
      }
      truth = { mask, ids };
    }

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevClearAlpha);
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    scene.background = prevBg;
    scene.fog = prevFog;

    // ---- depth visualisation (2nd-98th percentile so the nearby gripper does not wash it out) ----
    const valid: number[] = [];
    for (let i = 0; i < depth.length; i += 3) if (depth[i] > 0) valid.push(depth[i]);
    valid.sort((a, b) => a - b);
    const dMin = valid.length ? valid[Math.floor(valid.length * 0.02)] : 0;
    const dMax = valid.length ? valid[Math.min(valid.length - 1, Math.floor(valid.length * 0.98))] : 0;
    const depthRgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const z = depth[i];
      const d = i * 4;
      if (z > 0) {
        const [r, g, b] = ramp((z - dMin) / Math.max(0.05, dMax - dMin));
        depthRgba[d] = r;
        depthRgba[d + 1] = g;
        depthRgba[d + 2] = b;
      } else {
        depthRgba[d] = depthRgba[d + 1] = depthRgba[d + 2] = 18;
      }
      depthRgba[d + 3] = 255;
    }

    const segRgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      segRgba[i * 4] = segRgba[i * 4 + 1] = segRgba[i * 4 + 2] = 22;
      segRgba[i * 4 + 3] = 255;
    }

    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    camera.matrixWorld.decompose(wp, wq, new THREE.Vector3());
    return {
      width: W,
      height: H,
      stamp: performance.now(),
      rgba,
      depth,
      depthRgba,
      segRgba,
      depthMin: dMin,
      depthMax: dMax,
      detections: [],
      intrinsics: { fx: this.fx, fy: this.fy, cx: W / 2, cy: H / 2 },
      position: [wp.x, wp.y, wp.z],
      quaternion: [wq.x, wq.y, wq.z, wq.w],
      truth
    };
  }

  dispose() {
    this.target.dispose();
    this.depthMat.dispose();
    this.blackMat.dispose();
    this.camera.removeFromParent();
  }
}
