// Downloads the YOLOX-Tiny COCO model (Apache-2.0, Megvii) to public/models/ if it is not there yet.
// The model is optional (the Sensors panel's second-opinion detector), so a failed download only warns.
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'yolox_tiny.onnx');

if (existsSync(out) && statSync(out).size > 0) process.exit(0);
mkdirSync(dirname(out), { recursive: true });
const part = `${out}.part`;
try {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(part, Buffer.from(await res.arrayBuffer()));
  renameSync(part, out);
  console.log(`fetch-yolox: saved ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
} catch (e) {
  rmSync(part, { force: true });
  console.warn(`fetch-yolox: could not download the YOLOX model (${e.message}); the YOLOX second opinion will be unavailable.`);
}
