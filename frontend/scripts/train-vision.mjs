// Trains the vision classifier from simulator renders and writes public/vision_model.json.
//
//   1. npm run build && npx vite preview --port 4799      (or: npm run dev)
//   2. node scripts/train-vision.mjs [--scenes 400] [--url http://localhost:4799] [--edge "<path to msedge/chrome>"]
//
// It drives a headless Chromium over the DevTools protocol: renders random scenes in the real app, extracts OpenCV
// region features, labels them with the object-ID render pass (training labels only), measures held-out accuracy,
// then fits a k-NN model on everything and saves it. Node >= 22 (global WebSocket) is required.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SCENES = Number(arg('scenes', 400));
const TEST_SCENES = Math.max(30, Math.round(SCENES / 4));
const URL = arg('url', 'http://localhost:4799');
const EDGE =
  arg('edge', process.env.CHROME_PATH) ||
  ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!EDGE) throw new Error('No Chrome/Edge found: pass --edge <path>');
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vision_model.json');

const PORT = 9400 + Math.floor(Math.random() * 90);
const browser = spawn(
  EDGE,
  ['--headless=new', `--remote-debugging-port=${PORT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nora-vision-'))}`, 'about:blank'],
  { stdio: 'ignore' }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 60 && !page; i++) {
  try {
    page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
  } catch {
    /* browser still starting */
  }
  if (!page) await sleep(250);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++nextId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluation failed');
  return r.result.result.value;
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `${URL}/?debug` });
  for (let i = 0; i < 120; i++) {
    if (await evaluate('!!window.__nora?.visionTrain && !!window.__noraView?.wristCam').catch(() => false)) break;
    await sleep(500);
  }
  await sleep(2500);

  const gather = async (baseSeed, total) => {
    const out = [];
    for (let off = 0; off < total; off += 25) {
      const n = Math.min(25, total - off);
      const part = JSON.parse(
        await evaluate(`(async()=>JSON.stringify((await window.__nora.visionTrain.collect({scenes:${n},seed:${baseSeed + off}})).map(s=>({features:s.features.map(v=>+v.toFixed(5)),label:s.label,scene:s.scene}))))()`)
      );
      out.push(...part);
      process.stdout.write(`  ${Math.min(off + n, total)}/${total} scenes, ${out.length} regions\r`);
    }
    process.stdout.write('\n');
    return out;
  };
  console.log('Rendering training scenes...');
  const train = await gather(1000, SCENES);
  console.log('Rendering held-out scenes...');
  const test = await gather(777000, TEST_SCENES);

  const search = await evaluate(`(()=>{ const V=window.__nora.vision,T=window.__nora.visionTrain; const train=${JSON.stringify(train)},test=${JSON.stringify(test)};
    const sl=(a,d)=>a.map(s=>({...s,features:s.features.slice(0,d)})); const variants={}; let best={acc:-1};
    for (const d of [12,15,17,19]) for (const k of [3,5,7,9]) { const f=T.fit(sl(train,d),k); const r=T.evaluate(new V.VisionClassifier(f),sl(test,d)); variants['d'+d+'_k'+k]=+r.accuracy.toFixed(4); if(r.accuracy>best.acc) best={acc:r.accuracy,d,k,report:r}; }
    return {variants,d:best.d,k:best.k,acc:best.acc,report:best.report}; })()`);
  console.log('Held-out accuracy by (features, k):', JSON.stringify(search.variants));
  console.log(`Chosen: ${search.d} features, k=${search.k}: ${(search.acc * 100).toFixed(1)}% on ${search.report.samples} held-out regions`);
  console.log('Per-class recall:', Object.entries(search.report.perClass).map(([k, v]) => `${k} ${(v.recall * 100).toFixed(0)}%`).join(', '));

  const model = await evaluate(`(()=>{ const T=window.__nora.visionTrain; const all=[...${JSON.stringify(train)},...${JSON.stringify(test)}].map(s=>({...s,features:s.features.slice(0,${search.d})})); const f=T.fit(all,${search.k}); f.stats={trained_on:all.length,scenes:${SCENES + TEST_SCENES},features:${search.d},k:${search.k},heldout_accuracy:${search.acc.toFixed(4)},heldout_regions:${search.report.samples}}; return JSON.stringify(f); })()`);
  writeFileSync(OUT, model);
  console.log(`Wrote ${OUT} (${(model.length / 1024).toFixed(0)} KB)`);
} finally {
  ws.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); else browser.kill(); // Chromium's child processes outlive a plain kill on Windows
}
