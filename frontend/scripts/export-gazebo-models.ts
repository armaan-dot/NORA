// Export the shared object library (src/sim/objectLibrary.ts) to Gazebo Classic.   npm run export:gazebo
//   ros2_ws/src/nora_gazebo/models/<id>/        mesh (OBJ + MTL), SDF with the web physics collision shapes and masses
//   ros2_ws/src/nora_gazebo/worlds/tabletop.world   the GAZEBO_SCENE objects, between the BEGIN/END objects markers
//   ros2_ws/src/nora_bringup/config/gazebo_scene.json   "catalogue" for the arm commander (its "zones" are kept)
// Web frame is y-up, Gazebo is z-up: ROS (x, y, z) = web (x, -z, y). Each mesh keeps the web body origin, so the
// model origin is the body centre and rests at table height + restHalf.
import * as THREE from 'three';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GAZEBO_SCENE, OBJECT_LIBRARY, type LibraryObject } from '../src/sim/objectLibrary';
import { createObjectMesh, objectKind } from '../src/sim/objectMeshes';
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

const ROS2 = resolve(process.cwd(), '../ros2_ws/src');
const MODELS = join(ROS2, 'nora_gazebo/models');
const WORLD = join(ROS2, 'nora_gazebo/worlds/tabletop.world');
const SCENE = join(ROS2, 'nora_bringup/config/gazebo_scene.json');
const TABLE_Z = 0.45; // table top in the Gazebo world (world_to_base in nora_arm.urdf.xacro)

const WEB_TO_ROS = new THREE.Matrix4().makeRotationX(Math.PI / 2);
const ROS_TO_WEB = WEB_TO_ROS.clone().invert();
const ros = (v: [number, number, number]): [number, number, number] => [v[0], -v[2], v[1]];
const f = (n: number, d = 5) => (Math.abs(n) < 0.5 * 10 ** -d ? 0 : n).toFixed(d);
const fv = (v: number[], d = 5) => v.map((n) => f(n, d)).join(' ');
const r4 = (n: number) => Number(n.toFixed(4));

type Prim = { geo: 'box'; size: [number, number, number] } | { geo: 'cylinder'; r: number; len: number } | { geo: 'sphere'; r: number };
/** One collision primitive in the model frame (ROS axes): position, rotation (rpy) and its rotation matrix. */
interface Part { prim: Prim; mass: number; pos: [number, number, number]; rpy: [number, number, number]; rot: THREE.Matrix3 }

/** Web collider rotation (Euler XYZ in web axes) -> the same rotation in ROS axes, as rpy and a matrix. */
function rosRotation(rot?: [number, number, number]) {
  const web = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(rot ?? [0, 0, 0]), 'XYZ'));
  const m = new THREE.Matrix4().multiplyMatrices(WEB_TO_ROS, web).multiply(ROS_TO_WEB);
  // SDF rpy is R = Rz(yaw) Ry(pitch) Rx(roll), which is three.js Euler order 'ZYX'
  const e = new THREE.Euler().setFromRotationMatrix(m, 'ZYX');
  return { rpy: [e.x, e.y, e.z] as [number, number, number], rot: new THREE.Matrix3().setFromMatrix4(m) };
}

/** Web collider -> Gazebo primitive in ROS axes. A convex hull becomes the primitive around it. */
function toPart(id: string, c: ColliderSpec): Part {
  const { rpy, rot } = rosRotation(c.rot);
  const s = c.shape;
  if (s.t === 'box') return { prim: { geo: 'box', size: [2 * s.h[0], 2 * s.h[2], 2 * s.h[1]] }, mass: c.mass, pos: ros(c.pos ?? [0, 0, 0]), rpy, rot };
  if (s.t === 'cyl') return { prim: { geo: 'cylinder', r: s.r, len: 2 * s.hh }, mass: c.mass, pos: ros(c.pos ?? [0, 0, 0]), rpy, rot };
  if (s.t === 'ball') return { prim: { geo: 'sphere', r: s.r }, mass: c.mass, pos: ros(c.pos ?? [0, 0, 0]), rpy, rot };
  if (c.rot?.some((a) => a !== 0)) throw new Error(`${id}: rotated convex hulls are not handled`);
  const b = new THREE.Box3().setFromArray(s.pts);
  const c3 = b.getCenter(new THREE.Vector3());
  const size = b.getSize(new THREE.Vector3());
  const p0 = c.pos ?? [0, 0, 0];
  const pos = ros([p0[0] + c3.x, p0[1] + c3.y, p0[2] + c3.z]);
  // a hull revolved around the web Y axis (apple, glass wall): upright cylinder through its widest ring
  if (Math.abs(size.x - size.z) < 0.05 * Math.max(size.x, size.z)) return { prim: { geo: 'cylinder', r: Math.max(size.x, size.z) / 2, len: size.y }, mass: c.mass, pos, rpy, rot };
  // anything else (mug handle, pencil): its bounding box
  return { prim: { geo: 'box', size: [size.x, size.z, size.y] }, mass: c.mass, pos, rpy, rot };
}

function collisionParts(o: LibraryObject): Part[] {
  const phys = physicsFor(o);
  if (objectKind(o) === 'glass') {
    // web: short base cylinder + tapered wall hull (57 mm base, 70 mm rim); here one cylinder of the mean diameter
    const mass = phys.colliders.reduce((a, c) => a + c.mass, 0);
    return [{ prim: { geo: 'cylinder', r: (0.0283 + 0.035) / 2, len: 2 * phys.restHalf }, mass, pos: [0, 0, 0], ...rosRotation() }];
  }
  return phys.colliders.map((c) => toPart(o.id, c));
}

/** Corner / rim points of a part in the model frame, for its bounding box. */
function partPoints(p: Part): THREE.Vector3[] {
  let local: THREE.Vector3[];
  if (p.prim.geo === 'box') {
    const [a, b, c] = p.prim.size.map((v) => v / 2);
    local = [-1, 1].flatMap((i) => [-1, 1].flatMap((j) => [-1, 1].map((k) => new THREE.Vector3(i * a, j * b, k * c))));
  } else if (p.prim.geo === 'cylinder') {
    const { r, len } = p.prim;
    local = [-1, 1].flatMap((k) => Array.from({ length: 32 }, (_, i) => new THREE.Vector3(r * Math.cos(i * Math.PI / 16), r * Math.sin(i * Math.PI / 16), (k * len) / 2)));
  } else {
    const r = p.prim.r;
    local = [-1, 1].flatMap((s) => [new THREE.Vector3(s * r, 0, 0), new THREE.Vector3(0, s * r, 0), new THREE.Vector3(0, 0, s * r)]);
  }
  return local.map((v) => v.applyMatrix3(p.rot).add(new THREE.Vector3(...p.pos)));
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
    const R = p.rot.elements; // column-major
    const Rij = (i: number, j: number) => R[j * 3 + i];
    const r = p.pos.map((v, i) => v - com[i]);
    const rr = r[0] ** 2 + r[1] ** 2 + r[2] ** 2;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const rotated = Rij(i, 0) * d[0] * Rij(j, 0) + Rij(i, 1) * d[1] * Rij(j, 1) + Rij(i, 2) * d[2] * Rij(j, 2); // R D R^T
        I[i][j] += rotated + (i === j ? p.mass * rr : 0) - p.mass * r[i] * r[j];
      }
    }
  }
  return { m, com, I };
}

function geometryXml(p: Prim): string {
  if (p.geo === 'box') return `<box><size>${fv(p.size)}</size></box>`;
  if (p.geo === 'cylinder') return `<cylinder><radius>${f(p.r)}</radius><length>${f(p.len)}</length></cylinder>`;
  return `<sphere><radius>${f(p.r)}</radius></sphere>`;
}

function exportMesh(id: string, root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const mats = new Map<THREE.Material, string>();
  const obj: string[] = [`mtllib ${id}.mtl`];
  const mtl: string[] = [];
  let base = 1, verts = 0, tris = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(WEB_TO_ROS, mesh.matrixWorld));
    const mat = mesh.material as THREE.MeshStandardMaterial & { transmission?: number };
    if (!mats.has(mat)) {
      const name = `${id}_${mats.size}`;
      mats.set(mat, name);
      const rgb = { r: 0, g: 0, b: 0 };
      mat.color.clone().getRGB(rgb, THREE.SRGBColorSpace);
      const clear = (mat.transmission ?? 0) > 0;
      const kd = clear ? [0.85, 0.92, 0.95] : [rgb.r, rgb.g, rgb.b];
      const ks = mat.metalness > 0.5 ? 0.6 : 0.15;
      mtl.push(`newmtl ${name}`, `Ka ${fv(kd, 4)}`, `Kd ${fv(kd, 4)}`, `Ks ${fv([ks, ks, ks], 2)}`, 'Ns 30', `d ${clear ? '0.35' : '1'}`, 'illum 2', '');
    }
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    obj.push(`o ${mats.get(mat)}_${verts}`, `usemtl ${mats.get(mat)}`);
    for (let i = 0; i < pos.count; i++) obj.push(`v ${f(pos.getX(i))} ${f(pos.getY(i))} ${f(pos.getZ(i))}`);
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
  return { obj: obj.join('\n') + '\n', mtl: mtl.join('\n'), verts, tris };
}

/** What the arm commander needs to know about a class: a simple shape (for grasp width/height and markers). */
function catalogueEntry(o: LibraryObject, parts: Part[], mass: number) {
  const box = new THREE.Box3().setFromPoints(parts.flatMap(partPoints));
  const size = box.getSize(new THREE.Vector3());
  const hex = parseInt(o.color.slice(1), 16);
  const c = { r: (hex >> 16) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 }; // sRGB, as written
  const p = parts[0];
  const shape =
    parts.length === 1 && p.prim.geo === 'sphere' ? { shape: 'sphere', radius: r4(p.prim.r) }
      : parts.length === 1 && p.prim.geo === 'cylinder' && p.rpy.every((a) => Math.abs(a) < 1e-6) ? { shape: 'cylinder', radius: r4(p.prim.r), height: r4(p.prim.len) }
        : { shape: 'box', size: [r4(size.x), r4(size.y), r4(size.z)] };
  return { ...shape, mass: r4(mass), color: [c.r, c.g, c.b].map((v) => Number(v.toFixed(3))), aliases: o.aliases, name: o.name };
}

const catalogue: Record<string, unknown> = {};
const restHalf: Record<string, number> = {};
const ids = new Set<string>();
rmSync(MODELS, { recursive: true, force: true });
for (const o of OBJECT_LIBRARY) {
  if (ids.has(o.id)) throw new Error(`duplicate id ${o.id}`);
  ids.add(o.id);
  const dir = join(MODELS, o.id);
  mkdirSync(join(dir, 'meshes'), { recursive: true });
  const mesh = exportMesh(o.id, createObjectMesh({ id: o.id, name: o.name, shape: o.shape, color: o.color, position: { x: 0, y: 0, z: 0 } }));
  writeFileSync(join(dir, 'meshes', `${o.id}.obj`), mesh.obj);
  writeFileSync(join(dir, 'meshes', `${o.id}.mtl`), mesh.mtl);

  const phys = physicsFor(o);
  restHalf[o.id] = phys.restHalf;
  const parts = collisionParts(o);
  const { m, com, I } = inertia(parts);
  // mu 1.0 for every object, not the web value: Gazebo Classic lets objects slip out of position-controlled fingers
  const surface = '<surface><friction><ode><mu>1.0</mu><mu2>1.0</mu2></ode></friction></surface>';
  const collisions = parts.map((p, i) => [
    `      <collision name="collision${i ? `_${i}` : ''}">`,
    `        <pose>${fv(p.pos)} ${fv(p.rpy, 4)}</pose>`,
    `        <geometry>${geometryXml(p.prim)}</geometry>`,
    `        ${surface}`,
    '      </collision>'
  ].join('\n'));
  writeFileSync(join(dir, 'model.sdf'), `<?xml version="1.0"?>
<!-- Generated by frontend/scripts/export-gazebo-models.ts from objectLibrary.ts ("${o.name}").
     Origin = body centre; rest it at table height + ${f(phys.restHalf, 4)} m. -->
<sdf version="1.6">
  <model name="${o.id}">
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
        <geometry><mesh><uri>model://${o.id}/meshes/${o.id}.obj</uri></mesh></geometry>
      </visual>
    </link>
  </model>
</sdf>
`);
  writeFileSync(join(dir, 'model.config'), `<?xml version="1.0"?>
<model>
  <name>${o.id}</name>
  <version>1.0</version>
  <sdf version="1.6">model.sdf</sdf>
  <description>${o.name} from the NORA object library (frontend/src/sim/objectLibrary.ts).</description>
</model>
`);
  catalogue[o.id] = catalogueEntry(o, parts, m);
  console.log(`${o.id.padEnd(13)} ${String(mesh.tris).padStart(5)} tris  ${f(m, 3)} kg  ` +
    parts.map((p) => `${p.prim.geo}(${p.prim.geo === 'box' ? fv(p.prim.size, 3) : p.prim.geo === 'cylinder' ? `r ${f(p.prim.r, 4)} l ${f(p.prim.len, 4)}` : `r ${f(p.prim.r, 4)}`})`).join(' + '));
}

// World: the scene objects between the markers
const includes = GAZEBO_SCENE.map((s) => {
  if (!ids.has(s.id)) throw new Error(`GAZEBO_SCENE: no object '${s.id}' in the library`);
  return [
    '    <include>',
    `      <uri>model://${s.id}</uri>`,
    `      <name>${s.id}</name>`,
    `      <pose>${fv([s.x, s.y, TABLE_Z + restHalf[s.id]], 4)} 0 0 ${f(s.yaw ?? 0, 4)}</pose>`,
    '    </include>'
  ].join('\n');
});
const world = readFileSync(WORLD, 'utf8');
const nl = world.includes('\r\n') ? '\r\n' : '\n';
const begin = world.indexOf('<!-- BEGIN objects');
const end = world.indexOf('    <!-- END objects -->');
if (begin < 0 || end < 0) throw new Error('tabletop.world: BEGIN/END objects markers not found');
const head = world.slice(0, world.indexOf('\n', begin) + 1);
writeFileSync(WORLD, head + includes.join('\n').replace(/\n/g, nl) + nl + world.slice(end));

// Commander catalogue; keep the hand-written zones
const scene = JSON.parse(readFileSync(SCENE, 'utf8'));
const lines = Object.entries(catalogue).map(([id, e]) => `    ${JSON.stringify(id)}: ${JSON.stringify(e).replace(/,"/g, ', "').replace(/":/g, '": ')}`);
const zones = Object.entries(scene.zones).map(([id, z]) => `    ${JSON.stringify(id)}: ${JSON.stringify(z).replace(/,"/g, ', "').replace(/":/g, '": ')}`);
writeFileSync(SCENE, `{\n  "catalogue": {\n${lines.join(',\n')}\n  },\n  "zones": {\n${zones.join(',\n')}\n  }\n}\n`);
console.log(`\n${OBJECT_LIBRARY.length} models, ${GAZEBO_SCENE.length} objects in tabletop.world, catalogue in gazebo_scene.json`);
