// Export the web simulator's tabletop objects as Gazebo Classic models (OBJ + MTL mesh, SDF with the web physics
// collision shapes and masses) into ros2_ws/src/nora_gazebo/models.   npm run export:gazebo
// Web frame is y-up, Gazebo is z-up: ROS (x, y, z) = web (x, -z, y). Each mesh keeps the web body origin, so the
// model origin is the body centre and rests at table height + restHalf.
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createObjectMesh } from '../src/sim/objectMeshes';
import { physicsFor, type ColliderSpec } from '../src/sim/objectPhysics';

// objectMeshes draws procedural textures on a canvas; in Node there is none, so drawing is a no-op and the
// models use flat material colours.
const ctx2d = new Proxy({}, {
  get: (_t, k) =>
    k === 'createImageData' ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
      : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} })
        : () => {},
  set: () => true
});
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const OUT = resolve(process.cwd(), '../ros2_ws/src/nora_gazebo/models');

const OBJECTS = [
  { model: 'mug', name: 'Coffee Mug', shape: 'mug', color: '#8B4513' },
  { model: 'glass', name: 'Water Glass', shape: 'glass', color: '#06b6d4' },
  { model: 'tennis_ball', name: 'Tennis Ball', shape: 'sphere', color: '#84cc16' },
  { model: 'apple', name: 'Red Apple', shape: 'apple', color: '#e11d48' },
  { model: 'can', name: 'Soda Can', shape: 'cylinder', color: '#c0392b' },
  { model: 'notebook', name: 'Notebook', shape: 'box', color: '#3b82f6' }
];

const WEB_TO_ROS = new THREE.Matrix4().makeRotationX(Math.PI / 2);
const ros = (v: [number, number, number]): [number, number, number] => [v[0], -v[2], v[1]];
const f = (n: number, d = 5) => (Math.abs(n) < 0.5 * 10 ** -d ? 0 : n).toFixed(d);
const fv = (v: number[], d = 5) => v.map((n) => f(n, d)).join(' ');

type Prim = { geo: 'box'; size: [number, number, number] } | { geo: 'cylinder'; r: number; len: number } | { geo: 'sphere'; r: number };
interface Part { prim: Prim; mass: number; pos: [number, number, number] }

/** Web collider -> Gazebo primitive in ROS axes. Convex hulls become their nearest primitive. */
function toPart(model: string, c: ColliderSpec): Part {
  if (c.rot && c.rot.some((a) => a !== 0)) throw new Error(`${model}: rotated colliders are not handled`);
  const pos = ros(c.pos ?? [0, 0, 0]);
  const s = c.shape;
  if (s.t === 'box') return { prim: { geo: 'box', size: [2 * s.h[0], 2 * s.h[2], 2 * s.h[1]] }, mass: c.mass, pos };
  if (s.t === 'cyl') return { prim: { geo: 'cylinder', r: s.r, len: 2 * s.hh }, mass: c.mass, pos };
  if (s.t === 'ball') return { prim: { geo: 'sphere', r: s.r }, mass: c.mass, pos };
  const b = new THREE.Box3().setFromArray(s.pts);
  const c3 = b.getCenter(new THREE.Vector3());
  const size = b.getSize(new THREE.Vector3());
  const p0 = c.pos ?? [0, 0, 0];
  const centre = ros([p0[0] + c3.x, p0[1] + c3.y, p0[2] + c3.z]);
  // mug handle: its bounding box
  if (model === 'mug') return { prim: { geo: 'box', size: [size.x, size.z, size.y] }, mass: c.mass, pos: centre };
  // revolved hull around the web Y axis (apple, glass wall): upright cylinder through the widest ring
  return { prim: { geo: 'cylinder', r: Math.max(size.x, size.z) / 2, len: size.y }, mass: c.mass, pos: centre };
}

function collisionParts(model: string, obj: { name: string; shape: string }): Part[] {
  const phys = physicsFor(obj);
  if (model === 'glass') {
    // web: short base cylinder + tapered wall hull (57 mm base, 70 mm rim); here one cylinder of the mean diameter
    const mass = phys.colliders.reduce((a, c) => a + c.mass, 0);
    return [{ prim: { geo: 'cylinder', r: (0.0283 + 0.035) / 2, len: 2 * phys.restHalf }, mass, pos: [0, 0, 0] }];
  }
  return phys.colliders.map((c) => toPart(model, c));
}

function inertia(parts: Part[]) {
  const m = parts.reduce((a, p) => a + p.mass, 0);
  const com = [0, 1, 2].map((i) => parts.reduce((a, p) => a + p.mass * p.pos[i], 0) / m);
  const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of parts) {
    let d: number[];
    if (p.prim.geo === 'box') {
      const [a, b, c] = p.prim.size;
      d = [(b * b + c * c), (a * a + c * c), (a * a + b * b)].map((v) => (p.mass * v) / 12);
    } else if (p.prim.geo === 'cylinder') {
      const { r, len } = p.prim;
      const side = (p.mass * (3 * r * r + len * len)) / 12;
      d = [side, side, (p.mass * r * r) / 2];
    } else {
      d = [0, 1, 2].map(() => 0.4 * p.mass * (p.prim as { r: number }).r ** 2);
    }
    const r = p.pos.map((v, i) => v - com[i]);
    const rr = r[0] ** 2 + r[1] ** 2 + r[2] ** 2;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i][j] += (i === j ? d[i] + p.mass * rr : 0) - p.mass * r[i] * r[j];
  }
  return { m, com, I };
}

function geometryXml(p: Prim): string {
  if (p.geo === 'box') return `<box><size>${fv(p.size)}</size></box>`;
  if (p.geo === 'cylinder') return `<cylinder><radius>${f(p.r)}</radius><length>${f(p.len)}</length></cylinder>`;
  return `<sphere><radius>${f(p.r)}</radius></sphere>`;
}

function exportMesh(model: string, root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const mats = new Map<THREE.Material, string>();
  const obj: string[] = [`mtllib ${model}.mtl`];
  const mtl: string[] = [];
  const box = new THREE.Box3();
  let base = 1, verts = 0, tris = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(WEB_TO_ROS, mesh.matrixWorld));
    const mat = mesh.material as THREE.MeshStandardMaterial & { transmission?: number };
    if (!mats.has(mat)) {
      const name = `${model}_${mats.size}`;
      mats.set(mat, name);
      const c = mat.color.clone();
      const rgb = { r: 0, g: 0, b: 0 };
      c.getRGB(rgb, THREE.SRGBColorSpace);
      const clear = (mat.transmission ?? 0) > 0;
      const kd = clear ? [0.85, 0.92, 0.95] : [rgb.r, rgb.g, rgb.b];
      const ks = mat.metalness > 0.5 ? 0.6 : 0.15;
      mtl.push(`newmtl ${name}`, `Ka ${fv(kd, 4)}`, `Kd ${fv(kd, 4)}`, `Ks ${fv([ks, ks, ks], 2)}`, 'Ns 30', `d ${clear ? '0.35' : '1'}`, 'illum 2', '');
    }
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    obj.push(`o ${mats.get(mat)}_${verts}`, `usemtl ${mats.get(mat)}`);
    for (let i = 0; i < pos.count; i++) {
      obj.push(`v ${f(pos.getX(i))} ${f(pos.getY(i))} ${f(pos.getZ(i))}`);
      box.expandByPoint(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
    for (let i = 0; i < pos.count; i++) obj.push(`vn ${f(nor.getX(i), 4)} ${f(nor.getY(i), 4)} ${f(nor.getZ(i), 4)}`);
    const idx = geo.index ? Array.from(geo.index.array) : Array.from({ length: pos.count }, (_, i) => i);
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const [a, b, c] = [idx[i] + base, idx[i + 1] + base, idx[i + 2] + base];
      obj.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
    }
    base += pos.count;
    verts += pos.count;
    tris += idx.length / 3;
  });
  return { obj: obj.join('\n') + '\n', mtl: mtl.join('\n'), box, verts, tris };
}

for (const o of OBJECTS) {
  const spec = { id: o.model, name: o.name, shape: o.shape, color: o.color, position: { x: 0, y: 0, z: 0 } };
  const dir = join(OUT, o.model);
  mkdirSync(join(dir, 'meshes'), { recursive: true });
  const mesh = exportMesh(o.model, createObjectMesh(spec));
  writeFileSync(join(dir, 'meshes', `${o.model}.obj`), mesh.obj);
  writeFileSync(join(dir, 'meshes', `${o.model}.mtl`), mesh.mtl);

  const phys = physicsFor(o);
  const parts = collisionParts(o.model, o);
  const { m, com, I } = inertia(parts);
  const surface = '<surface><friction><ode><mu>1.0</mu><mu2>1.0</mu2></ode></friction></surface>';
  const collisions = parts.map((p, i) => [
    `      <collision name="collision${i ? `_${i}` : ''}">`,
    `        <pose>${fv(p.pos)} 0 0 0</pose>`,
    `        <geometry>${geometryXml(p.prim)}</geometry>`,
    `        ${surface}`,
    '      </collision>'
  ].join('\n'));
  const sdf = `<?xml version="1.0"?>
<!-- Generated by frontend/scripts/export-gazebo-models.ts from the web simulator's ${o.name}.
     Origin = body centre; rest it at table height + ${f(phys.restHalf, 4)} m. -->
<sdf version="1.6">
  <model name="${o.model}">
    <link name="link">
      <inertial>
        <pose>${fv(com)} 0 0 0</pose>
        <mass>${f(m, 4)}</mass>
        <inertia>
          <ixx>${I[0][0].toExponential(4)}</ixx><ixy>${I[0][1].toExponential(4)}</ixy><ixz>${I[0][2].toExponential(4)}</ixz>
          <iyy>${I[1][1].toExponential(4)}</iyy><iyz>${I[1][2].toExponential(4)}</iyz><izz>${I[2][2].toExponential(4)}</izz>
        </inertia>
      </inertial>
${collisions.join('\n')}
      <visual name="visual">
        <geometry><mesh><uri>model://${o.model}/meshes/${o.model}.obj</uri></mesh></geometry>
      </visual>
    </link>
  </model>
</sdf>
`;
  writeFileSync(join(dir, 'model.sdf'), sdf);
  writeFileSync(join(dir, 'model.config'), `<?xml version="1.0"?>
<model>
  <name>${o.model}</name>
  <version>1.0</version>
  <sdf version="1.6">model.sdf</sdf>
  <description>${o.name} from the NORA web simulator (frontend/src/sim/objectMeshes.ts, objectPhysics.ts).</description>
</model>
`);
  const s = mesh.box.getSize(new THREE.Vector3());
  console.log(
    `${o.model.padEnd(12)} verts ${String(mesh.verts).padStart(5)} tris ${String(mesh.tris).padStart(5)}  size ${fv([s.x, s.y, s.z], 3)} m` +
    `  z ${f(mesh.box.min.z, 4)}..${f(mesh.box.max.z, 4)}  restHalf ${f(phys.restHalf, 4)}  mass ${f(m, 3)} kg  ` +
    parts.map((p) => `${p.prim.geo}(${p.prim.geo === 'box' ? fv(p.prim.size, 3) : p.prim.geo === 'cylinder' ? `r ${f(p.prim.r, 4)} l ${f(p.prim.len, 4)}` : `r ${f(p.prim.r, 4)}`})`).join(' + ')
  );
}
