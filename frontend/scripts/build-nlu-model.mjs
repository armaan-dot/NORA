// Builds public/nora_nlu_model.json from the Python NLU sources so the web app
// runs the *same* trained model the ROS node uses (single source of truth).
//
//   ml/models/nora_nlu_model.json   -> priors, per-action feature weights, known objects/locations
//   ml/src/nora_nlu/model.py        -> commonsense map + explicit-language patterns
//
// Runs automatically before `npm run dev` and `npm run build`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const model = JSON.parse(readFileSync(resolve(root, 'ml/models/nora_nlu_model.json'), 'utf8'));
const py = readFileSync(resolve(root, 'ml/src/nora_nlu/model.py'), 'utf8');

function block(startMarker, endPattern) {
  const start = py.indexOf(startMarker);
  if (start < 0) throw new Error(`marker not found: ${startMarker}`);
  const rest = py.slice(start + startMarker.length);
  const end = rest.search(endPattern);
  if (end < 0) throw new Error(`end not found for: ${startMarker}`);
  return rest.slice(0, end);
}

// Commonsense keyword -> {action, target_object, target_location}
const commonsense = [];
for (const line of block('_COMMONSENSE_MAP: dict[str, dict[str, Any]] = {', /^}/m).split('\n')) {
  const m = line.match(/^\s*"([^"]+)":\s*\{(.*)\},?\s*(?:#.*)?$/);
  if (!m) continue;
  const fields = Object.fromEntries([...m[2].matchAll(/"(\w+)":\s*"([^"]*)"/g)].map((f) => [f[1], f[2]]));
  commonsense.push([m[1], fields.action, fields.target_object ?? null, fields.target_location ?? null]);
}

// Explicit-language patterns (Python raw strings, regex syntax is JS-compatible)
const explicit = [...block('_EXPLICIT_WORDS_PATTERNS = [', /^\]/m).matchAll(/^\s*r"([^"]+)",/gm)].map((m) => m[1]);

if (commonsense.length < 20 || explicit.length < 20) {
  throw new Error(`suspiciously small parse: commonsense=${commonsense.length} explicit=${explicit.length}`);
}

const r4 = (n) => Math.round(n * 1e4) / 1e4;
const weights = {};
for (const [action, w] of Object.entries(model.action_feature_weights)) {
  weights[action] = Object.fromEntries(Object.entries(w).map(([tok, v]) => [tok, r4(v)]));
}

const out = {
  version: 1,
  vocab_size: Object.keys(model.vocabulary).length,
  action_priors: model.action_priors,
  action_feature_weights: weights,
  known_objects: model.known_objects,
  known_locations: model.known_locations,
  commonsense,
  explicit_patterns: explicit
};

const dest = resolve(root, 'frontend/public/nora_nlu_model.json');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out));
console.log(`nlu model -> public/nora_nlu_model.json (${out.vocab_size} tokens, ${commonsense.length} commonsense, ${explicit.length} explicit patterns, ${model.known_objects.length} objects)`);
