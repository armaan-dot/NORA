/**
 * Tabletop object models. Each kind is modelled at real-world size (metres) with procedural
 * textures (grain, skin, felt, printed labels) so it reads as a physical thing under the scene lighting.
 * Every mesh is modelled around the body origin used by its collision shapes (objectPhysics.ts): the renderer
 * only ever copies the rigid body's pose onto it.
 * `objectKind` is also what the vision stack learns to recognise.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type ObjectKind =
  | 'cube'
  | 'book'
  | 'ruler'
  | 'eraser'
  | 'can'
  | 'sphere'
  | 'orange'
  | 'apple'
  | 'tennis_ball'
  | 'mug'
  | 'glass'
  | 'pen'
  | 'scissors'
  | 'stapler';

/** Notebook cover size (m): a pocket notebook, narrow enough to fit across the 85 mm jaw. */
export const BOOK = { W: 0.12, D: 0.07, H: 0.018 };

export const ALL_KINDS: ObjectKind[] = [
  'cube', 'book', 'ruler', 'eraser', 'can', 'sphere', 'orange', 'apple', 'tennis_ball', 'mug', 'glass', 'pen', 'scissors', 'stapler'
];

/** Kinds that look alike from above (round, ~7 cm); used when matching detections to named objects. */
export const KIND_GROUP: Record<ObjectKind, string> = {
  cube: 'block', eraser: 'block', book: 'flat', ruler: 'flat', can: 'cylinder', glass: 'cylinder', mug: 'mug',
  sphere: 'round', orange: 'round', apple: 'round', tennis_ball: 'round', pen: 'stick', scissors: 'scissors', stapler: 'stapler'
};

export function objectKind(o: { name: string; shape: string }): ObjectKind {
  const n = o.name.toLowerCase();
  if (n.includes('scissor') || n.includes('shears')) return 'scissors';
  if (n.includes('stapler')) return 'stapler';
  if (n.includes('pen') || n.includes('pencil') || n.includes('marker') || n.includes('highlighter')) return 'pen';
  if (o.shape === 'mug' || n.includes('mug') || n.includes('coffee') || n.includes('tea cup')) return 'mug';
  if (n.includes('tennis')) return 'tennis_ball';
  if (n.includes('orange')) return 'orange';
  if (o.shape === 'apple' || n.includes('apple') || n.includes('fruit')) return 'apple';
  if (n.includes('notebook') || n.includes('journal') || n.includes('book')) return 'book';
  if (n.includes('ruler')) return 'ruler';
  if (n.includes('eraser')) return 'eraser';
  if (o.shape === 'box') return 'cube';
  if (o.shape === 'cylinder') return 'can';
  if (o.shape === 'sphere') return 'sphere';
  return 'glass';
}

// ---------------------------------------------------------------------------------------------
// Procedural textures (cached)
// ---------------------------------------------------------------------------------------------

const cache = new Map<string, THREE.Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Deterministic pseudo-random so textures are identical between sessions. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fine grey noise, used as a bump map for felt, rind, rubber. */
const noiseBump = (key: string, size = 128, contrast = 90, base = 128) =>
  canvasTexture(
    key,
    size,
    size,
    (ctx) => {
      const r = rng(key.length * 7919);
      const img = ctx.createImageData(size, size);
      for (let i = 0; i < size * size; i++) {
        const v = base + (r() - 0.5) * contrast;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    },
    false
  );

/** Light wood-grain, near-white so the material colour tints it. */
const woodGrain = () =>
  canvasTexture('wood', 256, 256, (ctx) => {
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, 256, 256);
    const r = rng(11);
    for (let i = 0; i < 90; i++) {
      const y = r() * 256;
      ctx.strokeStyle = `rgba(0,0,0,${0.03 + r() * 0.07})`;
      ctx.lineWidth = 0.5 + r() * 1.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(80, y + (r() - 0.5) * 8, 170, y + (r() - 0.5) * 8, 256, y + (r() - 0.5) * 6);
      ctx.stroke();
    }
  });

/** Apple / fruit skin: vertical streaks and speckles, near-white. */
const fruitSkin = (streaky: boolean) =>
  canvasTexture(streaky ? 'skin-apple' : 'skin-orange', 256, 256, (ctx) => {
    ctx.fillStyle = '#ededed';
    ctx.fillRect(0, 0, 256, 256);
    const r = rng(streaky ? 31 : 47);
    if (streaky) {
      for (let i = 0; i < 70; i++) {
        const x = r() * 256;
        ctx.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.09})`;
        ctx.lineWidth = 1 + r() * 4;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (r() - 0.5) * 30, 256);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 380; i++) {
      ctx.fillStyle = `rgba(${streaky ? '255,245,200' : '0,0,0'},${0.08 + r() * 0.16})`;
      ctx.beginPath();
      ctx.arc(r() * 256, r() * 256, 0.7 + r() * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  });

/** Printed drinks-can label: coloured body, bands and abstract type. Colour is tinted via material colour. */
const canLabel = () =>
  canvasTexture('can-label', 512, 256, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(0, 150, 512, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.0)';
    ctx.fillStyle = '#e9e9e9';
    ctx.fillRect(0, 168, 512, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    for (let i = 0; i < 6; i++) ctx.fillRect(40 + i * 78, 78, 46, 12); // stylised lettering
    ctx.fillRect(40, 100, 150, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.beginPath();
    ctx.arc(420, 70, 38, 0, Math.PI * 2);
    ctx.fill();
  });

/** Ruler ticks (cm and mm) printed on a pale body. */
const rulerTicks = () =>
  canvasTexture('ruler', 512, 64, (ctx) => {
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#262626';
    for (let i = 0; i <= 160; i++) {
      const x = 8 + (i / 160) * 496;
      const len = i % 10 === 0 ? 26 : i % 5 === 0 ? 18 : 10;
      ctx.fillRect(x, 0, 1.5, len);
    }
    ctx.font = '10px sans-serif';
    for (let i = 0; i <= 16; i += 2) ctx.fillText(String(i), 8 + (i / 16) * 496 + 2, 40);
  });

/** Page edges: fine horizontal lines. */
const pageEdges = () =>
  canvasTexture('pages', 64, 128, (ctx) => {
    ctx.fillStyle = '#f3ecda';
    ctx.fillRect(0, 0, 64, 128);
    ctx.strokeStyle = 'rgba(120,100,60,0.35)';
    for (let y = 0; y < 128; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(64, y);
      ctx.stroke();
    }
  });

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

export interface ObjectSpec {
  id: string;
  name: string;
  shape: string;
  color: string;
  position: { x: number; y: number; z: number };
}

const parseColor = (hex: string) => {
  const v = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(v) ? 0x3b82f6 : v;
};

/** Revolve a (radius, height) profile around Y. */
const lathe = (pts: [number, number][], segments = 64) =>
  new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segments);

export function createObjectMesh(obj: ObjectSpec): THREE.Object3D {
  const kind = objectKind(obj);
  const color = parseColor(obj.color);
  const group = new THREE.Group();

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const metal = (hex: number, rough = 0.28) => new THREE.MeshStandardMaterial({ color: hex, metalness: 1, roughness: rough });

  switch (kind) {
    case 'cube': {
      // Painted wooden block with chamfered edges
      add(
        new RoundedBoxGeometry(0.06, 0.06, 0.06, 5, 0.0045),
        new THREE.MeshPhysicalMaterial({ color, map: woodGrain(), roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4 })
      );
      break;
    }
    case 'book': {
      // Hardcover notebook: cover boards, page block, spine, elastic band
      const { W, D, H } = BOOK;
      const cover = new THREE.MeshStandardMaterial({ color, roughness: 0.62, bumpMap: noiseBump('cloth', 128, 60), bumpScale: 0.4 });
      add(new RoundedBoxGeometry(W, 0.004, D, 2, 0.0015), cover).position.y = -H / 2 + 0.002;
      add(new RoundedBoxGeometry(W, 0.004, D, 2, 0.0015), cover).position.y = H / 2 - 0.002;
      const spine = add(new RoundedBoxGeometry(0.006, H, D, 2, 0.002), cover);
      spine.position.x = -W / 2 + 0.003;
      const pages = add(new THREE.BoxGeometry(W - 0.012, H - 0.008, D - 0.006), new THREE.MeshStandardMaterial({ color: 0xf3ecda, map: pageEdges(), roughness: 0.9 }));
      pages.position.x = 0.004;
      add(new THREE.BoxGeometry(0.008, H + 0.002, D + 0.001), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 })).position.x = W / 2 - 0.024;
      break;
    }
    case 'ruler': {
      const L = 0.16, Wd = 0.026, Th = 0.011;
      const body = new THREE.MeshPhysicalMaterial({ color, map: rulerTicks(), roughness: 0.25, clearcoat: 0.6 });
      add(new RoundedBoxGeometry(L, Th, Wd, 2, 0.002), body);
      break;
    }
    case 'eraser': {
      const body = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.7, bumpMap: noiseBump('rubber', 64, 40), bumpScale: 0.3 });
      add(new RoundedBoxGeometry(0.052, 0.02, 0.022, 3, 0.004), body);
      const sleeve = add(new RoundedBoxGeometry(0.03, 0.0215, 0.0235, 3, 0.004), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
      sleeve.position.x = 0.004;
      break;
    }
    case 'can': {
      // Drinks can: printed aluminium body, bare rims, pull tab
      const h = 0.09;
      const b = -h / 2;
      add(
        lathe([[0, b + 0.003], [0.025, b], [0.033, b + 0.004], [0.035, b + 0.01], [0.035, h / 2 - 0.01], [0.031, h / 2 - 0.002], [0.029, h / 2], [0.0268, h / 2 - 0.002], [0.0268, h / 2 - 0.004], [0, h / 2 - 0.004]]),
        metal(0xc8cbcf, 0.25)
      );
      add(
        new THREE.CylinderGeometry(0.0353, 0.0353, h - 0.026, 64, 1, true),
        new THREE.MeshPhysicalMaterial({ color, map: canLabel(), metalness: 0.7, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12 })
      );
      const tab = add(new THREE.CylinderGeometry(0.009, 0.009, 0.0015, 24), metal(0xd8dade, 0.3));
      tab.scale.set(1.5, 1, 0.8);
      tab.position.set(0.004, h / 2 - 0.0035, 0);
      break;
    }
    case 'sphere': {
      add(
        new THREE.SphereGeometry(0.035, 64, 40),
        new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2, bumpMap: noiseBump('rubber', 64, 40), bumpScale: 0.2 })
      );
      break;
    }
    case 'orange': {
      add(new THREE.SphereGeometry(0.036, 64, 40), new THREE.MeshStandardMaterial({ color, map: fruitSkin(false), roughness: 0.62, bumpMap: noiseBump('rind', 128, 140), bumpScale: 1.4 }));
      const nub = add(new THREE.CylinderGeometry(0.004, 0.005, 0.003, 12), new THREE.MeshStandardMaterial({ color: 0x4a7a2c, roughness: 0.8 }));
      nub.position.y = 0.0355;
      break;
    }
    case 'apple': {
      const r = 0.036;
      const pts: [number, number][] = [];
      for (let i = 0; i <= 28; i++) {
        const t = (i / 28) * Math.PI; // 0 = bottom, PI = top
        let rad = Math.sin(t) * r * (1 + 0.07 * Math.sin(t));
        const y = -Math.cos(t) * r * 0.92;
        if (i === 0 || i === 28) rad = 0;
        pts.push([rad, y]);
      }
      pts[1][1] += 0.004;
      pts[27][1] -= 0.007;
      pts[28][1] -= 0.009;
      add(lathe(pts, 64), new THREE.MeshPhysicalMaterial({ color, map: fruitSkin(true), roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3, bumpMap: noiseBump('apple-bump', 128, 50), bumpScale: 0.3 }));
      const stem = add(new THREE.CylinderGeometry(0.0016, 0.0022, 0.016, 8), new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.9 }));
      stem.position.set(0.001, r * 0.92 - 0.002, 0);
      stem.rotation.z = -0.25;
      const leaf = add(new THREE.SphereGeometry(0.009, 16, 8), new THREE.MeshStandardMaterial({ color: 0x3f7d2c, roughness: 0.6, side: THREE.DoubleSide }));
      leaf.scale.set(1.3, 0.12, 0.6);
      leaf.position.set(0.009, r * 0.92 + 0.002, 0.002);
      leaf.rotation.z = 0.35;
      break;
    }
    case 'tennis_ball': {
      const R = 0.0335;
      add(new THREE.SphereGeometry(R, 64, 40), new THREE.MeshStandardMaterial({ color: 0xcfe23a, roughness: 1, bumpMap: noiseBump('felt', 128, 200), bumpScale: 1.6 }));
      const seam: THREE.Vector3[] = [];
      for (let i = 0; i <= 160; i++) {
        const t = (i / 160) * Math.PI * 2;
        const a = 0.44;
        const p = new THREE.Vector3(Math.cos(t) + a * Math.cos(3 * t), Math.sin(t) - a * Math.sin(3 * t), 2 * Math.sqrt(a * (1 - a)) * Math.sin(2 * t));
        seam.push(p.normalize().multiplyScalar(R * 1.004));
      }
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam, true), 200, 0.0013, 6, true), new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.85 }));
      break;
    }
    case 'mug': {
      const h = 0.085;
      const b = -h / 2;
      const glaze = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.08, bumpMap: noiseBump('glaze', 128, 14), bumpScale: 0.1 });
      add(lathe([[0, b], [0.030, b], [0.0335, b + 0.004], [0.0365, b + 0.02], [0.038, h / 2 - 0.002], [0.0372, h / 2], [0.0342, h / 2], [0.0335, b + 0.02], [0.031, b + 0.008], [0, b + 0.008]]), glaze);
      const coffee = add(new THREE.CircleGeometry(0.0337, 48), new THREE.MeshPhysicalMaterial({ color: 0x2a160c, roughness: 0.08, clearcoat: 1 }));
      coffee.castShadow = false;
      coffee.rotation.x = -Math.PI / 2;
      coffee.position.y = h / 2 - 0.012;
      const handle = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.035, 0.026, 0), new THREE.Vector3(0.056, 0.022, 0), new THREE.Vector3(0.062, 0, 0), new THREE.Vector3(0.056, -0.022, 0), new THREE.Vector3(0.034, -0.026, 0)
      ]);
      add(new THREE.TubeGeometry(handle, 40, 0.0058, 14, false), glaze);
      break;
    }
    case 'pen': {
      const nm = obj.name.toLowerCase();
      const pen = new THREE.Group();
      const sub = (geo: THREE.BufferGeometry, mat: THREE.Material) => add(geo, mat, pen);
      if (nm.includes('pencil')) {
        // Hexagonal pencil: painted barrel, sharpened wood, graphite, ferrule and eraser
        sub(new THREE.CylinderGeometry(0.0036, 0.0036, 0.1, 6), new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, clearcoat: 0.5 })).position.y = 0.0;
        const cone = sub(new THREE.ConeGeometry(0.0036, 0.016, 6), new THREE.MeshStandardMaterial({ color: 0xe6c79a, roughness: 0.8 }));
        cone.position.y = -0.058;
        cone.rotation.x = Math.PI;
        const lead = sub(new THREE.ConeGeometry(0.0012, 0.005, 12), new THREE.MeshStandardMaterial({ color: 0x2b2b2f, roughness: 0.5 }));
        lead.position.y = -0.0685;
        lead.rotation.x = Math.PI;
        sub(new THREE.CylinderGeometry(0.0037, 0.0037, 0.006, 16), metal(0xc2c4c8)).position.y = 0.053;
        sub(new THREE.CylinderGeometry(0.0033, 0.0033, 0.006, 16), new THREE.MeshStandardMaterial({ color: 0xe58aa0, roughness: 0.8 })).position.y = 0.059;
      } else {
        // Pen: glossy barrel, cap with clip, chrome ring and tip
        sub(new THREE.CylinderGeometry(0.0046, 0.0046, 0.09, 32), new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 0.8 }));
        sub(new THREE.CylinderGeometry(0.0053, 0.0053, 0.032, 32), new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, clearcoat: 0.8 })).position.y = 0.04;
        sub(new THREE.BoxGeometry(0.0015, 0.026, 0.0032), metal(0xd6d8db, 0.18)).position.set(0.0062, 0.04, 0);
        sub(new THREE.CylinderGeometry(0.0055, 0.0055, 0.002, 32), metal(0xd6d8db, 0.15)).position.y = 0.024;
        const grip = sub(new THREE.ConeGeometry(0.0046, 0.013, 32), new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.6 }));
        grip.position.y = -0.0515;
        grip.rotation.x = Math.PI;
        const tip = sub(new THREE.ConeGeometry(0.0012, 0.005, 16), metal(0xd6d8db, 0.15));
        tip.position.y = -0.0605;
        tip.rotation.x = Math.PI;
      }
      pen.rotation.z = Math.PI / 2; // lying along the body X axis
      group.add(pen);
      break;
    }
    case 'scissors': {
      const steel = metal(0xc9ccd0, 0.22);
      const plastic = new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, clearcoat: 0.3 });
      const blade = new THREE.Shape();
      blade.moveTo(-0.004, -0.008);
      blade.lineTo(0.085, -0.0015);
      blade.lineTo(0.085, 0.0015);
      blade.lineTo(-0.004, 0.008);
      blade.lineTo(-0.004, -0.008);
      const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.005, bevelEnabled: false });
      bladeGeo.rotateX(-Math.PI / 2);
      [0.18, -0.18].forEach((ang, i) => {
        const bl = add(bladeGeo, steel);
        bl.rotation.y = ang;
        bl.position.y = -0.003 + i * 0.003;
        const loop = add(new THREE.TorusGeometry(0.012, 0.0042, 12, 32), plastic);
        loop.rotation.x = Math.PI / 2;
        loop.position.set(-0.014, -0.002, ang > 0 ? 0.013 : -0.013);
      });
      add(new THREE.CylinderGeometry(0.0032, 0.0032, 0.007, 16), steel).position.y = -0.001;
      break;
    }
    case 'stapler': {
      const dark = metal(0x3a3c40, 0.35);
      const shell = new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, clearcoat: 0.4 });
      add(new RoundedBoxGeometry(0.032, 0.008, 0.11, 2, 0.003), dark).position.y = -0.008;
      const top = add(new RoundedBoxGeometry(0.028, 0.018, 0.1, 3, 0.006), shell);
      top.position.set(0, 0.006, -0.004);
      top.rotation.x = 0.05;
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 12), metal(0xb8bbc0)).rotation.z = Math.PI / 2;
      break;
    }
    case 'glass':
    default: {
      // Drinking glass: thick base, tapered wall, water inside
      const h = 0.11;
      const b = -h / 2;
      add(
        lathe([[0, b], [0.028, b], [0.0285, b + 0.002], [0.035, h / 2], [0.0325, h / 2], [0.0262, b + 0.01], [0, b + 0.01]]),
        new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, thickness: 0.006, ior: 1.5, roughness: 0.02, metalness: 0, transparent: true, opacity: 1, envMapIntensity: 1.4 })
      );
      const fillTop = b + 0.075;
      const rAt = (y: number) => 0.0262 + ((y - (b + 0.01)) / (h / 2 - (b + 0.01))) * (0.0325 - 0.0262) - 0.0006;
      // The glass wall uses transmission, which only refracts OPAQUE objects. A transmissive/transparent liquid would
      // therefore be invisible from the side (you would see an empty glass), so the water is an opaque tinted liquid.
      const tint = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3);
      const water = add(
        lathe([[0, b + 0.0102], [rAt(b + 0.0102), b + 0.0102], [rAt(fillTop), fillTop], [0, fillTop]]),
        new THREE.MeshPhysicalMaterial({ color: tint, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, metalness: 0, emissive: tint, emissiveIntensity: 0.12 })
      );
      water.castShadow = false;
      // thin bright meniscus where the water meets the glass
      const rim = add(new THREE.TorusGeometry(rAt(fillTop), 0.0009, 8, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.25 }));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = fillTop;
      rim.castShadow = false;
      break;
    }
  }

  group.name = obj.id;
  group.position.set(obj.position.x, obj.position.y, obj.position.z);
  return group;
}

// ---------------------------------------------------------------------------------------------
// Contact shadow: a soft dark blob under each object (ambient occlusion where it touches the table)
// ---------------------------------------------------------------------------------------------

let blobTexture: THREE.Texture | null = null;

export function createContactShadow(radius: number): THREE.Mesh {
  blobTexture ??= canvasTexture('blob', 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  const mat = new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false, toneMapped: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.2, radius * 2.2), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

/** Rough footprint radius used to size the contact shadow. */
export function footprintRadius(kind: ObjectKind): number {
  switch (kind) {
    case 'book': return 0.062;
    case 'ruler': return 0.08;
    case 'scissors': case 'stapler': return 0.055;
    case 'pen': return 0.055;
    case 'eraser': return 0.03;
    case 'cube': return 0.04;
    default: return 0.038;
  }
}
