/**
 * Browser port of ml/src/nora_nlu/model.py (NLUModel.predict).
 *
 * Same trained model, same decision order as the ROS NLU node:
 *   0. explicit-language interlock
 *   1. coordinate commands            -> move_to_pose
 *   2. multi-word commonsense phrases, cutting / stapling tool intents
 *   3. single-word commonsense (only when no known object was named)
 *   4. TF-IDF unigram+bigram Naive Bayes action classifier + slot extraction
 *
 * Weights are produced by scripts/build-nlu-model.mjs from ml/models/nora_nlu_model.json.
 * Inference is a few hundred dictionary lookups, so plain JS is plenty fast
 * (see docs: no WebAssembly needed).
 */

export interface NluResult {
  action: string;
  target_object: string | null;
  target_location: string | null;
  parameters: Record<string, unknown>;
  confidence: number;
}

export interface NluModelFile {
  version: number;
  vocab_size: number;
  action_priors: Record<string, number>;
  action_feature_weights: Record<string, Record<string, number>>;
  known_objects: string[];
  known_locations: string[];
  commonsense: [string, string, string | null, string | null][];
  explicit_patterns: string[];
}

// Words that end a fallback object capture ("place the cube ON the shelf" -> cube, not cube_on).
// Keep in sync with _OBJECT_STOP_WORDS in ml/src/nora_nlu/model.py.
const OBJECT_STOP_WORDS = new Set([
  'on', 'in', 'into', 'onto', 'to', 'at', 'from', 'near', 'by', 'with', 'under', 'over', 'and', 'then', 'for'
]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (phrase: string) => new RegExp(`\\b${escapeRe(phrase)}\\b`);

export class NluModel {
  readonly vocabSize: number;
  readonly objectCount: number;

  private readonly priors: Record<string, number>;
  private readonly weights: Record<string, Record<string, number>>;
  private readonly explicitRe: RegExp;
  private readonly multiWord: { re: RegExp; len: number; action: string; obj: string | null; loc: string | null }[] = [];
  private readonly singleWord: { re: RegExp; len: number; action: string; obj: string | null; loc: string | null }[] = [];
  private readonly objects: { name: string; re: RegExp }[];
  private readonly locations: { name: string; re: RegExp }[];

  constructor(data: NluModelFile) {
    this.vocabSize = data.vocab_size;
    this.objectCount = data.known_objects.length;
    this.priors = data.action_priors;
    this.weights = data.action_feature_weights;
    this.explicitRe = new RegExp(`\\b(?:${data.explicit_patterns.join('|')})\\b`, 'i');

    for (const [kw, action, obj, loc] of data.commonsense) {
      (kw.includes(' ') ? this.multiWord : this.singleWord).push({ re: wordRe(kw), len: kw.length, action, obj, loc });
    }
    // Longest phrase wins for multi-word matches (mirrors the Python sort).
    this.multiWord.sort((a, b) => b.len - a.len);

    const byLengthDesc = (names: string[]) =>
      [...names]
        .sort((a, b) => b.length - a.length)
        .map((name) => ({ name, re: wordRe(name.replace(/_/g, ' ')) }));
    this.objects = byLengthDesc(data.known_objects);
    this.locations = byLengthDesc(data.known_locations);
  }

  static async load(url: string): Promise<NluModel> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`NLU model fetch failed: ${res.status}`);
    return new NluModel((await res.json()) as NluModelFile);
  }

  private static tokenize(text: string): string[] {
    const tokens = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const features = [...tokens];
    for (let i = 0; i < tokens.length - 1; i++) features.push(`${tokens[i]}_${tokens[i + 1]}`);
    return features;
  }

  predict(text: string): NluResult {
    const raw = (text ?? '').trim();
    const lower = raw.toLowerCase();
    const make = (
      action: string,
      target_object: string | null,
      target_location: string | null,
      parameters: Record<string, unknown>,
      confidence: number
    ): NluResult => ({ action, target_object, target_location, parameters, confidence });

    if (!raw) return make('unknown', null, null, {}, 0);

    // 0. Safety interlock
    if (this.explicitRe.test(raw)) {
      return make(
        'explicit_blocked',
        null,
        null,
        { error: 'Cannot process explicit words.', reason: 'Cannot process explicit words.', flagged: true },
        0
      );
    }

    // 1. Coordinate move
    const coord = lower.match(
      /(?:x\s*=\s*|coordinates\s+)?([-\d.]+)[,\s]+(?:y\s*=\s*)?([-\d.]+)[,\s]+(?:z\s*=\s*)?([-\d.]+)/
    );
    if (coord && ['move', 'go to', 'navigate', 'position'].some((w) => lower.includes(w))) {
      const [x, y, z] = [coord[1], coord[2], coord[3]].map(Number);
      if (![x, y, z].some(Number.isNaN)) return make('move_to_pose', null, null, { x, y, z }, 0.95);
    }

    // 2. Multi-word commonsense, then tool intents
    for (const m of this.multiWord) {
      if (m.re.test(lower)) return make(m.action, m.obj, m.loc, {}, 0.98);
    }
    if (
      ['cut', 'trim', 'snip', 'shears'].some((w) => lower.includes(w)) &&
      !['pick up paper', 'grab paper', 'lift paper'].some((w) => lower.includes(w))
    ) {
      return make('pick', 'scissors', 'user', { activity_context: 'cutting' }, 0.98);
    }
    if (['staple', 'stapling', 'bind papers', 'fasten papers'].some((w) => lower.includes(w))) {
      return make('pick', 'stapler', 'user', { activity_context: 'stapling' }, 0.98);
    }

    // 3. Explicit known object? (blocks single-word commonsense, as in Python)
    const explicitObj = this.objects.find((o) => o.re.test(lower)) ?? null;
    if (explicitObj === null) {
      for (const m of this.singleWord) {
        if (m.re.test(lower)) return make(m.action, m.obj, m.loc, {}, 0.96);
      }
    }

    // 4. Naive Bayes over unigram + bigram features
    const tokens = NluModel.tokenize(raw);
    const scores: Record<string, number> = {};
    for (const [act, w] of Object.entries(this.weights)) {
      let s = this.priors[act] ?? -10;
      for (const t of tokens) {
        const v = w[t];
        if (v !== undefined) s += v;
      }
      scores[act] = s;
    }
    const max = Math.max(...Object.values(scores));
    const exps = Object.fromEntries(Object.entries(scores).map(([a, s]) => [a, Math.exp(s - max)]));
    const sum = Object.values(exps).reduce((a, b) => a + b, 0);
    let best = 'unknown';
    let bestP = -1;
    for (const [a, e] of Object.entries(exps)) {
      const p = e / sum;
      if (p > bestP) {
        bestP = p;
        best = a;
      }
    }

    // 5. Slots
    let target_object = explicitObj?.name ?? null;
    let target_location = this.locations.find((l) => l.re.test(lower))?.name ?? null;

    if (target_object === null && (best === 'pick' || best === 'place')) {
      const m = lower.match(
        /(?:pick|grab|lift|give|hand|bring|pass|place|put|drop)\s+(?:(?:me|us)\s+)?(?:up\s+)?(?:the\s+|a\s+|an\s+)?([a-z0-9_-]+(?:\s+[a-z0-9_-]+)?)/
      );
      if (m) {
        const words = m[1].trim().split(/\s+/);
        if (words.length > 1 && OBJECT_STOP_WORDS.has(words[1])) words.length = 1;
        const cand = words.join('_');
        if (!['coordinates', 'pose', 'home', 'gripper', 'hand'].includes(cand)) target_object = cand;
      }
    }
    if (target_location === null && (best === 'pick' || best === 'place')) {
      const m = lower.match(/(?:in|into|on|onto|from|at)\s+(?:the\s+|a\s+|an\s+)?([a-z0-9_-]+)/);
      if (m) {
        const cand = m[1].trim().replace(/ /g, '_');
        if (!(['table', 'shelf', 'bin', 'tray'].indexOf(cand) < 0 && cand === target_object)) target_location = cand;
      }
    }
    if (best === 'pick' && ['give me', 'hand me', 'pass me', 'bring me'].some((w) => lower.includes(w))) {
      target_location = 'user';
    }

    return make(best, target_object, target_location, {}, Math.round(bestP * 100) / 100);
  }
}
