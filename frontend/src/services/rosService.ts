import * as ROSLIB from 'roslib';
import type {
  Intent,
  AffordanceScore,
  PlanStep,
  RosLog,
  JointState,
  OrchestratorFsmState,
  ObjectStateEvent,
  ObjectPosition,
  TabletopObject,
  PerceptionScanEvent,
  ArmSpeechEvent,
  GuardrailEvent
} from '../types';
import { SEED_COMMANDS } from '../data/seedCommands';

type ConnectionCallback = (connected: boolean, url: string) => void;
type JointStateCallback = (jointState: JointState) => void;
type LogCallback = (log: RosLog) => void;
type StateCallback = (state: OrchestratorFsmState) => void;
type ObjectStateCallback = (event: ObjectStateEvent) => void;
type ObjectPositionCallback = (positions: Record<string, ObjectPosition>) => void;
type PerceptionScanCallback = (event: PerceptionScanEvent) => void;
type TabletopObjectsCallback = (objects: TabletopObject[]) => void;
type ArmSpeechCallback = (event: ArmSpeechEvent) => void;
type GuardrailCallback = (event: GuardrailEvent | null) => void;
type PipelineProgressCallback = (data: {
  stage: 'PARSING' | 'SCORING' | 'SEARCHING' | 'PLANNING' | 'EXECUTING' | 'DONE' | 'FAILED';
  intent?: Intent;
  affordances?: AffordanceScore[];
  plan?: PlanStep[];
  activeStepId?: string;
  error?: string;
  guardrailEvent?: GuardrailEvent;
}) => void;

// Explicit dictionary of non-robotic / physically impossible actions for a 6-DOF tabletop arm
export const IMPOSSIBLE_OR_UNSUPPORTED_KEYWORDS: string[] = [
  'dance', 'dancing', 'dancer',
  'sing', 'singing', 'song',
  'fly', 'flying',
  'jump', 'jumping', 'hop',
  'walk', 'walking', 'run', 'running', 'jog',
  'swim', 'swimming',
  'climb', 'climbing',
  'drive', 'driving',
  'cook', 'cooking', 'bake', 'baking', 'fry', 'boil',
  'sleep', 'sleeping',
  'joke', 'tell a joke', 'laugh', 'cry',
  'breathe',
  'backflip', 'cartwheel', 'somersault',
  'spin around', 'do a spin',
  'stand up', 'sit down', 'lie down',
  'hug', 'kiss', 'fight', 'punch', 'kick',
  'talk to me', 'chat with me', 'tell me a story', 'tell me a secret',
  'draw a picture', 'paint a portrait', 'write an essay', 'do my homework'
];

// Safety Interlock: Explicit, vulgar, offensive, and profane language detection patterns
export const EXPLICIT_WORDS_PATTERNS: RegExp[] = [
  /\bfuck(?:ing|ed|er|s)?\b/i,
  /\bfck\b/i,
  /\bf\*ck\b/i,
  /\bshit(?:ty|s)?\b/i,
  /\bbullshit\b/i,
  /\bsh\*t\b/i,
  /\bbitch(?:es|ing)?\b/i,
  /\bb\*tch\b/i,
  /\basshole(?:s)?\b/i,
  /\bdumbass(?:es)?\b/i,
  /\bjackass(?:es)?\b/i,
  /\bbadass\b/i,
  /\bass(?:es)?\b/i,
  /\bbastard(?:s)?\b/i,
  /\bdamn(?:it)?\b/i,
  /\bgoddamn(?:it)?\b/i,
  /\bcrap(?:py)?\b/i,
  /\bcunt(?:s)?\b/i,
  /\bdick(?:s|head)?\b/i,
  /\bcock(?:s|sucker)?\b/i,
  /\bpussy(?:ies)?\b/i,
  /\bwhore(?:s)?\b/i,
  /\bslut(?:s)?\b/i,
  /\bprick(?:s)?\b/i,
  /\bmotherfucker(?:s)?\b/i,
  /\bmotherfucking\b/i,
  /\bnigger(?:s)?\b/i,
  /\bnigga(?:s)?\b/i,
  /\bfaggot(?:s)?\b/i,
  /\bfag(?:s)?\b/i,
  /\bretard(?:ed|s)?\b/i,
  /\bstfu\b/i,
  /\bwtf\b/i,
  /\bpenis(?:es)?\b/i,
  /\bvagina(?:s)?\b/i,
  /\bdildo(?:s)?\b/i,
  /\bporn\b/i,
  /\bnsfw\b/i,
  /\bblowjob(?:s)?\b/i,
  /\bhandjob(?:s)?\b/i,
  /\bboob(?:s)?\b/i,
  /\btit(?:s|ties)?\b/i,
  /\bsex\b/i,
  /\bsexy\b/i,
  /\bhorny\b/i,
  /\bnude\b/i,
  /\bnaked\b/i
];

export function containsExplicitWords(text: string): boolean {
  if (!text) return false;
  return EXPLICIT_WORDS_PATTERNS.some((regex) => regex.test(text));
}

// Physical task & action keywords that cannot be spawned as tabletop objects (non-robotic body actions)
export const PHYSICAL_TASK_KEYWORDS: string[] = [
  ...IMPOSSIBLE_OR_UNSUPPORTED_KEYWORDS,
  'wave', 'waving',
  'nod', 'nodding',
  'shake', 'shaking',
  'stretch', 'stretching',
  'point', 'pointing',
  'bow', 'bowing',
  'salute', 'saluting',
  'clap', 'clapping',
  'exercise', 'exercising',
  'pose', 'posing',
  'hit', 'hitting',
  'scratch', 'scratching',
  'rub', 'rubbing'
];

export const RECOGNIZED_TABLETOP_OBJECTS: string[] = [
  // Common category & desire nouns
  'food', 'snack', 'snacks', 'fruit', 'fruits', 'meal', 'lunch', 'breakfast', 'dinner', 'nutrition',
  'drink', 'drinks', 'beverage', 'beverages', 'refreshment',
  'stationery', 'office supply', 'office supplies', 'writing tool',
  'game', 'games', 'toy', 'toys', 'play item', 'recreation', 'puzzle', 'entertainment',
  'tool', 'tools', 'hardware',

  // Foods & Snacks
  'apple', 'red apple', 'green apple', 'banana', 'orange', 'fresh orange',
  'sandwich', 'burger', 'pizza', 'croissant', 'bagel', 'toast', 'muffin', 'donut',
  'cookie', 'cookies', 'chips', 'potato chips', 'chips bag', 'cracker', 'snack bar',
  'granola bar', 'chocolate', 'chocolate bar', 'candy', 'cereal',

  // Drinks & Drinkware
  'coffee', 'coffee mug', 'mug', 'cup', 'latte', 'espresso', 'cappuccino', 'tea', 'tea cup',
  'water', 'water glass', 'glass', 'drink', 'beverage', 'bottle', 'water bottle',
  'soda', 'soda can', 'can', 'juice', 'milk', 'thermos',

  // Stationery & Office Supplies
  'pen', 'ballpoint pen', 'gel pen', 'writing pen', 'pencil', 'mechanical pencil',
  'marker', 'whiteboard marker', 'permanent marker', 'highlighter',
  'eraser', 'pencil sharpener', 'ruler', 'protractor', 'compass',
  'scissors', 'stapler', 'staples', 'hole punch', 'paper clip', 'binder clip', 'rubber band',
  'tape', 'glue', 'glue stick', 'sticky notes', 'post it', 'notebook', 'notepad', 'sketchbook',
  'textbook', 'book', 'paper', 'folder', 'binder', 'envelope', 'clipboard', 'calculator',

  // Games, Play & Toys
  'tennis', 'tennis ball', 'ball', 'sphere', 'green sphere', 'stress ball', 'dice',
  'game controller', 'controller', 'gamepad', 'joystick', 'fidget spinner', 'fidget',
  'rubiks cube', 'puzzle', 'puzzle box', 'playing cards', 'cards', 'card', 'chess',
  'chess piece', 'dominoes', 'toy car', 'plushie', 'lego',

  // Containers & Geometry
  'cube', 'red cube', 'block', 'brick', 'box', 'package', 'storage box',
  'cylinder', 'blue cylinder', 'canister', 'tube', 'tray', 'bin', 'trash bin',
  'sponge', 'cloth', 'towel'
];

export interface CategorySearchDefinition {
  category: string;
  defaultId: string;
  defaultName: string;
  defaultShape: 'apple' | 'glass' | 'box' | 'cylinder' | 'sphere' | 'mug';
  defaultColor: string;
  defaultEmoji: string;
  candidateIds: string[];
}

export const CATEGORY_SEARCH_MAP: Record<string, CategorySearchDefinition> = {
  food: {
    category: 'food',
    defaultId: 'apple',
    defaultName: 'Red Apple',
    defaultShape: 'apple',
    defaultColor: '#e11d48',
    defaultEmoji: '🍎',
    candidateIds: ['apple', 'banana', 'orange', 'sandwich', 'cookie', 'chips', 'snack', 'food']
  },
  snack: {
    category: 'snack',
    defaultId: 'apple',
    defaultName: 'Red Apple',
    defaultShape: 'apple',
    defaultColor: '#e11d48',
    defaultEmoji: '🍎',
    candidateIds: ['apple', 'banana', 'orange', 'sandwich', 'cookie', 'chips', 'snack', 'food']
  },
  fruit: {
    category: 'fruit',
    defaultId: 'apple',
    defaultName: 'Red Apple',
    defaultShape: 'apple',
    defaultColor: '#e11d48',
    defaultEmoji: '🍎',
    candidateIds: ['apple', 'banana', 'orange', 'fruit']
  },
  meal: {
    category: 'meal',
    defaultId: 'apple',
    defaultName: 'Red Apple',
    defaultShape: 'apple',
    defaultColor: '#e11d48',
    defaultEmoji: '🍎',
    candidateIds: ['apple', 'banana', 'orange', 'sandwich', 'meal']
  },
  drink: {
    category: 'drink',
    defaultId: 'water',
    defaultName: 'Water Glass',
    defaultShape: 'glass',
    defaultColor: '#06b6d4',
    defaultEmoji: '🥛',
    candidateIds: ['water', 'glass', 'cup', 'water_glass', 'coffee_mug', 'bottle', 'soda_can', 'drink']
  },
  beverage: {
    category: 'beverage',
    defaultId: 'water',
    defaultName: 'Water Glass',
    defaultShape: 'glass',
    defaultColor: '#06b6d4',
    defaultEmoji: '🥛',
    candidateIds: ['water', 'glass', 'cup', 'water_glass', 'coffee_mug', 'bottle', 'soda_can', 'beverage']
  },
  stationery: {
    category: 'stationery',
    defaultId: 'pen',
    defaultName: 'Writing Pen',
    defaultShape: 'cylinder',
    defaultColor: '#2563eb',
    defaultEmoji: '🖊️',
    candidateIds: ['pen', 'pencil', 'marker', 'notebook', 'eraser', 'ruler', 'stapler', 'scissors', 'stationery']
  },
  game: {
    category: 'game',
    defaultId: 'game_controller',
    defaultName: 'Game Controller',
    defaultShape: 'box',
    defaultColor: '#8b5cf6',
    defaultEmoji: '🎮',
    candidateIds: ['game_controller', 'rubiks_cube', 'toy_car', 'dice', 'ball', 'tennis_ball', 'game']
  },
  toy: {
    category: 'toy',
    defaultId: 'game_controller',
    defaultName: 'Game Controller',
    defaultShape: 'box',
    defaultColor: '#8b5cf6',
    defaultEmoji: '🎮',
    candidateIds: ['game_controller', 'rubiks_cube', 'toy_car', 'dice', 'ball', 'tennis_ball', 'toy']
  },
  tool: {
    category: 'tool',
    defaultId: 'wrench',
    defaultName: 'Wrench',
    defaultShape: 'cylinder',
    defaultColor: '#475569',
    defaultEmoji: '🔧',
    candidateIds: ['wrench', 'screwdriver', 'pliers', 'hammer', 'tool']
  }
};

export function hasExplicitObjectEntity(text: string | null | undefined): boolean {
  if (!text) return false;
  const l = text.toLowerCase().trim();
  return RECOGNIZED_TABLETOP_OBJECTS.some((obj) => {
    const regex = new RegExp(`\\b${obj}\\b`, 'i');
    return regex.test(l);
  });
}

export function isPhysicalTask(text: string | null | undefined): boolean {
  if (!text) return false;
  const l = text.toLowerCase().trim();

  // Explicit exemption: If the utterance is an object desire (food, drink, play, stationery, tools, tabletop items),
  // it is NEVER an impossible physical task!
  const hasObjectOrDesire = [
    'food', 'hungry', 'starv', 'eat', 'eating', 'snack', 'fruit', 'apple', 'banana', 'orange', 'sandwich', 'cookie', 'chips',
    'drink', 'thirsty', 'water', 'coffee', 'tea', 'soda', 'beverage', 'hydrate',
    'write', 'writing', 'pen', 'pencil', 'note', 'marker', 'scissors', 'stapler', 'stationery', 'paper', 'ruler', 'eraser', 'highlighter',
    'cut', 'cutting', 'snip', 'trim', 'shears', 'slice', 'staple', 'erase', 'measure', 'highlight',
    'play', 'game', 'toy', 'bored', 'tennis', 'dice', 'cards', 'controller', 'gamepad', 'fidget', 'puzzle',
    'tool', 'wrench', 'screwdriver', 'pliers',
    'cube', 'cylinder', 'sphere', 'box', 'sponge', 'table'
  ].some((kw) => l.includes(kw));

  if (hasObjectOrDesire) {
    return false;
  }

  return PHYSICAL_TASK_KEYWORDS.some((kw) => {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    return regex.test(l);
  });
}

// Natural curved desk-lamp default home pose: gracefully arched over the table, NOT upright 90 degrees!
export const DESK_LAMP_HOME_JOINTS: number[] = [0.28, 0.58, 1.15, 0.0, 1.41, 0.0, 0.03];

export const DEFAULT_TABLETOP_OBJECTS: TabletopObject[] = [
  {
    id: 'red_cube',
    name: 'Red Cube',
    shape: 'box',
    color: '#ef4444',
    position: { x: -0.15, y: 0.48, z: 0.16 },
    state: 'table',
    isCustom: false
  },
  {
    id: 'blue_cylinder',
    name: 'Blue Cylinder',
    shape: 'cylinder',
    color: '#3b82f6',
    position: { x: 0.10, y: 0.495, z: 0.14 },
    state: 'table',
    isCustom: false
  },
  {
    id: 'green_sphere',
    name: 'Green Sphere',
    shape: 'sphere',
    color: '#10b981',
    position: { x: -0.12, y: 0.485, z: -0.16 },
    state: 'table',
    isCustom: false
  },
  {
    id: 'water',
    name: 'Water Glass',
    shape: 'glass',
    color: '#06b6d4',
    position: { x: 0.12, y: 0.505, z: -0.14 },
    state: 'table',
    isCustom: false
  },
  {
    id: 'pen',
    name: 'Writing Pen',
    shape: 'cylinder',
    color: '#2563eb',
    position: { x: -0.02, y: 0.465, z: 0.18 },
    state: 'table',
    isCustom: false
  }
];

export interface EntityMetadata {
  name: string;
  shape: TabletopObject['shape'];
  color: string;
  emoji: string;
}

export function getEntityMetadata(targetNameOrText: string): EntityMetadata | undefined {
  const l = (targetNameOrText || '').toLowerCase().trim();

  if (!l || containsExplicitWords(l)) {
    return undefined;
  }

  // If this is a physical task without an explicit recognized tabletop item, do NOT fabricate an entity
  if (isPhysicalTask(l) && !hasExplicitObjectEntity(l)) {
    return undefined;
  }

  // Food, meals & hunger desires (default representative: Red Apple)
  if (l.includes('food') || l.includes('hungry') || l.includes('starv') || l.includes('eat') || l.includes('snack') || l.includes('meal') || l.includes('lunch') || l.includes('breakfast') || l.includes('dinner')) {
    if (l.includes('banana')) return { name: 'Banana', shape: 'cylinder', color: '#facc15', emoji: '🍌' };
    if (l.includes('orange')) return { name: 'Fresh Orange', shape: 'sphere', color: '#f97316', emoji: '🍊' };
    if (l.includes('sandwich')) return { name: 'Sandwich', shape: 'box', color: '#d97706', emoji: '🥪' };
    if (l.includes('cookie')) return { name: 'Cookie', shape: 'cylinder', color: '#b45309', emoji: '🍪' };
    if (l.includes('chips')) return { name: 'Chips Bag', shape: 'box', color: '#ef4444', emoji: '🥔' };
    return { name: 'Red Apple', shape: 'apple', color: '#e11d48', emoji: '🍎' };
  }
  if (l.includes('apple') || l.includes('fruit')) {
    return { name: 'Red Apple', shape: 'apple', color: '#e11d48', emoji: '🍎' };
  }
  // Stationery & office items
  if (
    l.includes('stationery') || l.includes('write') || l.includes('writing') || l.includes('pen') ||
    l.includes('pencil') || l.includes('note') || l.includes('marker') || l.includes('scissors') ||
    l.includes('stapler') || l.includes('ruler') || l.includes('cut') || l.includes('trim') ||
    l.includes('snip') || l.includes('shears') || l.includes('staple') || l.includes('erase') ||
    l.includes('eraser') || l.includes('measure') || l.includes('highlight')
  ) {
    if (l.includes('scissors') || l.includes('cut') || l.includes('trim') || l.includes('snip') || l.includes('shears')) {
      return { name: 'Scissors', shape: 'box', color: '#64748b', emoji: '✂️' };
    }
    if (l.includes('stapler') || l.includes('staple')) return { name: 'Stapler', shape: 'box', color: '#475569', emoji: '📎' };
    if (l.includes('notebook') || l.includes('notes')) return { name: 'Notebook', shape: 'box', color: '#3b82f6', emoji: '📓' };
    if (l.includes('pencil')) return { name: 'Pencil', shape: 'cylinder', color: '#f59e0b', emoji: '✏️' };
    if (l.includes('marker') || l.includes('highlighter') || l.includes('highlight')) return { name: 'Highlighter', shape: 'cylinder', color: '#eab308', emoji: '🖍️' };
    if (l.includes('ruler') || l.includes('measure')) return { name: 'Ruler', shape: 'box', color: '#cbd5e1', emoji: '📏' };
    if (l.includes('eraser') || l.includes('erase')) return { name: 'Eraser', shape: 'box', color: '#f43f5e', emoji: '🧼' };
    return { name: 'Writing Pen', shape: 'cylinder', color: '#2563eb', emoji: '🖊️' };
  }
  // Games, play, toys & boredom
  if (l.includes('game') || l.includes('play') || l.includes('toy') || l.includes('bored') || l.includes('entertain') || l.includes('controller') || l.includes('gamepad')) {
    if (l.includes('tennis') || l.includes('racket') || l.includes('racquet')) {
      return { name: 'Tennis Ball', shape: 'sphere', color: '#84cc16', emoji: '🎾' };
    }
    if (l.includes('dice')) return { name: 'Dice', shape: 'box', color: '#f8fafc', emoji: '🎲' };
    if (l.includes('cards') || l.includes('card')) return { name: 'Playing Cards', shape: 'box', color: '#ffffff', emoji: '🃏' };
    if (l.includes('fidget') || l.includes('stress ball')) return { name: 'Fidget Spinner', shape: 'cylinder', color: '#ec4899', emoji: '🌀' };
    if (l.includes('puzzle')) return { name: 'Puzzle Box', shape: 'box', color: '#a855f7', emoji: '🧩' };
    return { name: 'Game Controller', shape: 'box', color: '#8b5cf6', emoji: '🎮' };
  }
  // Tools & Hardware
  if (l.includes('tool') || l.includes('wrench') || l.includes('screwdriver') || l.includes('pliers') || l.includes('hardware')) {
    if (l.includes('screwdriver')) return { name: 'Screwdriver', shape: 'cylinder', color: '#f97316', emoji: '🪛' };
    if (l.includes('pliers')) return { name: 'Pliers', shape: 'box', color: '#64748b', emoji: '🛠️' };
    return { name: 'Wrench', shape: 'cylinder', color: '#475569', emoji: '🔧' };
  }
  if (l.includes('coffee') || l.includes('mug') || l.includes('latte') || l.includes('espresso') || l.includes('caffeine') || (l.includes('tired') && !l.includes('water'))) {
    return { name: 'Coffee Mug', shape: 'mug', color: '#8B4513', emoji: '☕' };
  }
  if (l.includes('water') || l.includes('thirsty') || l.includes('hydrate') || (l.includes('drink') && !l.includes('coffee'))) {
    return { name: 'Water Glass', shape: 'glass', color: '#06b6d4', emoji: '🥤' };
  }
  if (l.includes('banana')) {
    return { name: 'Banana', shape: 'cylinder', color: '#facc15', emoji: '🍌' };
  }
  if (l.includes('orange')) {
    return { name: 'Fresh Orange', shape: 'sphere', color: '#f97316', emoji: '🍊' };
  }
  if (l.includes('dice') || l.includes('die')) {
    return { name: 'Dice', shape: 'box', color: '#f8fafc', emoji: '🎲' };
  }
  if (l.includes('stress ball') || l.includes('fidget')) {
    return { name: 'Stress Ball', shape: 'sphere', color: '#ec4899', emoji: '🧘' };
  }
  if (l.includes('cards') || l.includes('card')) {
    return { name: 'Playing Cards', shape: 'box', color: '#ffffff', emoji: '🃏' };
  }
  if (l.includes('sponge')) {
    return { name: 'Cleaning Sponge', shape: 'box', color: '#fde047', emoji: '🧽' };
  }
  if (l.includes('bottle') || l.includes('can') || l.includes('soda')) {
    return { name: 'Soda Can', shape: 'cylinder', color: '#ef4444', emoji: '🥫' };
  }
  if (l.includes('box') || l.includes('package') || l.includes('storage')) {
    return { name: 'Storage Box', shape: 'box', color: '#d97706', emoji: '📦' };
  }
  if (l.includes('red cube') || (l.includes('cube') && l.includes('red'))) {
    return { name: 'Red Cube', shape: 'box', color: '#ef4444', emoji: '🟥' };
  }
  if (l.includes('blue cylinder') || (l.includes('cylinder') && l.includes('blue'))) {
    return { name: 'Blue Cylinder', shape: 'cylinder', color: '#3b82f6', emoji: '🛢️' };
  }
  if (l.includes('green sphere') || (l.includes('sphere') && l.includes('green'))) {
    return { name: 'Green Sphere', shape: 'sphere', color: '#10b981', emoji: '🟢' };
  }
  if (l.includes('cube') || l.includes('block')) {
    return { name: 'Cube Block', shape: 'box', color: '#ef4444', emoji: '🧊' };
  }
  if (l.includes('cylinder') || l.includes('canister')) {
    return { name: 'Cylinder', shape: 'cylinder', color: '#3b82f6', emoji: '🛢️' };
  }
  if (l.includes('sphere') || l.includes('ball')) {
    return { name: 'Sphere Ball', shape: 'sphere', color: '#10b981', emoji: '⚽' };
  }

  // If not a recognized tabletop object, do NOT fabricate an item for physical tasks or general actions
  if (isPhysicalTask(l) || !hasExplicitObjectEntity(l)) {
    return undefined;
  }

  // Universal fallback for custom physical item:
  const formatted = l ? l.charAt(0).toUpperCase() + l.slice(1).replace(/_/g, ' ') : 'Object';
  return { name: formatted, shape: 'box', color: '#a855f7', emoji: '✨' };
}

export interface ActivityConcept {
  id: string;
  keywords: string[];
  impliedNeed: string;
  defaultName: string;
  shape: TabletopObject['shape'];
  color: string;
  searchMatchers: string[];
}

export const SEMANTIC_ACTIVITY_ONTOLOGY: ActivityConcept[] = [
  // 1. Tennis & Ball Sports
  {
    id: 'tennis',
    keywords: [
      'tennis', 'play tennis', 'practice tennis', 'tennis ball', 'tennis match',
      'court', 'racket', 'racquet', 'serve', 'wimbledon', 'play with ball', 'play catch', 'catch', 'throw ball', 'toss'
    ],
    impliedNeed: 'tennis ball for sports activity',
    defaultName: 'Tennis Ball',
    shape: 'sphere',
    color: '#84cc16',
    searchMatchers: ['tennis', 'tennis ball', 'tennis_ball']
  },
  // 2. Play, Games, Boredom & Recreation
  {
    id: 'play',
    keywords: [
      'play', 'game', 'bored', 'fun', 'entertain', 'play a game', 'let\'s play'
    ],
    impliedNeed: 'tennis ball or game item',
    defaultName: 'Tennis Ball',
    shape: 'sphere',
    color: '#84cc16',
    searchMatchers: ['tennis', 'tennis ball', 'tennis_ball', 'fidget', 'dice', 'cards']
  },
  // 3. Caffeine, Coffee & Fatigue
  {
    id: 'coffee',
    keywords: [
      'coffee', 'caffeine', 'mug', 'coffee mug', 'espresso', 'latte', 'cappuccino',
      'cup of joe', 'tired', 'sleepy', 'exhausted', 'wake up', 'energy',
      'morning', 'drowsy', 'brew', 'hot coffee', 'tea', 'tea cup', 'drink coffee'
    ],
    impliedNeed: 'fresh coffee in ceramic mug',
    defaultName: 'Coffee Mug',
    shape: 'mug',
    color: '#8B4513',
    searchMatchers: ['coffee', 'coffee mug', 'coffee_mug', 'latte', 'espresso']
  },
  // 4. Hydration & Thirst
  {
    id: 'water',
    keywords: [
      'water', 'thirsty', 'thirst', 'parched', 'drink', 'drinking water',
      'glass of water', 'cup of water', 'hydrate', 'hydration', 'refreshment'
    ],
    impliedNeed: 'glass of drinking water',
    defaultName: 'Water Glass',
    shape: 'glass',
    color: '#06b6d4',
    searchMatchers: ['water', 'water glass', 'drinking water', 'glass']
  },
  // 5. Hunger, Snacks & Fruit
  {
    id: 'apple',
    keywords: [
      'hungry', 'starving', 'snack', 'food', 'fruit', 'apple', 'fresh apple',
      'red apple', 'green apple', 'eat', 'eating', 'bite', 'starve', 'nutrition'
    ],
    impliedNeed: 'fresh red apple snack',
    defaultName: 'Red Apple',
    shape: 'apple',
    color: '#e11d48',
    searchMatchers: ['apple', 'red apple', 'fresh apple', 'fruit']
  },
  // 6. Packaging, Cubes & Stacking
  {
    id: 'box',
    keywords: [
      'pack', 'package', 'shipping', 'ship', 'box', 'storage', 'stack', 'blocks',
      'tower', 'cube', 'brick'
    ],
    impliedNeed: 'packaging cube or box',
    defaultName: 'Storage Box',
    shape: 'box',
    color: '#f59e0b',
    searchMatchers: ['storage box', 'box', 'cube', 'package', 'block']
  },
  // 7. Cylinders & Industrial Canisters
  {
    id: 'cylinder',
    keywords: [
      'cylinder', 'canister', 'tube', 'can', 'capsule', 'pillar'
    ],
    impliedNeed: 'cylinder canister',
    defaultName: 'Blue Cylinder',
    shape: 'cylinder',
    color: '#3b82f6',
    searchMatchers: ['blue cylinder', 'cylinder', 'tube', 'canister']
  },
  // 8. Scissors & Paper Cutting (Acquires Scissors)
  {
    id: 'scissors',
    keywords: [
      'cut', 'cut paper', 'cutting', 'trim', 'trim paper', 'snip', 'snip paper',
      'scissors', 'shears', 'slice paper', 'craft cut', 'cut this', 'cut sheets', 'cutting paper'
    ],
    impliedNeed: 'pair of scissors for cutting paper',
    defaultName: 'Office Scissors',
    shape: 'box',
    color: '#64748b',
    searchMatchers: ['scissors', 'office scissors', 'scissor', 'cutting tool', 'shears']
  },
  // 9. Stapler & Document Binding (Acquires Stapler)
  {
    id: 'stapler',
    keywords: [
      'staple', 'staple paper', 'stapling', 'bind', 'bind papers', 'fasten',
      'fasten papers', 'stapler', 'staples', 'paper fastener'
    ],
    impliedNeed: 'stapler for binding papers',
    defaultName: 'Paper Stapler',
    shape: 'box',
    color: '#475569',
    searchMatchers: ['stapler', 'paper stapler', 'staple']
  },
  // 10. Eraser & Mistake Correction (Acquires Eraser)
  {
    id: 'eraser',
    keywords: [
      'erase', 'erasing', 'rub out', 'remove pencil', 'made a mistake', 'mistake',
      'fix mistake', 'eraser', 'rubber eraser', 'pencil eraser'
    ],
    impliedNeed: 'pink eraser for removing pencil marks',
    defaultName: 'Pink Eraser',
    shape: 'box',
    color: '#f43f5e',
    searchMatchers: ['eraser', 'pink eraser', 'rubber']
  },
  // 11. Ruler & Precision Measurement (Acquires Ruler)
  {
    id: 'ruler',
    keywords: [
      'measure', 'measuring', 'draw straight line', 'straight line', 'measure length',
      'ruler', 'metric ruler', 'measure distance'
    ],
    impliedNeed: 'desk ruler for measuring and straight lines',
    defaultName: 'Desk Ruler',
    shape: 'box',
    color: '#cbd5e1',
    searchMatchers: ['ruler', 'desk ruler', 'scale']
  },
  // 12. Highlighter & Text Marking (Acquires Highlighter)
  {
    id: 'highlighter',
    keywords: [
      'highlight', 'highlighter', 'fluorescent', 'mark text', 'underline',
      'neon marker', 'highlighting'
    ],
    impliedNeed: 'neon highlighter for text marking',
    defaultName: 'Neon Highlighter',
    shape: 'cylinder',
    color: '#eab308',
    searchMatchers: ['highlighter', 'neon highlighter', 'marker']
  },
  // 13. Writing Pen & Taking Notes (Acquires Writing Pen)
  {
    id: 'pen',
    keywords: [
      'write', 'writing', 'pen', 'pencil', 'note', 'take notes', 'jot down',
      'sign', 'signature', 'desk item', 'jot', 'ballpoint', 'stationery'
    ],
    impliedNeed: 'writing pen for taking notes',
    defaultName: 'Writing Pen',
    shape: 'cylinder',
    color: '#2563eb',
    searchMatchers: ['pen', 'writing pen', 'pencil', 'stationery']
  }
];

class RosBridgeService {
  private ros: ROSLIB.Ros | null = null;
  private wsUrl: string = 'ws://localhost:9090';
  private connected: boolean = false;
  private reconnectInterval: any = null;

  // Table-mounted side arm base location (attached to the side of the table like an architect lamp!)
  public readonly robotBasePos: ObjectPosition = { x: -0.35, y: 0.45, z: -0.05 };

  // Front-edge user handover station on table
  public readonly handoverPos: ObjectPosition = { x: 0.08, y: 0.45 + 0.14, z: 0.28 };

  // Track arm joint angles continuously initialized to the curved desk lamp pose
  private currentJointPositions: number[] = [...DESK_LAMP_HOME_JOINTS];

  // Dynamic tabletop objects list
  private tabletopObjects: TabletopObject[] = JSON.parse(JSON.stringify(DEFAULT_TABLETOP_OBJECTS));

  // Dynamic tabletop object positions map (surfaceY = 0.45)
  private objectPositions: Record<string, ObjectPosition> = {
    red_cube: { x: -0.15, y: 0.48, z: 0.16 },
    blue_cylinder: { x: 0.10, y: 0.495, z: 0.14 },
    green_sphere: { x: -0.12, y: 0.485, z: -0.16 },
    water: { x: 0.12, y: 0.505, z: -0.14 },
    pen: { x: -0.02, y: 0.465, z: 0.18 }
  };

  // Emergency Stop & Safety Interlock State
  private isEStopped: boolean = false;
  private isCancelled: boolean = false;
  private isExecuting: boolean = false;
  private currentExecutionId: number = 0;
  private activeDelayResolver: (() => void) | null = null;
  private eStopListeners: Set<(isStopped: boolean) => void> = new Set();

  // Listeners
  private connectionListeners: Set<ConnectionCallback> = new Set();
  private jointListeners: Set<JointStateCallback> = new Set();
  private logListeners: Set<LogCallback> = new Set();
  private stateListeners: Set<StateCallback> = new Set();
  private pipelineListeners: Set<PipelineProgressCallback> = new Set();
  private objectStateListeners: Set<ObjectStateCallback> = new Set();
  private positionListeners: Set<ObjectPositionCallback> = new Set();
  private perceptionListeners: Set<PerceptionScanCallback> = new Set();
  private objectsListeners: Set<TabletopObjectsCallback> = new Set();
  private armSpeechListeners: Set<ArmSpeechCallback> = new Set();
  private guardrailListeners: Set<GuardrailCallback> = new Set();

  // Active ROS subscriptions
  private rosoutSub: ROSLIB.Topic | null = null;
  private jointStatesSub: ROSLIB.Topic | null = null;
  private orchStateSub: ROSLIB.Topic | null = null;

  constructor() {}

  public init(url: string = 'ws://localhost:9090'): void {
    this.wsUrl = url;
    this.connect();
  }

  public connect(): void {
    if (this.ros) {
      try {
        this.ros.close();
      } catch (e) {
        // ignore
      }
    }

    try {
      this.ros = new ROSLIB.Ros({ url: this.wsUrl });

      this.ros.on('connection', () => {
        this.connected = true;
        this.notifyConnection(true);
        this.emitLog({
          level: 20,
          levelName: 'INFO',
          nodeName: 'web_bridge',
          message: `Connected to ROS 2 bridge at ${this.wsUrl}`
        });
        this.subscribeTopics();
      });

      this.ros.on('error', (_error: any) => {
        this.connected = false;
        this.notifyConnection(false);
      });

      this.ros.on('close', () => {
        this.connected = false;
        this.notifyConnection(false);
      });
    } catch (e) {
      this.connected = false;
      this.notifyConnection(false);
    }
  }

  public disconnect(): void {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    if (this.ros) {
      this.ros.close();
    }
    this.connected = false;
    this.notifyConnection(false);
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public getUrl(): string {
    return this.wsUrl;
  }

  public getCurrentJointPositions(): number[] {
    return [...this.currentJointPositions];
  }

  public onPerceptionScan(cb: PerceptionScanCallback): () => void {
    this.perceptionListeners.add(cb);
    return () => this.perceptionListeners.delete(cb);
  }

  public emitPerceptionScan(event: PerceptionScanEvent): void {
    this.perceptionListeners.forEach((cb) => cb(event));
  }

  public getObjects(): TabletopObject[] {
    return [...this.tabletopObjects];
  }

  public onObjectsChange(cb: TabletopObjectsCallback): () => void {
    this.objectsListeners.add(cb);
    cb(this.getObjects());
    return () => this.objectsListeners.delete(cb);
  }

  public emitObjectsChange(): void {
    const list = this.getObjects();
    this.objectsListeners.forEach((cb) => cb(list));
  }

  public addObject(params: {
    name: string;
    shape: TabletopObject['shape'];
    color: string;
    position?: ObjectPosition;
    spawnZone?: 'center' | 'left' | 'right' | 'user' | 'auto';
    zone?: 'center' | 'left' | 'right' | 'user' | 'auto';
  }): TabletopObject {
    const cleanName = params.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_') || 'item';
    const uniqueSuffix = Math.random().toString(36).substring(2, 6);
    const id = `${cleanName}_${uniqueSuffix}`;

    // Vertical height based on shape geometry
    let y = 0.48;
    if (params.shape === 'cylinder') y = 0.495;
    else if (params.shape === 'sphere' || params.shape === 'apple') y = 0.485;
    else if (params.shape === 'glass') y = 0.505;
    else if (params.shape === 'mug') y = 0.492;

    const chosenZone = params.spawnZone || params.zone || 'auto';

    let pos = params.position;
    if (!pos) {
      if (chosenZone === 'center') {
        pos = { x: 0.0, y, z: 0.22 };
      } else if (chosenZone === 'left') {
        pos = { x: -0.24, y, z: 0.16 };
      } else if (chosenZone === 'right') {
        pos = { x: 0.22, y, z: 0.16 };
      } else if (chosenZone === 'user') {
        pos = { x: 0.0, y, z: 0.34 };
      } else {
        // Auto: find first clear spot among prime reachable tabletop slots
        const primeSlots = [
          { x: 0.0, z: 0.16 },
          { x: -0.14, z: 0.16 },
          { x: 0.12, z: 0.14 },
          { x: -0.12, z: -0.06 },
          { x: 0.12, z: -0.06 },
          { x: 0.0, z: -0.14 },
          { x: -0.10, z: 0.22 },
          { x: 0.08, z: 0.22 }
        ];

        let bestSlot = primeSlots[0];
        let maxMinDist = -1;

        for (const slot of primeSlots) {
          let minDist = 999;
          for (const existing of this.tabletopObjects) {
            const d = Math.hypot(slot.x - existing.position.x, slot.z - existing.position.z);
            if (d < minDist) minDist = d;
          }
          if (minDist > 0.12) {
            bestSlot = slot;
            break;
          }
          if (minDist > maxMinDist) {
            maxMinDist = minDist;
            bestSlot = slot;
          }
        }
        pos = { x: bestSlot.x, y, z: bestSlot.z };
      }
    } else {
      pos = { ...pos, y };
    }

    const newObj: TabletopObject = {
      id,
      name: params.name.trim(),
      shape: params.shape,
      color: params.color,
      position: pos,
      state: 'table',
      isCustom: true
    };

    this.tabletopObjects.push(newObj);
    this.objectPositions[id] = { ...pos };

    this.emitObjectsChange();
    this.positionListeners.forEach((cb) => cb({ ...this.objectPositions }));
    this.emitObjectEvent({ name: id, state: 'table', position: { ...pos } });

    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'tabletop_env',
      message: `[Workspace] Added new object: "${newObj.name}" (${newObj.shape}, ${newObj.color}) at dynamic coordinates (X: ${pos.x.toFixed(2)}m, Z: ${pos.z.toFixed(2)}m).`
    });

    return newObj;
  }

  public removeObject(id: string): void {
    const idx = this.tabletopObjects.findIndex((o) => o.id === id);
    if (idx !== -1) {
      const removed = this.tabletopObjects.splice(idx, 1)[0];
      delete this.objectPositions[id];

      this.emitObjectsChange();
      this.positionListeners.forEach((cb) => cb({ ...this.objectPositions }));

      this.emitLog({
        level: 20,
        levelName: 'INFO',
        nodeName: 'tabletop_env',
        message: `[Workspace] Removed object: "${removed.name}" [${id}] from tabletop.`
      });
    }
  }

  public clearAllObjects(): void {
    const count = this.tabletopObjects.length;
    this.tabletopObjects = [];
    this.objectPositions = {};

    this.emitObjectsChange();
    this.positionListeners.forEach((cb) => cb({}));

    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'tabletop_env',
      message: `[Workspace] Cleared all ${count} object(s) from the tabletop.`
    });
  }

  public resetToDefaultObjects(): void {
    this.tabletopObjects = JSON.parse(JSON.stringify(DEFAULT_TABLETOP_OBJECTS));
    this.objectPositions = {
      red_cube: { x: -0.15, y: 0.48, z: 0.16 },
      blue_cylinder: { x: 0.10, y: 0.495, z: 0.14 },
      green_sphere: { x: -0.12, y: 0.485, z: -0.16 },
      water: { x: 0.12, y: 0.505, z: -0.14 },
      pen: { x: -0.02, y: 0.465, z: 0.18 }
    };

    this.emitObjectsChange();
    this.positionListeners.forEach((cb) => cb({ ...this.objectPositions }));

    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'tabletop_env',
      message: '[Workspace] Restored default tabletop objects (Red Cube, Blue Cylinder, Green Sphere, Water Glass, Writing Pen).'
    });
  }

  public onObjectPositionChange(cb: ObjectPositionCallback): () => void {
    this.positionListeners.add(cb);
    cb({ ...this.objectPositions });
    return () => this.positionListeners.delete(cb);
  }

  public getObjectPosition(name: string): ObjectPosition {
    const key = this.normalizeObjectName(name);
    if (key && this.objectPositions[key]) {
      return { ...this.objectPositions[key] };
    }
    return { x: 0.0, y: 0.48, z: 0.25 };
  }

  public getAllObjectPositions(): Record<string, ObjectPosition> {
    return { ...this.objectPositions };
  }

  public setObjectPosition(name: string, pos: ObjectPosition): void {
    const key = this.normalizeObjectName(name) || name;
    if (key) {
      this.objectPositions[key] = { ...pos };
      const obj = this.tabletopObjects.find((o) => o.id === key);
      if (obj) {
        obj.position = { ...pos };
      }
      this.positionListeners.forEach((cb) => cb({ ...this.objectPositions }));
      this.emitObjectEvent({ name: key, state: 'table', position: { ...pos } });
      this.emitLog({
        level: 20,
        levelName: 'INFO',
        nodeName: 'tabletop_env',
        message: `Workspace update: [${key}] placed at dynamic coordinates (X: ${pos.x.toFixed(2)}m, Z: ${pos.z.toFixed(2)}m).`
      });
    }
  }

  public randomizeObjects(): void {
    const total = this.tabletopObjects.length;
    this.tabletopObjects.forEach((obj, i) => {
      const angle = (i * ((2 * Math.PI) / Math.max(1, total))) + (Math.random() * 0.4 - 0.2);
      const radius = 0.18 + Math.random() * 0.16;
      let x = Math.max(-0.20, Math.min(0.24, Math.cos(angle) * radius));
      let z = Math.max(-0.18, Math.min(0.22, 0.05 - Math.sin(angle) * radius));

      // Keep clear of storage tray at (-0.05, -0.24)
      if (Math.hypot(x - (-0.05), z - (-0.24)) < 0.14) {
        z = -0.08;
      }
      // Keep clear of robot base at (-0.35, -0.05)
      if (Math.hypot(x - (-0.35), z - (-0.05)) < 0.16) {
        x = -0.15;
      }

      const pos = {
        x: Number(x.toFixed(3)),
        y: obj.position.y,
        z: Number(z.toFixed(3))
      };
      obj.position = pos;
      obj.state = 'table';
      this.objectPositions[obj.id] = pos;
    });

    this.positionListeners.forEach((cb) => cb({ ...this.objectPositions }));
    this.emitObjectsChange();
    this.tabletopObjects.forEach((obj) => {
      this.emitObjectEvent({ name: obj.id, state: 'table', position: obj.position });
    });

    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'tabletop_env',
      message: `Workspace randomized: All ${total} objects scattered across tabletop.`
    });
  }

  public onObjectEvent(cb: ObjectStateCallback): () => void {
    this.objectStateListeners.add(cb);
    return () => this.objectStateListeners.delete(cb);
  }

  public emitObjectEvent(event: ObjectStateEvent): void {
    this.objectStateListeners.forEach((cb) => cb(event));
  }

  public resetObjects(): void {
    // Reset default objects to original positions, retain custom objects but place on table
    this.tabletopObjects = this.tabletopObjects.map((obj) => {
      const def = DEFAULT_TABLETOP_OBJECTS.find((d) => d.id === obj.id);
      const pos = def ? { ...def.position } : { ...obj.position };
      return {
        ...obj,
        position: pos,
        state: 'table'
      };
    });

    this.objectPositions = {};
    this.tabletopObjects.forEach((obj) => {
      this.objectPositions[obj.id] = { ...obj.position };
    });

    this.positionListeners.forEach((cb) => cb({ ...this.objectPositions }));
    this.emitObjectsChange();
    this.tabletopObjects.forEach((obj) => {
      this.emitObjectEvent({ name: obj.id, state: 'table', position: obj.position });
    });

    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'tabletop_env',
      message: 'Workspace reset: Tabletop items repositioned to default configuration.'
    });
  }

  public getConceptForText(text: string): ActivityConcept | null {
    if (!text) return null;
    const lower = text.toLowerCase().trim();
    for (const concept of SEMANTIC_ACTIVITY_ONTOLOGY) {
      if (concept.keywords.some((kw) => lower.includes(kw))) {
        return concept;
      }
    }
    return null;
  }

  public findObjectFromText(text: string): TabletopObject | null {
    if (!text) return null;
    const lower = text.toLowerCase().trim();

    // 1. Direct exact match with registered objects by ID or exact name
    for (const obj of this.tabletopObjects) {
      const nameL = obj.name.toLowerCase();
      const idL = obj.id.toLowerCase();
      if (lower === nameL || lower === idL) {
        return obj;
      }
    }

    // 2. Exact substring phrase match for full name or ID (e.g. "red cube", "red apple", "blue cylinder")
    for (const obj of this.tabletopObjects) {
      const nameL = obj.name.toLowerCase();
      const idL = obj.id.toLowerCase();
      if (lower.includes(nameL) || lower.includes(idL)) {
        return obj;
      }
    }

    // Semantic category and shape nouns vs color adjectives
    const SHAPE_NOUNS = [
      'tennis', 'racket', 'racquet', 'apple', 'fruit', 'coffee', 'mug',
      'cube', 'box', 'block', 'cylinder', 'can', 'bottle', 'sphere', 'ball', 'orb', 'glass', 'water'
    ];
    const COLOR_ADJECTIVES = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'cyan', 'white', 'black', 'pink', 'brown', 'gray', 'grey'];

    const mentionedNouns = SHAPE_NOUNS.filter((n) => lower.includes(n));
    const mentionedColors = COLOR_ADJECTIVES.filter((c) => lower.includes(c));

    // If an explicit shape/entity noun is mentioned, require strict noun compatibility!
    // A color adjective alone (e.g. "green") MUST NOT match a different noun (e.g. "green sphere" for "tennis ball")!
    if (mentionedNouns.length > 0) {
      const matchingObjects = this.tabletopObjects.filter((obj) => {
        const objNameL = obj.name.toLowerCase();
        const objIdL = obj.id.toLowerCase();
        return mentionedNouns.some((n) => {
          if (n === 'tennis' || n === 'racket' || n === 'racquet') {
            return objNameL.includes('tennis') || objIdL.includes('tennis');
          }
          if (n === 'apple' || n === 'fruit') {
            return obj.shape === 'apple' || objNameL.includes('apple') || objIdL.includes('apple') || objNameL.includes('fruit');
          }
          if (n === 'coffee' || n === 'mug') {
            return obj.shape === 'mug' || objNameL.includes('coffee') || objIdL.includes('coffee') || objNameL.includes('mug');
          }
          if (n === 'cube' || n === 'box' || n === 'block') {
            return obj.shape === 'box' || objNameL.includes('cube') || objIdL.includes('cube') || objNameL.includes('box');
          }
          if (n === 'cylinder' || n === 'can' || n === 'bottle') {
            return obj.shape === 'cylinder' || objNameL.includes('cylinder') || objIdL.includes('cylinder');
          }
          if (n === 'sphere' || n === 'ball' || n === 'orb') {
            if (lower.includes('tennis')) {
              return objNameL.includes('tennis') || objIdL.includes('tennis');
            }
            return obj.shape === 'sphere' || objNameL.includes('sphere') || objIdL.includes('sphere') || objNameL.includes('ball');
          }
          if (n === 'glass' || n === 'water') {
            if (lower.includes('coffee')) return false;
            return obj.shape === 'glass' || objNameL.includes('glass') || objIdL.includes('water') || objNameL.includes('water');
          }
          return false;
        });
      });

      if (matchingObjects.length > 0) {
        // If color was also specified, prioritize matching both noun AND color
        if (mentionedColors.length > 0) {
          const colorMatch = matchingObjects.find((obj) => {
            const objNameL = obj.name.toLowerCase();
            const objIdL = obj.id.toLowerCase();
            return mentionedColors.some((c) => objNameL.includes(c) || objIdL.includes(c));
          });
          if (colorMatch) return colorMatch;
        }
        return matchingObjects[0];
      }

      // Explicit noun requested (e.g. "apple" or "tennis ball"), but no object with that noun exists on table!
      // Do NOT fall back to other objects that just happen to share a color or shape (like green sphere for tennis ball)!
      return null;
    }

    // 3. Match against Commonsense Activity & Desire Ontology on existing tabletop objects
    const concept = this.getConceptForText(text);
    if (concept) {
      for (const matcher of concept.searchMatchers) {
        const found = this.tabletopObjects.find((o) => {
          const nameL = o.name.toLowerCase();
          const idL = o.id.toLowerCase();
          return nameL.includes(matcher) || idL.includes(matcher);
        });
        if (found) {
          return found;
        }
      }
    }

    // 4. Color-only disambiguation if NO conflicting noun was specified
    if (mentionedColors.length > 0 && mentionedNouns.length === 0) {
      for (const obj of this.tabletopObjects) {
        const objNameL = obj.name.toLowerCase();
        const objIdL = obj.id.toLowerCase();
        if (mentionedColors.some((c) => objNameL.includes(c) || objIdL.includes(c))) {
          return obj;
        }
      }
    }

    return null;
  }

  public normalizeObjectName(raw?: string | null): string | null {
    if (!raw) return null;
    const l = raw.toLowerCase().trim();

    // 1. Direct match with registered objects by id or exact name
    for (const o of this.tabletopObjects) {
      if (l === o.id.toLowerCase() || l === o.name.toLowerCase()) {
        return o.id;
      }
    }

    const obj = this.findObjectFromText(l);
    if (obj) return obj.id;

    // 2. Direct string contains
    for (const o of this.tabletopObjects) {
      if (l.includes(o.id.toLowerCase()) || l.includes(o.name.toLowerCase())) {
        return o.id;
      }
    }

    // 3. Specific item identification (respecting strict semantics!)
    if (l.includes('scissors') || l.includes('scissor') || l.includes('cut') || l.includes('trim') || l.includes('snip') || l.includes('shears')) {
      const scissorsObj = this.tabletopObjects.find(
        (o) => o.id.toLowerCase().includes('scissor') || o.name.toLowerCase().includes('scissor')
      );
      return scissorsObj ? scissorsObj.id : 'scissors';
    }

    if (l.includes('stapler') || l.includes('staple') || l.includes('bind')) {
      const staplerObj = this.tabletopObjects.find(
        (o) => o.id.toLowerCase().includes('stapler') || o.name.toLowerCase().includes('stapler')
      );
      return staplerObj ? staplerObj.id : 'stapler';
    }

    if (l.includes('eraser') || l.includes('erase') || l.includes('rub out')) {
      const eraserObj = this.tabletopObjects.find(
        (o) => o.id.toLowerCase().includes('eraser') || o.name.toLowerCase().includes('eraser')
      );
      return eraserObj ? eraserObj.id : 'eraser';
    }

    if (l.includes('ruler') || l.includes('measure') || l.includes('straight line')) {
      const rulerObj = this.tabletopObjects.find(
        (o) => o.id.toLowerCase().includes('ruler') || o.name.toLowerCase().includes('ruler')
      );
      return rulerObj ? rulerObj.id : 'ruler';
    }

    if (l.includes('highlighter') || l.includes('highlight')) {
      const hlObj = this.tabletopObjects.find(
        (o) => o.id.toLowerCase().includes('highlighter') || o.name.toLowerCase().includes('highlighter')
      );
      return hlObj ? hlObj.id : 'highlighter';
    }

    if (l.includes('tennis') || l.includes('racket') || l.includes('racquet') || (l.includes('play') && l.includes('ball'))) {
      const tennisObj = this.tabletopObjects.find(
        (o) => o.id.toLowerCase().includes('tennis') || o.name.toLowerCase().includes('tennis')
      );
      return tennisObj ? tennisObj.id : 'tennis_ball';
    }

    if (l.includes('pen') || l.includes('pencil') || l.includes('marker') || l.includes('stationery') || (l.includes('write') && !l.includes('water'))) {
      const penObj = this.tabletopObjects.find(
        (o) => o.id.toLowerCase().includes('pen') || o.name.toLowerCase().includes('pen') || o.name.toLowerCase().includes('pencil')
      );
      return penObj ? penObj.id : 'pen';
    }

    if (l.includes('apple') || l.includes('fruit')) {
      const appleObj = this.tabletopObjects.find(
        (o) => o.shape === 'apple' || o.id.toLowerCase().includes('apple') || o.name.toLowerCase().includes('apple')
      );
      return appleObj ? appleObj.id : 'apple';
    }

    if (l.includes('coffee') || (l.includes('tired') && !l.includes('water')) || (l.includes('mug') && !l.includes('water'))) {
      const mugObj = this.tabletopObjects.find(
        (o) => o.shape === 'mug' || o.id.toLowerCase().includes('coffee') || o.name.toLowerCase().includes('coffee')
      );
      return mugObj ? mugObj.id : 'coffee_mug';
    }

    if (l.includes('cube') || l.includes('box') || l.includes('block')) {
      const cubeObj = this.tabletopObjects.find((o) => o.shape === 'box' || o.id.toLowerCase().includes('cube'));
      return cubeObj ? cubeObj.id : 'red_cube';
    }

    if (l.includes('cylinder') || (l.includes('blue') && !l.includes('cube') && !l.includes('apple'))) {
      const cylObj = this.tabletopObjects.find((o) => o.shape === 'cylinder' || o.id.toLowerCase().includes('cylinder'));
      return cylObj ? cylObj.id : 'blue_cylinder';
    }

    if (l.includes('water') || l.includes('glass') || l.includes('drink')) {
      const glassObj = this.tabletopObjects.find((o) => o.shape === 'glass' || o.id.toLowerCase().includes('water'));
      return glassObj ? glassObj.id : 'water';
    }

    if (l.includes('sphere') || (!l.includes('tennis') && l.includes('ball'))) {
      const sphereObj = this.tabletopObjects.find((o) => o.shape === 'sphere' || o.id.toLowerCase().includes('sphere'));
      return sphereObj ? sphereObj.id : 'green_sphere';
    }

    return null;
  }

  private subscribeTopics(): void {
    if (!this.ros || !this.connected) return;

    // 1. Subscribe to /rosout
    this.rosoutSub = new ROSLIB.Topic({
      ros: this.ros,
      name: '/rosout',
      messageType: 'rcl_interfaces/msg/Log'
    });
    this.rosoutSub.subscribe((msg: any) => {
      const levelMap: Record<number, 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'> = {
        10: 'DEBUG',
        20: 'INFO',
        30: 'WARN',
        40: 'ERROR',
        50: 'FATAL'
      };
      this.emitLog({
        level: msg.level || 20,
        levelName: levelMap[msg.level] || 'INFO',
        nodeName: msg.name || 'ros2_node',
        message: msg.msg || '',
        file: msg.file,
        line: msg.line
      });
    });

    // 2. Subscribe to /joint_states
    this.jointStatesSub = new ROSLIB.Topic({
      ros: this.ros,
      name: '/joint_states',
      messageType: 'sensor_msgs/msg/JointState'
    });
    this.jointStatesSub.subscribe((msg: any) => {
      if (msg.name && msg.position) {
        msg.name.forEach((name: string, i: number) => {
          const mapIdx: Record<string, number> = {
            joint1: 0,
            joint2: 1,
            joint3: 2,
            joint4: 3,
            joint5: 4,
            joint6: 5,
            gripper_joint: 6
          };
          if (name in mapIdx) {
            this.currentJointPositions[mapIdx[name]] = msg.position[i];
          }
        });

        this.jointListeners.forEach((cb) =>
          cb({
            names: msg.name,
            positions: msg.position,
            velocities: msg.velocity,
            efforts: msg.effort
          })
        );
      }
    });

    // 3. Subscribe to orchestrator status
    this.orchStateSub = new ROSLIB.Topic({
      ros: this.ros,
      name: '/nora/orchestrator/state',
      messageType: 'std_msgs/msg/String'
    });
    this.orchStateSub.subscribe((msg: any) => {
      if (msg.data) {
        this.stateListeners.forEach((cb) => cb(msg.data as OrchestratorFsmState));
      }
    });
  }

  public isTaskExecuting(): boolean {
    return this.isExecuting;
  }

  public async executeCommand(text: string): Promise<void> {
    const l = text.trim().toLowerCase();
    const isCancel =
      l === 'cancel' ||
      l === 'stop' ||
      l === 'abort' ||
      l === 'halt' ||
      l === 'stop program' ||
      l === 'stop the program' ||
      l === 'stop arm' ||
      l === 'stop the arm' ||
      l === 'cancel task' ||
      l === 'cancel the task' ||
      l === 'cancel program' ||
      l.startsWith('cancel ') ||
      l.startsWith('abort ');

    if (isCancel) {
      await this.cancelTask();
      return;
    }

    // If an existing task is actively executing, abort it cleanly before launching the new command
    if (this.isExecuting) {
      await this.cancelTask();
      await this.motionSleep(60);
    }

    // Immediate Safety Interlock: Immediately flag and reject explicit words
    if (containsExplicitWords(text)) {
      this.emitLog({
        level: 40,
        levelName: 'ERROR',
        nodeName: 'nora_safety',
        message: `🛡️ [Safety Interlock] Explicit content detected in command "${text}". Cannot process explicit words.`
      });

      const intent: Intent = {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'explicit_blocked',
        target_object: null,
        target_location: null,
        parameters: {
          reason: 'Cannot process explicit words.',
          error: 'Cannot process explicit words.',
          is_explicit: true
        },
        confidence: 0.0
      };

      const zeroAffordances: AffordanceScore[] = [
        {
          skill_name: 'safety_interlock',
          usefulness: 0.0,
          feasibility: 0.0,
          combined_score: 0.0,
          breakdown: { reachability: 0.0, collision_free: 0.0, object_state: 0.0 }
        }
      ];

      const guardrailEvt: GuardrailEvent = {
        active: true,
        title: 'Safety Interlock: Explicit Words Blocked',
        reason: 'Cannot process explicit words.',
        score: 0.0,
        threshold: 0.30,
        type: 'explicit',
        timestamp: Date.now()
      };

      this.publishAffordanceScore(intent, zeroAffordances[0]);

      this.notifyPipeline({
        stage: 'FAILED',
        intent,
        affordances: zeroAffordances,
        error: 'Cannot process explicit words.',
        guardrailEvent: guardrailEvt
      });

      this.stateListeners.forEach((cb) => cb('FAILED'));
      this.emitGuardrail(guardrailEvt);

      // Say aloud via TTS and 3D speech bubble
      this.emitArmSpeech({
        message: 'Cannot process explicit words',
        subtext: 'NORA Safety Policy: Explicit or abusive words are blocked immediately.',
        type: 'explicit'
      });

      // Refusal gesture: Shake head 'no' without moving from safe park
      await this.shakeHeadNo();

      setTimeout(() => {
        this.stateListeners.forEach((cb) => cb('IDLE'));
      }, 3500);

      return;
    }

    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'web_console',
      message: `User instruction dispatched: "${text}"`
    });

    if (this.connected && this.ros) {
      await this.executeViaRosbridge(text);
    } else {
      await this.executeSimulated(text);
    }
  }

  private async executeViaRosbridge(text: string): Promise<void> {
    if (!this.ros) return;

    this.notifyPipeline({ stage: 'PARSING' });
    this.stateListeners.forEach((cb) => cb('PARSING'));

    const intentTopic = new ROSLIB.Topic({
      ros: this.ros,
      name: '/nora/intent_raw',
      messageType: 'std_msgs/msg/String'
    });
    intentTopic.publish({ data: text });

    const nluClient = new ROSLIB.Service({
      ros: this.ros,
      name: '/nora/extract_intent',
      serviceType: 'nora_interfaces/srv/ExtractIntent'
    });

    nluClient.callService(
      { raw_text: text },
      (res: any) => {
        if (res && res.intent) {
          const intent: Intent = {
            raw_text: text,
            action: res.intent.action,
            target_object: res.intent.target_object || null,
            target_location: res.intent.target_location || null,
            parameters: {},
            confidence: res.intent.confidence || 0.95
          };
          this.notifyPipeline({ stage: 'SCORING', intent });
          this.fetchAffordances(intent);
        } else {
          this.executeSimulated(text);
        }
      },
      () => {
        this.executeSimulated(text);
      }
    );
  }

  private fetchAffordances(intent: Intent): void {
    if (!this.ros) return;

    const affClient = new ROSLIB.Service({
      ros: this.ros,
      name: '/nora/score_affordances',
      serviceType: 'nora_interfaces/srv/ScoreAffordances'
    });

    affClient.callService(
      {
        intent: {
          raw_text: intent.raw_text,
          action: intent.action,
          target_object: intent.target_object || '',
          target_location: intent.target_location || '',
          parameters_json: JSON.stringify(intent.parameters),
          confidence: intent.confidence
        }
      },
      (res: any) => {
        if (res && res.scores) {
          const scores: AffordanceScore[] = res.scores.map((s: any) => ({
            skill_name: s.skill_name,
            usefulness: s.usefulness || 0.9,
            feasibility: s.feasibility || 0.95,
            combined_score: s.combined_score || 0.85
          }));
          scores.sort((a, b) => b.combined_score - a.combined_score);
          if (scores.length > 0) {
            this.publishAffordanceScore(intent, scores[0]);
          }
          this.notifyPipeline({ stage: 'PLANNING', intent, affordances: scores });
        } else {
          const localAffs = this.computeLocalAffordances(intent);
          if (localAffs.length > 0) {
            this.publishAffordanceScore(intent, localAffs[0]);
          }
          this.notifyPipeline({ stage: 'PLANNING', intent, affordances: localAffs });
        }
      },
      () => {
        const localAffs = this.computeLocalAffordances(intent);
        if (localAffs.length > 0) {
          this.publishAffordanceScore(intent, localAffs[0]);
        }
        this.notifyPipeline({ stage: 'PLANNING', intent, affordances: localAffs });
      }
    );
  }

  private publishAffordanceScore(intent: Intent, topAff: AffordanceScore): void {
    // 1. Publish to ROS 2 log terminal with high visibility
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'nora_affordance',
      message: `[ROS 2 Topic: /nora/task_affordance] Published affordance score: ${(topAff.combined_score * 100).toFixed(1)}% (${topAff.combined_score.toFixed(3)}) for "${intent.raw_text}" (Skill: ${topAff.skill_name}, Usefulness: ${topAff.usefulness.toFixed(2)}, Feasibility: ${topAff.feasibility.toFixed(2)}).`
    });

    // 2. Publish to live ROS 2 bridge graph topics
    if (this.ros && this.connected) {
      try {
        const affStringTopic = new ROSLIB.Topic({
          ros: this.ros,
          name: '/nora/task_affordance',
          messageType: 'std_msgs/msg/String'
        });
        affStringTopic.publish({
          data: JSON.stringify({
            task: intent.raw_text,
            action: intent.action,
            target_object: intent.target_object,
            winning_skill: topAff.skill_name,
            combined_score: topAff.combined_score,
            usefulness: topAff.usefulness,
            feasibility: topAff.feasibility,
            breakdown: topAff.breakdown,
            timestamp: new Date().toISOString()
          })
        });

        const affFloatTopic = new ROSLIB.Topic({
          ros: this.ros,
          name: '/nora/affordance_score',
          messageType: 'std_msgs/msg/Float32'
        });
        affFloatTopic.publish({ data: topAff.combined_score });
      } catch (err) {
        console.warn('Could not publish to ROS bridge:', err);
      }
    }
  }

  private async executeSimulated(text: string): Promise<void> {
    const execId = ++this.currentExecutionId;
    this.isCancelled = false;
    this.isExecuting = true;

    try {
      if (this.isEStopped) {
        this.emitLog({
          level: 30,
          levelName: 'WARN',
          nodeName: 'nora_safety',
          message: 'Safety Interlock Engaged: Cannot execute task while Emergency Stop is active. Reset E-Stop to resume operation.'
        });
        this.notifyPipeline({
          stage: 'FAILED',
          error: 'Safety Interlock Engaged: Emergency Stop is active. Click "Reset E-Stop" to re-enable arm motion.'
        });
        return;
      }

      // 1. NLU Parsing
      this.notifyPipeline({ stage: 'PARSING' });
      this.stateListeners.forEach((cb) => cb('PARSING'));
      await this.delay(200);
      if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;

      const intent = this.parseSimulatedIntent(text);
      if (intent.action === 'cancel_task') {
        await this.cancelTask();
        return;
      }
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'nora_nlu',
      message: `[NLU] Parsed intent: action='${intent.action}' target='${intent.target_object || 'none'}' loc='${intent.target_location || 'none'}' conf=${(intent.confidence * 100).toFixed(0)}%`
    });

    this.notifyPipeline({ stage: 'SCORING', intent });
    this.stateListeners.forEach((cb) => cb('SCORING'));

    // 2. Affordance Scoring
    await this.delay(350);
    if (this.isEStopped || this.isCancelled) return;
    const affordances = this.computeLocalAffordances(intent);
    const topAff = affordances[0];

    const isExplicit = intent.action === 'explicit_blocked';
    const isImpossible = intent.action === 'impossible' || Boolean(intent.parameters?.impossible_keyword);
    const isGuardrailTest = intent.action === 'guardrail_test';
    const isPhysical = isPhysicalTask(text) || isImpossible || isGuardrailTest;
    const targetObjName = intent.target_object;
    const targetObj = targetObjName
      ? (this.findObjectFromText(targetObjName) ||
         this.tabletopObjects.find((o) => o.id === targetObjName || o.name.toLowerCase() === targetObjName.toLowerCase()))
      : null;
    const isMissingObject =
      !isExplicit &&
      !isPhysical &&
      !targetObj &&
      Boolean(targetObjName) &&
      targetObjName !== 'none' &&
      targetObjName !== 'null' &&
      intent.action !== 'search_object';

    // SayCan Safety Guardrail: If confidence < 0.30 or skill usefulness < 0.20 or target out of reach / missing / impossible / guardrail_test
    if (
      !topAff ||
      topAff.combined_score < 0.30 ||
      isMissingObject ||
      intent.action === 'unknown' ||
      intent.action === 'impossible' ||
      intent.action === 'guardrail_test'
    ) {
      const fallbackAff: AffordanceScore = isMissingObject
        ? {
            skill_name: intent.action || 'deliver_to_user',
            usefulness: topAff ? topAff.usefulness : 0.0,
            feasibility: 0.0,
            combined_score: 0.0,
            breakdown: { reachability: 0.0, collision_free: 0.20, object_state: 0.0 }
          }
        : (topAff || {
            skill_name: 'deliver_to_user',
            usefulness: 0.0,
            feasibility: 0.0,
            combined_score: 0.0
          });
      this.publishAffordanceScore(intent, fallbackAff);

      const isReachViolation =
        !isExplicit &&
        !isPhysical &&
        Boolean(topAff?.breakdown?.reachability !== undefined && topAff.breakdown.reachability < 0.30) &&
        !isMissingObject;

      const friendlyTarget = intent.parameters?.target_name || intent.target_object || 'item';

      const guardrailType: GuardrailEvent['type'] = isExplicit
        ? 'explicit'
        : isPhysical
        ? 'impossible'
        : isMissingObject
        ? 'missing_object'
        : isReachViolation
        ? 'reachability'
        : 'ungrounded';

      const guardrailTitle = isExplicit
        ? 'Safety Interlock: Explicit Words Blocked'
        : isPhysical
        ? 'Physical Task Interlock'
        : isMissingObject
        ? 'Object Grounding Guardrail'
        : isReachViolation
        ? 'Kinematic Reachability Limit'
        : 'SayCan Affordance Guardrail Block';

      const guardrailReason = isExplicit
        ? 'Cannot process explicit words.'
        : isPhysical
        ? (intent.parameters?.reason || `Physical task "${intent.parameters?.impossible_keyword || text}" cannot be executed. NORA is a 6-DOF tabletop robotic manipulator designed for picking, placing, and passing objects.`)
        : isMissingObject
        ? `SayCan Perception Guardrail: "${friendlyTarget}" is not present on the tabletop. Please click "+ Add Object" to place one in the workspace.`
        : isReachViolation
        ? `SayCan Reachability Guardrail: Target "${friendlyTarget}" is positioned too far from the table-mounted arm base (> 0.64m limit). Drag it closer to enable manipulation.`
        : `SayCan Guardrail Triggered: The utterance "${text}" does not correspond to an actionable physical skill. All candidate skills scored below the threshold (0.30). The arm safely remains in idle pose.`;

      const gEvent: GuardrailEvent = {
        active: true,
        type: guardrailType,
        title: guardrailTitle,
        reason: guardrailReason,
        score: topAff ? topAff.combined_score : 0.0,
        threshold: 0.30,
        timestamp: Date.now()
      };

      this.emitGuardrail(gEvent);

      const rejectLogMsg = isExplicit
        ? `🛡️ [Safety Interlock] User command "${text}" rejected: Cannot process explicit words.`
        : isPhysical
        ? `🚫 [Action Not Possible] User command "${text}" rejected: ${guardrailReason}`
        : isMissingObject
        ? `[SayCan Object Grounding] Instruction "${text}" rejected: Required object "${friendlyTarget}" is not present on tabletop. Preconditions failed (object_state=0.00).`
        : isReachViolation
        ? `[SayCan Reachability Guardrail] Target "${friendlyTarget}" is outside table-mounted arm physical reach envelope (> 0.64m from base). Motion aborted for safety.`
        : `[SayCan Guardrail] Instruction "${text}" rejected: No physically grounded skill scored above threshold (max_score=${topAff ? topAff.combined_score.toFixed(3) : '0.000'} < 0.30).`;

      this.emitLog({
        level: isExplicit ? 40 : 30,
        levelName: isExplicit ? 'ERROR' : 'WARN',
        nodeName: isExplicit ? 'nora_safety' : 'saycan_guardrail',
        message: rejectLogMsg
      });

      this.emitLog({
        level: 40,
        levelName: 'ERROR',
        nodeName: 'nora_orchestrator',
        message: `Task aborted by SayCan guardrail: Preconditions not met. Arm parked at home pose.`
      });

      if (isExplicit || isPhysical || isImpossible || isGuardrailTest) {
        const speechMsg = isExplicit
          ? 'Cannot process explicit words'
          : isGuardrailTest
          ? `Guardrail block engaged. All candidate skills scored below threshold.`
          : `Not possible! I cannot ${intent.parameters?.impossible_keyword || text}.`;

        this.emitArmSpeech({
          message: speechMsg,
          subtext: guardrailReason,
          type: isExplicit ? 'explicit' : 'impossible'
        });
      }

      this.notifyPipeline({
        stage: 'FAILED',
        intent,
        affordances,
        error: guardrailReason,
        guardrailEvent: gEvent
      });
      this.stateListeners.forEach((cb) => cb('FAILED'));

      // Perform expressive "shake head no" refusal gesture with the robot arm
      await this.shakeHeadNo();

      setTimeout(() => {
        this.stateListeners.forEach((cb) => cb('IDLE'));
      }, 5000);
      return;
    }

    // Affordance passed threshold -> publish to top & ROS topic
    this.publishAffordanceScore(intent, topAff);

    this.notifyPipeline({ stage: 'PLANNING', intent, affordances });
    this.stateListeners.forEach((cb) => cb('PLANNING'));

    // 3. Plan Generation
    await this.delay(400);
    if (this.isEStopped || this.isCancelled) return;
    const plan = this.generatePlanSteps(intent);
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'nora_orchestrator',
      message: `[Planner] Generated ${plan.length}-step plan: [${plan.map((p) => p.skill).join(' -> ')}]`
    });

    this.notifyPipeline({ stage: 'EXECUTING', intent, affordances, plan, activeStepId: plan[0]?.id });
    this.stateListeners.forEach((cb) => cb('EXECUTING'));

    // 4. Sequential Execution Animation
    for (let i = 0; i < plan.length; i++) {
      if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) {
        return;
      }

      const step = plan[i];
      step.status = 'running';
      this.notifyPipeline({
        stage: 'EXECUTING',
        intent,
        affordances,
        plan: [...plan],
        activeStepId: step.id
      });

      this.emitLog({
        level: 20,
        levelName: 'INFO',
        nodeName: 'moveit_ompl',
        message: `[OMPL RRTConnect] Planning collision-free trajectory for step ${i + 1}/${plan.length}: ${step.skill}`
      });

      if (step.skill === 'search_object') {
        const rawLower = (intent.raw_text || '').toLowerCase();
        const stepTarget = step.targetObject || intent.target_object || '';
        const stepTargetLower = stepTarget.toLowerCase();

        // Check if user queried a common category term (food, drink, stationery, game, toy, tool, etc.)
        let matchedCategoryKey: string | null = null;
        for (const catKey of Object.keys(CATEGORY_SEARCH_MAP)) {
          const regex = new RegExp(`\\b${catKey}s?\\b`, 'i');
          if (regex.test(rawLower) || regex.test(stepTargetLower)) {
            matchedCategoryKey = catKey;
            break;
          }
        }

        const catInfo = matchedCategoryKey ? CATEGORY_SEARCH_MAP[matchedCategoryKey] : null;

        if (catInfo) {
          // Say "Searching food" then search candidate item (e.g. Red Apple)
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_perception',
            message: `[Active Vision Search] Initiated visual search for [${catInfo.category}] across tabletop workspace.`
          });
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_perception',
            message: `[Category Grounding] Query "${catInfo.category}" maps to candidate item [${catInfo.defaultName}]. Scanning tabletop...`
          });
          this.emitArmSpeech({
            message: `Searching ${catInfo.category}... searching for ${catInfo.defaultName}`,
            subtext: `Category grounding: [${catInfo.category}] -> [${catInfo.defaultName}]`,
            type: 'info'
          });

          // Check if any candidate from this category is currently present on the table
          const found = this.tabletopObjects.find((o) => {
            const oId = o.id.toLowerCase();
            const oName = o.name.toLowerCase();
            return catInfo.candidateIds.some(
              (c) => oId === c || oId.includes(c) || oName.includes(c) || o.shape === c
            );
          });

          this.emitPerceptionScan({ active: true, targetObject: catInfo.defaultId });
          await this.simulateJointMotion(step, intent, execId);
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
          await this.delay(450);
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;

          if (!found) {
            this.emitPerceptionScan({ active: false, targetObject: catInfo.defaultId });
            this.emitLog({
              level: 30,
              levelName: 'WARN',
              nodeName: 'nora_perception',
              message: `[RGB-D Vision Scan] Search completed: "${catInfo.category}" (candidate: ${catInfo.defaultName}) was NOT detected anywhere across tabletop workspace.`
            });
            this.emitLog({
              level: 40,
              levelName: 'ERROR',
              nodeName: 'nora_orchestrator',
              message: `Task aborted: Cannot pick or deliver "${catInfo.category}" because no matching item is present on the table.`
            });

            const gEvent: GuardrailEvent = {
              active: true,
              type: 'missing_object',
              title: 'Object Grounding Guardrail',
              reason: `SayCan Perception Guardrail: "${catInfo.defaultName}" (matching category "${catInfo.category}") is not present on the tabletop. Please click "+ Place ${catInfo.defaultName} on Tabletop" to place one in the workspace.`,
              score: 0.15,
              threshold: 0.30,
              targetObject: catInfo.defaultId,
              timestamp: Date.now()
            };

            this.emitGuardrail(gEvent);
            this.notifyPipeline({
              stage: 'FAILED',
              intent,
              affordances,
              guardrailEvent: gEvent,
              error: `Visual search failed: "${catInfo.defaultName}" (matching category "${catInfo.category}") was not found on the table. Click "Place ${catInfo.defaultName} on Tabletop" to place one in the workspace.`
            });
            this.stateListeners.forEach((cb) => cb('FAILED'));
            setTimeout(() => {
              this.stateListeners.forEach((cb) => cb('IDLE'));
              this.returnHome();
            }, 3500);
            return;
          }

          // Found category item on table! Acquire it and retarget remaining plan steps
          const pos = found.position;
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_perception',
            message: `[YOLO-World] Target acquired! Found ${found.name} (category: ${catInfo.category}) at coordinates (X: ${pos.x.toFixed(2)}m, Y: ${pos.y.toFixed(2)}m, Z: ${pos.z.toFixed(2)}m) with 99.2% confidence.`
          });
          this.emitPerceptionScan({ active: false, targetObject: found.id, detectedPosition: pos, confidence: 0.992 });

          // Update subsequent steps so they pick/deliver the detected item
          for (let j = i + 1; j < plan.length; j++) {
            if (plan[j].targetObject) {
              plan[j].targetObject = found.id;
            }
          }
        } else {
          // Direct item search
          const obj = this.normalizeObjectName(step.targetObject || intent.target_object);
          const found = this.tabletopObjects.find(
            (o) =>
              o.id === obj ||
              o.id === step.targetObject ||
              o.name.toLowerCase() === (step.targetObject || '').toLowerCase()
          );
          const friendlyTarget = intent.parameters?.target_name || step.targetObject || 'target';

          if (!found) {
            // Object not present on table: perform scan and report missing cleanly without inventing objects
            this.emitPerceptionScan({ active: true, targetObject: obj || step.targetObject });
            this.emitLog({
              level: 20,
              levelName: 'INFO',
              nodeName: 'nora_perception',
              message: `[Active Vision Search] Initiated visual search for [${friendlyTarget}] across tabletop workspace.`
            });
            await this.simulateJointMotion(step, intent, execId);
            if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
            await this.delay(450);
            this.emitPerceptionScan({ active: false, targetObject: obj || step.targetObject });
            this.emitLog({
              level: 30,
              levelName: 'WARN',
              nodeName: 'nora_perception',
              message: `[RGB-D Vision Scan] Search completed: "${friendlyTarget}" was NOT detected anywhere across tabletop workspace.`
            });
            this.emitLog({
              level: 40,
              levelName: 'ERROR',
              nodeName: 'nora_orchestrator',
              message: `Task aborted: Cannot pick or deliver "${friendlyTarget}" because it is not present on the table.`
            });

            const gEvent: GuardrailEvent = {
              active: true,
              type: 'missing_object',
              title: 'Object Grounding Guardrail',
              reason: `SayCan Perception Guardrail: "${friendlyTarget}" is not present on the tabletop. Please click "+ Add Object" to place one in the workspace.`,
              score: 0.15,
              threshold: 0.30,
              targetObject: obj || step.targetObject,
              timestamp: Date.now()
            };

            this.emitGuardrail(gEvent);
            this.notifyPipeline({
              stage: 'FAILED',
              intent,
              affordances,
              guardrailEvent: gEvent,
              error: `Visual search failed: "${friendlyTarget}" was not found on the table. Click "Add Object" to place one in the workspace.`
            });
            this.stateListeners.forEach((cb) => cb('FAILED'));
            setTimeout(() => {
              this.stateListeners.forEach((cb) => cb('IDLE'));
              this.returnHome();
            }, 3500);
            return;
          }

          const pos = found.position;
          this.emitPerceptionScan({ active: true, targetObject: obj });
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_perception',
            message: `[Active Vision Search] Initiated visual search for [${found.name}] across tabletop workspace.`
          });
          await this.simulateJointMotion(step, intent, execId);
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
          await this.delay(450);
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_perception',
            message: `[YOLO-World] Target acquired! [${found.name}] detected at coordinates (X: ${pos.x.toFixed(2)}m, Y: ${pos.y.toFixed(2)}m, Z: ${pos.z.toFixed(2)}m) with 99.2% confidence.`
          });
          this.emitPerceptionScan({ active: false, targetObject: obj, detectedPosition: pos, confidence: 0.992 });
        }
      } else if (step.skill === 'scatter_objects') {
        this.randomizeObjects();
        await this.delay(350);
      } else if (step.skill === 'reset_table') {
        this.resetObjects();
        await this.delay(350);
      } else if (step.skill === 'delete_all_objects') {
        this.clearAllObjects();
        this.emitLog({
          level: 20,
          levelName: 'INFO',
          nodeName: 'tabletop_env',
          message: '🗑️ Cleared all physical objects (including default items) from tabletop workspace.'
        });
        await this.delay(300);
      } else if (step.skill === 'delete_object') {
        const objId = step.params?.object_id;
        if (objId) {
          this.removeObject(objId);
        }
        await this.delay(200);
      } else {
        await this.simulateJointMotion(step, intent, execId);
      }

      if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) {
        step.status = 'failed';
        return;
      }

      // Track item attachment on end-effector and release
      if (step.skill === 'pick') {
        const obj = this.normalizeObjectName(step.targetObject || intent.target_object);
        if (obj) {
          const found = this.tabletopObjects.find((o) => o.id === obj);
          if (found) found.state = 'held';
          this.emitObjectEvent({ name: obj, state: 'held' });
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_gripper',
            message: `Grasp confirmed: [${obj}] securely attached between gripper finger pads.`
          });
        }
      } else if (step.skill === 'open_gripper') {
        const heldObj = this.tabletopObjects.find((o) => o.state === 'held') ||
          (step.targetObject ? this.tabletopObjects.find((o) => o.id === this.normalizeObjectName(step.targetObject)) : null);
        if (heldObj && heldObj.state === 'held') {
          const isUser = intent.action === 'deliver_to_user' || step.params?.target === 'user' || intent.target_location === 'user';
          const dest = isUser ? 'user' : 'table';
          const finalPos = isUser
            ? { x: this.handoverPos.x, y: 0.45 + 0.035, z: this.handoverPos.z }
            : { ...heldObj.position, y: 0.45 + 0.035 };
          heldObj.state = dest;
          heldObj.position = finalPos;
          this.objectPositions[heldObj.id] = finalPos;
          this.emitObjectEvent({ name: heldObj.id, state: dest, position: finalPos });
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_gripper',
            message: `Gripper opened: Successfully passed [${heldObj.name}] to operator at table edge.`
          });
        }
      } else if (step.skill === 'place') {
        const obj = this.normalizeObjectName(step.targetObject || intent.target_object);
        if (obj) {
          const targetLoc = step.params?.target_location || intent.target_location;
          const dest = targetLoc === 'user' ? 'user' : targetLoc === 'table' ? 'table' : 'tray';
          const found = this.tabletopObjects.find((o) => o.id === obj);
          if (found) found.state = dest;
          this.emitObjectEvent({ name: obj, state: dest });
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_gripper',
            message: `Deposit confirmed: [${obj}] successfully placed in [${dest}].`
          });
        }
      }

      step.status = 'completed';
      this.emitLog({
        level: 20,
        levelName: 'INFO',
        nodeName: 'nora_skills',
        message: `[Skill] Step ${i + 1} (${step.skill}) completed successfully.`
      });
    }

    if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;

    // Finished
    await this.delay(350);
    if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
    this.notifyPipeline({ stage: 'DONE', intent, affordances, plan });
    this.stateListeners.forEach((cb) => cb('DONE'));
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'nora_orchestrator',
      message: `Task execution finished successfully. All skill goals reached.`
    });

    setTimeout(() => {
      this.stateListeners.forEach((cb) => cb('IDLE'));
    }, 3000);
    } finally {
      if (this.currentExecutionId === execId) {
        this.isExecuting = false;
      }
    }
  }

  private parseSimulatedIntent(text: string): Intent {
    const lower = text.toLowerCase().trim();

    // Safety Interlock: Immediate Explicit Language Filter
    if (containsExplicitWords(text)) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'explicit_blocked',
        target_object: null,
        target_location: null,
        parameters: {
          reason: 'Cannot process explicit words.',
          error: 'Cannot process explicit words.',
          is_explicit: true
        },
        confidence: 0.0
      };
    }

    // Guardrail Demonstration Commands (e.g. "use the guardrail block", "guardrail block", "test guardrail")
    if (
      lower === 'use the guardrail block' ||
      lower === 'use guardrail block' ||
      lower === 'use the guardtrail block' ||
      lower === 'use guardtrail block' ||
      lower === 'guardrail block' ||
      lower === 'guardrail' ||
      lower === 'guardtrail' ||
      lower === 'guardtrail block' ||
      lower === 'test guardrail' ||
      lower === 'test guardrail block' ||
      lower === 'i am mored' ||
      lower.includes('guardrail block') ||
      lower.includes('guardtrail block')
    ) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'guardrail_test',
        target_object: null,
        target_location: null,
        parameters: {
          reason: 'Demonstration of SayCan safety guardrail: ungrounded instruction with no physical affordance is blocked to protect robotic hardware.'
        },
        confidence: 0.12
      };
    }

    // 0. Explicit Infeasible / Impossible Verbs Filter (e.g. "dance for me", "sing", "fly", "jump")
    const matchedImpossible = IMPOSSIBLE_OR_UNSUPPORTED_KEYWORDS.find((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      return regex.test(lower);
    });

    if (matchedImpossible) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'impossible',
        target_object: null,
        target_location: null,
        parameters: {
          impossible_keyword: matchedImpossible,
          reason: `Task "${matchedImpossible}" is not possible. NORA is a 6-DOF tabletop robotic manipulator designed exclusively for physical manipulation (picking, placing, and passing objects).`
        },
        confidence: 0.05
      };
    }

    // 1. Exact or partial match with seed commands
    const seed = SEED_COMMANDS.find(
      (s) => s.instruction.toLowerCase() === lower || lower.includes(s.instruction.toLowerCase())
    );
    if (seed) {
      return {
        ...seed.intent,
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text
      };
    }

    // 2. Dynamic Loop Detection for ANY repetitive or multi-object command
    const loop = this.detectLoopIntent(text);
    if (loop) {
      if (loop.targets.length === 0) {
        const missingTarget = (loop as any).missingConcept || 'objects';
        return {
          version: '1.0',
          command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
          raw_text: text,
          action: 'loop_task',
          target_object: missingTarget,
          target_location: loop.destination,
          parameters: {
            is_loop: true,
            loop_targets: [],
            loop_count: 0,
            source: loop.source,
            destination: loop.destination,
            missing_target: missingTarget
          },
          confidence: 0.95
        };
      }
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: loop.actionName,
        target_object: loop.targets.join(', '),
        target_location: loop.destination,
        parameters: {
          is_loop: true,
          loop_targets: loop.targets,
          loop_count: loop.count,
          source: loop.source,
          destination: loop.destination,
          sub_action: 'pick_and_place'
        },
        confidence: 0.98
      };
    }

    // 3. Delete / Clear Objects Commands
    if (
      (lower.includes('delete') && (lower.includes('all') || lower.includes('object') || lower.includes('default') || lower.includes('item') || lower.includes('present'))) ||
      (lower.includes('remove') && (lower.includes('all') || lower.includes('object') || lower.includes('default') || lower.includes('item'))) ||
      (lower.includes('clear') && (lower.includes('all') || lower.includes('object') || lower.includes('tabletop') || lower.includes('workspace'))) ||
      lower === 'delete all' ||
      lower === 'clear all' ||
      lower === 'clear table' ||
      lower.startsWith('delete ') ||
      lower.startsWith('remove ')
    ) {
      const isAll =
        lower.includes('all') ||
        lower.includes('everything') ||
        lower.includes('default') ||
        lower.includes('entire') ||
        lower.includes('present') ||
        !this.findObjectFromText(text);

      if (isAll) {
        return {
          version: '1.0',
          command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
          raw_text: text,
          action: 'delete_all_objects',
          target_object: 'all_objects',
          target_location: null,
          parameters: { delete_defaults: true },
          confidence: 1.0
        };
      } else {
        const targetObj = this.findObjectFromText(text);
        if (targetObj) {
          return {
            version: '1.0',
            command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
            raw_text: text,
            action: 'delete_object',
            target_object: targetObj.id,
            target_location: null,
            parameters: { object_id: targetObj.id, object_name: targetObj.name },
            confidence: 1.0
          };
        }
      }
    }

    // 4. Reset table items
    if (lower.includes('reset items') || lower.includes('reset objects') || lower.includes('reset table')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'reset_table',
        target_object: null,
        target_location: null,
        parameters: {},
        confidence: 1.0
      };
    }
    if (lower.includes('scatter') || lower.includes('randomize') || lower.includes('scramble')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'scatter_objects',
        target_object: null,
        target_location: null,
        parameters: {},
        confidence: 1.0
      };
    }

    // 5. Explicit Actuator / Pose Commands
    if (lower.includes('home') || lower.includes('park') || lower.includes('return to home')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'go_home',
        target_object: null,
        target_location: null,
        parameters: {},
        confidence: 1.0
      };
    }
    if (lower.includes('open') && lower.includes('gripper')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'open_gripper',
        target_object: null,
        target_location: null,
        parameters: {},
        confidence: 1.0
      };
    }
    if (lower.includes('close') || lower.includes('grip')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'close_gripper',
        target_object: null,
        target_location: null,
        parameters: {},
        confidence: 1.0
      };
    }

    const isDirectSearch =
      lower.startsWith('search') ||
      lower.startsWith('find') ||
      lower.startsWith('where is') ||
      lower.startsWith('scan for') ||
      lower.startsWith('locate') ||
      lower.startsWith('detect') ||
      lower.includes('search for') ||
      lower.includes('find the') ||
      lower.includes('scan the');

    if (isDirectSearch) {
      const targetObj = this.findObjectFromText(text);
      const concept = this.getConceptForText(text);
      const normalized = this.normalizeObjectName(text);
      const targetName = targetObj
        ? targetObj.name
        : (concept ? concept.defaultName : (normalized ? normalized.replace(/_/g, ' ') : 'item'));
      const objId = targetObj
        ? targetObj.id
        : (concept ? (concept.id === 'tennis' ? 'tennis_ball' : concept.id === 'coffee' ? 'coffee_mug' : concept.id) : (normalized || targetName));
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'search_object',
        target_object: objId,
        target_location: null,
        parameters: { target_name: targetName },
        confidence: 0.98
      };
    }

    const isDirectPick =
      lower.startsWith('pick') ||
      lower.startsWith('grab') ||
      lower.startsWith('take') ||
      lower.startsWith('lift') ||
      lower.startsWith('hold');

    if (isDirectPick && !lower.includes(' me') && !lower.includes('to me') && !lower.includes('give') && !lower.includes('pass') && !lower.includes('hand')) {
      const targetObj = this.findObjectFromText(text);
      const concept = this.getConceptForText(text);
      const normalized = this.normalizeObjectName(text);
      const targetName = targetObj
        ? targetObj.name
        : (concept ? concept.defaultName : (normalized ? normalized.replace(/_/g, ' ') : 'item'));
      const objId = targetObj
        ? targetObj.id
        : (concept ? (concept.id === 'tennis' ? 'tennis_ball' : concept.id === 'coffee' ? 'coffee_mug' : concept.id) : (normalized || targetName));
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'pick',
        target_object: objId,
        target_location: 'table',
        parameters: { target_name: targetName },
        confidence: 0.96
      };
    }

    const isDirectPlace =
      lower.includes('place') ||
      lower.includes('put') ||
      lower.includes('deposit') ||
      lower.includes('set down') ||
      lower.includes('drop') ||
      lower.includes('store');

    if (isDirectPlace) {
      const dest = lower.includes('table') ? 'table' : lower.includes('user') ? 'user' : 'tray';
      const targetObj = this.findObjectFromText(text);
      const concept = this.getConceptForText(text);
      const normalized = this.normalizeObjectName(text);
      const targetName = targetObj
        ? targetObj.name
        : (concept ? concept.defaultName : (normalized ? normalized.replace(/_/g, ' ') : 'object'));
      const objId = targetObj
        ? targetObj.id
        : (concept ? (concept.id === 'tennis' ? 'tennis_ball' : concept.id === 'coffee' ? 'coffee_mug' : concept.id) : (normalized || targetName));
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'place',
        target_object: objId,
        target_location: dest,
        parameters: { target_name: targetName },
        confidence: 0.96
      };
    }

    // 5. Natural Language Commonsense Activity & Desire Grounding
    const hasConceptMatch = SEMANTIC_ACTIVITY_ONTOLOGY.some((c) =>
      c.keywords.some((kw) => lower.includes(kw))
    );

    const isExplicitDesire =
      lower.includes('want') ||
      lower.includes('need') ||
      lower.includes('thirsty') ||
      lower.includes('hungry') ||
      lower.includes('tired') ||
      lower.includes('sleepy') ||
      lower.includes('play') ||
      lower.includes('let\'s play') ||
      lower.includes('care for');

    const isDesireOrHandover =
      hasConceptMatch ||
      isExplicitDesire ||
      lower.includes('bring') ||
      lower.includes('give me') ||
      lower.includes('give') ||
      lower.includes('hand me') ||
      lower.includes('hand') ||
      lower.includes('pass me') ||
      lower.includes('pass') ||
      lower.includes('fetch') ||
      lower.includes('get me') ||
      lower.includes('serve me');

    if (isDesireOrHandover) {
      const targetObj = this.findObjectFromText(text);
      const concept = this.getConceptForText(text);
      const normalized = this.normalizeObjectName(text);

      if (!targetObj && !concept && !normalized) {
        // No physical object or known activity concept was found! Do NOT guess or default!
        return {
          version: '1.0',
          command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
          raw_text: text,
          action: 'impossible',
          target_object: null,
          target_location: null,
          parameters: {
            reason: `No physical tabletop item or actionable manipulation skill identified in "${text}".`
          },
          confidence: 0.05
        };
      }

      const targetName = targetObj
        ? targetObj.name
        : (concept ? concept.defaultName : (normalized ? normalized.replace(/_/g, ' ') : 'item'));
      const objId = targetObj
        ? targetObj.id
        : (concept ? (concept.id === 'tennis' ? 'tennis_ball' : concept.id === 'coffee' ? 'coffee_mug' : concept.id) : (normalized || targetName));

      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'deliver_to_user',
        target_object: objId,
        target_location: 'user',
        parameters: {
          target_name: targetName,
          activity_context: text
        },
        confidence: 0.985
      };
    }

    // 6. Non-robotic or unsupported query fallback -> mark as impossible!
    return {
      version: '1.0',
      command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
      raw_text: text,
      action: 'impossible',
      target_object: null,
      target_location: null,
      parameters: {
        impossible_keyword: text,
        reason: `Command "${text}" is not a supported physical tabletop manipulation task. I can pick, place, search, sort, and pass objects.`
      },
      confidence: 0.05
    };
  }

  public detectLoopIntent(text: string): {
    isLoop: boolean;
    targets: string[];
    count: number;
    source: 'table' | 'tray';
    destination: 'tray' | 'table' | 'user';
    actionName: string;
  } | null {
    const lower = text.toLowerCase().trim();

    // 1. Loop trigger indicators
    const isClean =
      lower.includes('clean table') ||
      lower.includes('clean up the table') ||
      lower.includes('clear table') ||
      lower.includes('clear the table') ||
      lower.includes('clear workspace') ||
      lower.includes('tidy table') ||
      lower.includes('empty table') ||
      lower.includes('clean up');

    const isRerack =
      lower.includes('re rack') ||
      lower.includes('rerack') ||
      lower.includes('re-rack') ||
      lower.includes('rack table') ||
      lower.includes('rack objects') ||
      lower.includes('rack items') ||
      lower.includes('put back all') ||
      lower.includes('return objects to table') ||
      lower.includes('return items to table');

    const hasLoopKeyword =
      lower.includes('loop') ||
      lower.includes('repeat') ||
      lower.includes('again') ||
      lower.includes('iterate') ||
      lower.includes('continuously') ||
      lower.includes('batch');

    const hasQuantifier = /\b(all|every|each|both|everything)\b/i.test(lower);
    const hasAllGeneral = /\b(all\s+(?:objects|items|things|blocks|pieces)|everything|the\s+entire\s+table)\b/i.test(lower);

    // 2. Count extraction (e.g. "3 times", "twice", "repeat 2 times")
    let count: number | null = null;
    const countMatch = lower.match(/(?:repeat|run|do\s+this|loop|pick\s+and\s+place)?\s*(\d+)\s*(?:times|x|iterations)/i);
    if (countMatch) {
      count = parseInt(countMatch[1], 10);
    } else if (lower.includes('twice') || lower.includes('2 times') || lower.includes('two times')) {
      count = 2;
    } else if (lower.includes('thrice') || lower.includes('3 times') || lower.includes('three times')) {
      count = 3;
    } else if (lower.includes('4 times') || lower.includes('four times')) {
      count = 4;
    } else if (/\bboth\b/i.test(lower)) {
      count = 2;
    }

    // 3. Multi-object detection against dynamic tabletop objects with semantic filtering & stemming
    const getStem = (w: string) => {
      if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
      if (w.endsWith('es') && (w.endsWith('shes') || w.endsWith('ches') || w.endsWith('sses') || w.endsWith('xes') || w.endsWith('zes') || w.endsWith('boxes') || w.endsWith('glasses'))) return w.slice(0, -2);
      if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
      return w;
    };

    const words = lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const loopStopWords = new Set([
      'the', 'and', 'for', 'want', 'need', 'give', 'bring', 'hand', 'pass', 'fetch',
      'pick', 'grab', 'take', 'place', 'put', 'drop', 'look', 'find', 'search',
      'table', 'tray', 'user', 'here', 'there', 'please', 'with', 'from', 'into', 'some',
      'like', 'thing', 'things', 'play', 'right', 'this', 'just', 'also', 'that', 'should',
      'hello', 'hey', 'could', 'would', 'will', 'all', 'every', 'each', 'both', 'times',
      'loop', 'repeat', 'again', 'iterate', 'objects', 'items', 'stuff', 'pieces', 'blocks'
    ]);

    const targetKeywords = new Set<string>();
    for (const w of words) {
      if (!loopStopWords.has(w)) {
        targetKeywords.add(w);
        const st = getStem(w);
        if (st.length >= 3 && !loopStopWords.has(st)) {
          targetKeywords.add(st);
        }
      }
    }

    const hasSpecificObjectFilter = targetKeywords.size > 0;
    const extractedTargets: string[] = [];

    if (hasSpecificObjectFilter) {
      // Filter existing tabletop objects matching ANY of the target keywords (by name, shape, id)
      for (const obj of this.tabletopObjects) {
        const nameTokens = obj.name.toLowerCase().split(/[^a-z0-9]+/);
        const idTokens = obj.id.toLowerCase().split(/[^a-z0-9]+/);
        const shapeL = obj.shape.toLowerCase();

        let matched = false;
        for (const kw of targetKeywords) {
          if (
            nameTokens.includes(kw) ||
            idTokens.includes(kw) ||
            shapeL === kw ||
            obj.name.toLowerCase().includes(kw) ||
            obj.id.toLowerCase().includes(kw)
          ) {
            matched = true;
            break;
          }
        }

        if (matched && !extractedTargets.includes(obj.id)) {
          extractedTargets.push(obj.id);
        }
      }
    } else {
      // No specific object name was given (e.g. "clean table", "clear all", "rerack all items")
      for (const obj of this.tabletopObjects) {
        const nameL = obj.name.toLowerCase();
        const idL = obj.id.toLowerCase();
        if (lower.includes(nameL) || lower.includes(idL)) {
          if (!extractedTargets.includes(obj.id)) {
            extractedTargets.push(obj.id);
          }
        }
      }
    }

    // Explicit Guard: If only a single target is found and no explicit loop, clean, rerack, repeat, or quantifier is stated, DO NOT LOOP!
    if (extractedTargets.length === 1 && !isClean && !isRerack && count === null && !hasLoopKeyword && !hasAllGeneral && !hasQuantifier) {
      return null;
    }

    const hasMultipleObjects = extractedTargets.length >= 2;

    // Check if this command requires a loop
    const requiresLoop =
      isClean ||
      isRerack ||
      hasLoopKeyword ||
      hasAllGeneral ||
      hasQuantifier ||
      count !== null ||
      hasMultipleObjects;

    if (!requiresLoop) {
      return null;
    }

    // Determine targets
    let finalTargets: string[] = [];
    if (hasSpecificObjectFilter) {
      finalTargets = extractedTargets;
      if (finalTargets.length === 0) {
        // Specific item requested (e.g. "apples"), but 0 exist on the tabletop!
        // Do NOT pick random objects or defaults. Flag missing concept for SayCan guardrail.
        const missing = Array.from(targetKeywords)[0] || 'requested objects';
        return {
          isLoop: true,
          targets: [],
          count: 0,
          source: 'table',
          destination: 'tray',
          actionName: 'loop_task',
          missingConcept: missing
        } as any;
      }
    } else if (isClean || isRerack || hasAllGeneral) {
      finalTargets = this.tabletopObjects.map((o) => o.id);
    } else {
      finalTargets = extractedTargets;
    }

    // Determine count
    const finalCount = count !== null ? Math.max(1, count) : finalTargets.length;

    // Determine source and destination
    let source: 'table' | 'tray' = 'table';
    let destination: 'tray' | 'table' | 'user' = 'tray';

    if (
      isRerack ||
      lower.includes('from tray') ||
      lower.includes('from storage') ||
      lower.includes('to table') ||
      lower.includes('onto table')
    ) {
      source = 'tray';
      destination = 'table';
    } else if (
      lower.includes('user') ||
      lower.includes('give me') ||
      lower.includes('hand me') ||
      lower.includes('bring me')
    ) {
      source = 'table';
      destination = 'user';
    } else {
      source = 'table';
      destination = 'tray';
    }

    const actionName = isRerack ? 'rerack_table' : isClean ? 'clean_table' : 'loop_task';

    return {
      isLoop: true,
      targets: finalTargets,
      count: finalCount,
      source,
      destination,
      actionName
    };
  }

  private computeLocalAffordances(intent: Intent): AffordanceScore[] {
    const candidateSkills = [
      'deliver_to_user',
      'search_object',
      'pick',
      'place',
      'move_to_pose',
      'open_gripper',
      'close_gripper',
      'go_home'
    ];

    if (intent.action === 'unknown' || intent.action === 'impossible' || intent.action === 'guardrail_test' || intent.action === 'explicit_blocked') {
      return candidateSkills
        .map((skill) => {
          return {
            skill_name: skill,
            usefulness: 0.0,
            feasibility: 0.0,
            combined_score: 0.0,
            breakdown: { reachability: 0.0, collision_free: 0.0, object_state: 0.0 }
          };
        })
        .sort((a, b) => b.combined_score - a.combined_score);
    }

    const isHoldingObject = this.tabletopObjects.some((o) => o.state === 'held');

    const isLoopAction =
      Boolean(intent.parameters?.is_loop) ||
      ['clean_table', 'rerack_table', 'loop_task'].includes(intent.action);

    // Dynamic Kinematic Reachability & Tabletop Presence Grounding
    let targetDistFromBase: number | null = null;
    let targetExistsOnTable = false;
    const targetObjName = intent.target_object;
    if (targetObjName && targetObjName !== 'null' && targetObjName !== 'none') {
      let foundObj =
        this.findObjectFromText(targetObjName) ||
        this.tabletopObjects.find(
          (o) =>
            o.id.toLowerCase() === targetObjName.toLowerCase() ||
            o.name.toLowerCase() === targetObjName.toLowerCase()
        );

      if (!foundObj) {
        const cat = CATEGORY_SEARCH_MAP[targetObjName.toLowerCase()];
        if (cat) {
          foundObj = this.tabletopObjects.find((o) => {
            const oId = o.id.toLowerCase();
            const oName = o.name.toLowerCase();
            return cat.candidateIds.some((c) => oId === c || oId.includes(c) || oName.includes(c) || o.shape === c);
          });
        }
      }

      if (foundObj) {
        targetExistsOnTable = true;
        targetDistFromBase = Math.hypot(foundObj.position.x - this.robotBasePos.x, foundObj.position.z - this.robotBasePos.z);
      }
    }
    const isTargetOutOfReach = targetDistFromBase !== null && targetDistFromBase > 0.64;
    const isTargetMissing = Boolean(targetObjName && targetObjName !== 'none' && !targetExistsOnTable);

    const results: AffordanceScore[] = candidateSkills.map((skill) => {
      let usefulness = 0.15;
      let reachability = 0.94;
      let collision_free = 0.96;
      let object_state = 0.98;

      // Kinematic distance & physical existence grounding
      if (isTargetMissing) {
        if (['pick', 'deliver_to_user', 'place', 'move_to_pose'].includes(skill)) {
          // Precondition failure: object is not on tabletop!
          reachability = 0.0;
          collision_free = 0.20;
          object_state = 0.0;
        } else if (skill === 'search_object') {
          if (intent.action === 'search_object') {
            // Visual search is feasible when user explicitly requested visual search
            reachability = 0.95;
            collision_free = 0.98;
            object_state = 0.85;
          } else {
            // Requested manipulation/delivery of missing object: preconditions fail! Take nothing!
            reachability = 0.0;
            collision_free = 0.20;
            object_state = 0.0;
          }
        }
      } else if (targetDistFromBase !== null) {
        if (isTargetOutOfReach) {
          if (['pick', 'deliver_to_user', 'place', 'move_to_pose'].includes(skill)) {
            // Target is beyond 0.64m physical arm envelope: drop reachability to trigger SayCan guardrail
            reachability = 0.05;
            collision_free = 0.30;
          }
        } else {
          reachability = Math.min(0.99, Math.max(0.78, 0.98 - (targetDistFromBase / 0.64) * 0.10));
        }
      }

      // 1. Physical Feasibility Grounding
      if (isHoldingObject) {
        if (skill === 'pick') {
          reachability = 0.25;
          collision_free = 0.40;
          object_state = 0.10; // Gripper occupied!
        } else if (skill === 'place' || skill === 'deliver_to_user') {
          reachability = 0.96;
          collision_free = 0.98;
          object_state = 0.99;
        } else if (skill === 'open_gripper') {
          reachability = 1.0;
          collision_free = 0.99;
          object_state = 0.99;
        } else if (skill === 'close_gripper') {
          reachability = 0.3;
          collision_free = 0.5;
          object_state = 0.15;
        }
      } else {
        // Gripper empty
        if (skill === 'place') {
          reachability = 0.30;
          collision_free = 0.50;
          object_state = 0.10; // Nothing in gripper to place!
        } else if (skill === 'pick') {
          if (isTargetMissing) {
            reachability = 0.0;
            collision_free = 0.20;
            object_state = 0.0;
          } else if (!isTargetOutOfReach) {
            reachability = 0.95;
            collision_free = 0.97;
            object_state = 0.98;
          }
        } else if (skill === 'deliver_to_user') {
          if (isTargetMissing) {
            reachability = 0.0;
            collision_free = 0.20;
            object_state = 0.0;
          } else if (!isTargetOutOfReach) {
            reachability = 0.94;
            collision_free = 0.96;
            object_state = 0.97;
          }
        } else if (skill === 'search_object') {
          if (isTargetMissing) {
            if (intent.action === 'search_object') {
              reachability = 0.95;
              collision_free = 0.98;
              object_state = 0.85;
            } else {
              reachability = 0.0;
              collision_free = 0.20;
              object_state = 0.0;
            }
          } else {
            reachability = 0.99;
            collision_free = 0.99;
            object_state = 0.99;
          }
        }
      }

      // 2. Semantic Task Usefulness Grounding
      if (skill === intent.action) {
        usefulness = 0.98;
      } else if (intent.action === 'deliver_to_user') {
        if (skill === 'deliver_to_user') usefulness = 0.98;
        else if (skill === 'search_object') usefulness = 0.92;
        else if (skill === 'pick') usefulness = 0.82;
        else if (skill === 'move_to_pose') usefulness = 0.72;
        else if (skill === 'open_gripper') usefulness = 0.60;
        else if (skill === 'close_gripper') usefulness = 0.45;
        else usefulness = 0.18;
      } else if (intent.action === 'search_object') {
        if (skill === 'search_object') usefulness = 0.99;
        else if (skill === 'move_to_pose') usefulness = 0.70;
        else if (skill === 'pick') usefulness = 0.25;
        else usefulness = 0.12;
      } else if (intent.action === 'place') {
        if (skill === 'place') usefulness = 0.98;
        else if (skill === 'open_gripper') usefulness = 0.75;
        else if (skill === 'move_to_pose') usefulness = 0.70;
        else if (skill === 'search_object') usefulness = 0.45;
        else usefulness = 0.15;
      } else if (intent.action === 'pick') {
        if (skill === 'pick') usefulness = 0.97;
        else if (skill === 'search_object') usefulness = 0.92;
        else if (skill === 'move_to_pose') usefulness = 0.70;
        else if (skill === 'open_gripper') usefulness = 0.60;
        else if (skill === 'close_gripper') usefulness = 0.55;
        else usefulness = 0.15;
      } else if (isLoopAction) {
        if (skill === 'search_object') usefulness = 0.96;
        else if (skill === 'pick') usefulness = 0.95;
        else if (skill === 'place') usefulness = 0.92;
        else if (skill === 'move_to_pose') usefulness = 0.85;
        else if (skill === 'open_gripper') usefulness = 0.75;
        else if (skill === 'go_home') usefulness = 0.85;
        else usefulness = 0.40;
      } else if (intent.action === 'reset_table' || intent.action === 'scatter_objects') {
        if (skill === 'go_home') usefulness = 0.96;
        else usefulness = 0.35;
      } else if (intent.action === 'delete_all_objects' || intent.action === 'delete_object') {
        if (skill === 'go_home') usefulness = 0.98;
        else usefulness = 0.35;
      } else if (intent.action === 'go_home') {
        if (skill === 'go_home') usefulness = 0.98;
        else if (skill === 'move_to_pose') usefulness = 0.55;
        else usefulness = 0.15;
      } else if (intent.action === 'open_gripper') {
        if (skill === 'open_gripper') usefulness = 0.98;
        else usefulness = 0.15;
      } else if (intent.action === 'close_gripper') {
        if (skill === 'close_gripper') usefulness = 0.98;
        else usefulness = 0.15;
      }

      const feasibility = Math.min(1.0, reachability * collision_free * object_state);
      const combined = Math.pow(usefulness, 0.6) * Math.pow(feasibility, 0.4);

      return {
        skill_name: skill,
        usefulness,
        feasibility,
        combined_score: Math.min(1.0, Math.max(0.0, combined)),
        breakdown: {
          reachability,
          collision_free,
          object_state,
          fusion: 'weighted_product'
        }
      };
    });

    results.sort((a, b) => b.combined_score - a.combined_score);
    return results;
  }

  private buildGeneralizedLoopPlan(intent: Intent): PlanStep[] {
    const id = () => Math.random().toString(36).substring(2, 7);
    const loopTargets: string[] =
      intent.parameters?.loop_targets && intent.parameters.loop_targets.length > 0
        ? intent.parameters.loop_targets
        : this.tabletopObjects.map((o) => o.id);

    const count: number = intent.parameters?.loop_count || loopTargets.length;
    const source: 'table' | 'tray' =
      intent.parameters?.source || (intent.action === 'rerack_table' ? 'tray' : 'table');
    const destination: 'tray' | 'table' | 'user' =
      intent.parameters?.destination || (intent.action === 'rerack_table' ? 'table' : 'tray');

    // Build execution items array repeating or slicing as needed
    const executionItems: string[] = [];
    for (let i = 0; i < count; i++) {
      executionItems.push(loopTargets[i % loopTargets.length]);
    }

    const plan: PlanStep[] = [];
    executionItems.forEach((item, index) => {
      const friendlyName = item.replace('_', ' ');
      const actionVerb = source === 'tray' ? 'Re-rack' : destination === 'user' ? 'Deliver' : 'Clear';
      const loopLabel = `Loop ${index + 1}/${executionItems.length}: ${actionVerb} ${friendlyName}`;

      if (source === 'tray') {
        plan.push(
          {
            id: id(),
            skill: 'move_to_pose',
            params: { pose_name: 'approach_target', target: 'tray' },
            status: 'pending',
            detail: `[${loopLabel}] Move above storage tray for ${friendlyName}`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'open_gripper',
            params: { stroke_mm: 80 },
            status: 'pending',
            detail: `[${loopLabel}] Open gripper fingers`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'pick',
            params: { target_object: item, from_tray: true },
            status: 'pending',
            detail: `[${loopLabel}] Grip ${friendlyName} from storage tray`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'move_to_pose',
            params: { pose_name: 'pre_grasp', target: item },
            status: 'pending',
            detail: `[${loopLabel}] Transfer ${friendlyName} back to tabletop station`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'place',
            params: { target_location: 'table', target_object: item },
            status: 'pending',
            detail: `[${loopLabel}] Place ${friendlyName} on tabletop staging spot`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'open_gripper',
            params: { stroke_mm: 80 },
            status: 'pending',
            detail: `[${loopLabel}] Release grip from ${friendlyName}`,
            loopGroup: loopLabel,
            targetObject: item
          }
        );
      } else {
        const isUserDest = destination === 'user';
        plan.push(
          {
            id: id(),
            skill: 'search_object',
            params: { target_object: item },
            status: 'pending',
            detail: `[${loopLabel}] Active visual search & YOLO scan for ${friendlyName}`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'move_to_pose',
            params: { pose_name: 'pre_grasp', target: item },
            status: 'pending',
            detail: `[${loopLabel}] Align end-effector above detected ${friendlyName}`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'open_gripper',
            params: { stroke_mm: 80 },
            status: 'pending',
            detail: `[${loopLabel}] Open gripper fingers`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'pick',
            params: { target_object: item },
            status: 'pending',
            detail: `[${loopLabel}] Descend directly to ${friendlyName} and grasp`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'move_to_pose',
            params: { pose_name: 'lift', target: item },
            status: 'pending',
            detail: `[${loopLabel}] Lift ${friendlyName} 18cm vertically`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'move_to_pose',
            params: {
              pose_name: isUserDest ? 'handover' : 'approach_target',
              target: destination
            },
            status: 'pending',
            detail: `[${loopLabel}] Transfer ${friendlyName} towards ${destination}`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'place',
            params: { target_location: destination, target_object: item },
            status: 'pending',
            detail: `[${loopLabel}] Deposit ${friendlyName} inside ${destination}`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'open_gripper',
            params: { stroke_mm: 80 },
            status: 'pending',
            detail: `[${loopLabel}] Release grip from ${friendlyName}`,
            loopGroup: loopLabel,
            targetObject: item
          }
        );
      }
    });

    plan.push({
      id: id(),
      skill: 'go_home',
      params: {},
      status: 'pending',
      detail: `Final: Loop sequence completed (${executionItems.length} iterations). Retract arm to home transit pose.`,
      loopGroup: 'Final Retract'
    });

    return plan;
  }

  private generatePlanSteps(intent: Intent): PlanStep[] {
    const id = () => Math.random().toString(36).substring(2, 7);

    if (
      Boolean(intent.parameters?.is_loop) ||
      ['clean_table', 'rerack_table', 'loop_task'].includes(intent.action)
    ) {
      return this.buildGeneralizedLoopPlan(intent);
    }

    if (intent.action === 'delete_all_objects') {
      return [
        {
          id: id(),
          skill: 'delete_all_objects',
          params: {},
          status: 'pending',
          detail: 'Delete all tabletop objects from the workspace (including default items)'
        },
        {
          id: id(),
          skill: 'go_home',
          params: {},
          status: 'pending',
          detail: 'Return arm to safe home transit pose'
        }
      ];
    }

    if (intent.action === 'delete_object') {
      const objId = intent.parameters?.object_id || intent.target_object || '';
      return [
        {
          id: id(),
          skill: 'delete_object',
          params: { object_id: objId },
          status: 'pending',
          detail: `Delete item "${intent.parameters?.object_name || objId}" from tabletop`
        }
      ];
    }

    if (intent.action === 'reset_table') {
      return [
        {
          id: id(),
          skill: 'reset_table',
          params: {},
          status: 'pending',
          detail: 'Reset all objects back to initial tabletop coordinates'
        },
        {
          id: id(),
          skill: 'go_home',
          params: {},
          status: 'pending',
          detail: 'Return arm to home position'
        }
      ];
    }

    if (intent.action === 'scatter_objects') {
      return [
        {
          id: id(),
          skill: 'scatter_objects',
          params: {},
          status: 'pending',
          detail: 'Scatter all tabletop objects randomly across reachable coordinates'
        },
        {
          id: id(),
          skill: 'go_home',
          params: {},
          status: 'pending',
          detail: 'Return arm to home position ready for visual perception'
        }
      ];
    }

    if (intent.action === 'deliver_to_user') {
      const objName = intent.target_object || 'item';
      const friendlyName = objName.replace(/_/g, ' ');
      return [
        {
          id: id(),
          skill: 'search_object',
          params: { target_object: objName },
          status: 'pending',
          detail: `Active RGB-D visual search & YOLO scan for ${friendlyName} (no prior coordinates assumed)`,
          targetObject: objName
        },
        {
          id: id(),
          skill: 'move_to_pose',
          params: { pose_name: 'pre_grasp', target: objName },
          status: 'pending',
          detail: `Align end-effector above detected ${friendlyName}`,
          targetObject: objName
        },
        {
          id: id(),
          skill: 'open_gripper',
          params: { stroke_mm: 80 },
          status: 'pending',
          detail: 'Open fingers to 80mm span',
          targetObject: objName
        },
        {
          id: id(),
          skill: 'pick',
          params: { target_object: objName },
          status: 'pending',
          detail: `Descend directly to ${friendlyName} and grip between finger pads`,
          targetObject: objName
        },
        {
          id: id(),
          skill: 'move_to_pose',
          params: { pose_name: 'lift', target: objName },
          status: 'pending',
          detail: `Lift ${friendlyName} 16cm cleanly off tabletop`,
          targetObject: objName
        },
        {
          id: id(),
          skill: 'move_to_pose',
          params: { pose_name: 'handover', target: 'user' },
          status: 'pending',
          detail: `Transfer and extend ${friendlyName} to operator handover side of table`,
          targetObject: objName
        },
        {
          id: id(),
          skill: 'open_gripper',
          params: { stroke_mm: 80 },
          status: 'pending',
          detail: `Release ${friendlyName} into operator hand / drop zone`,
          targetObject: objName
        },
        {
          id: id(),
          skill: 'go_home',
          params: {},
          status: 'pending',
          detail: 'Retract arm back to table-mounted desk-lamp home pose'
        }
      ];
    }

    if (intent.action === 'search_object') {
      const objName = intent.target_object || 'item';
      const friendlyName = objName.replace(/_/g, ' ');
      return [
        {
          id: id(),
          skill: 'search_object',
          params: { target_object: objName },
          status: 'pending',
          detail: `Active RGB-D visual sweep & YOLO reticle detection for ${friendlyName}`,
          targetObject: objName
        },
        {
          id: id(),
          skill: 'go_home',
          params: {},
          status: 'pending',
          detail: 'Retract arm to safe home position'
        }
      ];
    }

    if (intent.action === 'pick') {
      const objName = intent.target_object || 'item';
      const friendlyName = objName.replace(/_/g, ' ');
      return [
        {
          id: id(),
          skill: 'search_object',
          params: { target_object: objName },
          status: 'pending',
          detail: `Active RGB-D visual search & YOLO scan for ${friendlyName} (no prior coordinates assumed)`,
          targetObject: objName
        },
        {
          id: id(),
          skill: 'move_to_pose',
          params: { pose_name: 'pre_grasp', target: objName },
          status: 'pending',
          detail: `Align end-effector above detected ${friendlyName}`,
          targetObject: objName
        },
        {
          id: id(),
          skill: 'open_gripper',
          params: { stroke_mm: 80 },
          status: 'pending',
          detail: 'Open fingers to 80mm span',
          targetObject: objName
        },
        {
          id: id(),
          skill: 'pick',
          params: { target_object: objName },
          status: 'pending',
          detail: `Descend directly to ${friendlyName} and grip`,
          targetObject: objName
        },
        {
          id: id(),
          skill: 'move_to_pose',
          params: { pose_name: intent.target_location === 'user' ? 'handover' : 'lift', target: objName },
          status: 'pending',
          detail: intent.target_location === 'user' ? 'Deliver to user handover zone' : `Lift ${friendlyName} 18cm above tabletop`,
          targetObject: objName
        }
      ];
    }

    if (intent.action === 'place') {
      const loc = intent.target_location || 'tray';
      const objName = intent.target_object;
      const isHoldingObject = this.tabletopObjects.some((o) => o.state === 'held');

      if (!isHoldingObject && objName && objName !== 'object') {
        const friendlyName = objName.replace(/_/g, ' ');
        return [
          {
            id: id(),
            skill: 'search_object',
            params: { target_object: objName },
            status: 'pending',
            detail: `Active visual search for ${friendlyName} before transfer`,
            targetObject: objName
          },
          {
            id: id(),
            skill: 'move_to_pose',
            params: { pose_name: 'pre_grasp', target: objName },
            status: 'pending',
            detail: `Align end-effector above ${friendlyName}`,
            targetObject: objName
          },
          {
            id: id(),
            skill: 'open_gripper',
            params: { stroke_mm: 80 },
            status: 'pending',
            detail: 'Open gripper fingers',
            targetObject: objName
          },
          {
            id: id(),
            skill: 'pick',
            params: { target_object: objName },
            status: 'pending',
            detail: `Grasp ${friendlyName}`,
            targetObject: objName
          },
          {
            id: id(),
            skill: 'move_to_pose',
            params: { pose_name: 'approach_target', target: loc },
            status: 'pending',
            detail: `Transfer ${friendlyName} to ${loc}`,
            targetObject: objName
          },
          {
            id: id(),
            skill: 'place',
            params: { target_location: loc, target_object: objName },
            status: 'pending',
            detail: `Deposit ${friendlyName} in ${loc}`,
            targetObject: objName
          },
          {
            id: id(),
            skill: 'open_gripper',
            params: { stroke_mm: 80 },
            status: 'pending',
            detail: 'Release grip',
            targetObject: objName
          },
          {
            id: id(),
            skill: 'go_home',
            params: {},
            status: 'pending',
            detail: 'Retract to safe transit home pose'
          }
        ];
      }

      return [
        {
          id: id(),
          skill: 'move_to_pose',
          params: { pose_name: 'approach_target', target: loc },
          status: 'pending',
          detail: `Move arm above ${loc}`
        },
        {
          id: id(),
          skill: 'place',
          params: { target_location: loc },
          status: 'pending',
          detail: `Lower and release object onto ${loc}`
        },
        {
          id: id(),
          skill: 'go_home',
          params: {},
          status: 'pending',
          detail: 'Retract to safe transit home pose'
        }
      ];
    }

    if (intent.action === 'open_gripper') {
      return [
        {
          id: id(),
          skill: 'open_gripper',
          params: { stroke_mm: 80 },
          status: 'pending',
          detail: 'Open gripper fingers'
        }
      ];
    }

    if (intent.action === 'close_gripper') {
      return [
        {
          id: id(),
          skill: 'close_gripper',
          params: intent.parameters,
          status: 'pending',
          detail: 'Close gripper firmly'
        }
      ];
    }

    if (intent.action === 'go_home') {
      return [
        {
          id: id(),
          skill: 'go_home',
          params: {},
          status: 'pending',
          detail: 'Return arm joints to zero home position'
        }
      ];
    }

    return [
      {
        id: id(),
        skill: intent.action,
        params: intent.parameters,
        status: 'pending',
        detail: `Execute skill ${intent.action}`
      }
    ];
  }

  // Exact 6-DOF Closed-Form Inverse Kinematics for Table-Mounted NORA Arm
  public solveDynamicIK(tx: number, ty: number, tz: number): number[] {
    const L1 = 0.32;
    const L2 = 0.32;
    const L3 = 0.245; // Exact distance from joint 5 to TCP between gripper finger pads

    // 1. Coordinates relative to side-mounted base
    const dx = tx - this.robotBasePos.x;
    const dz = tz - this.robotBasePos.z;

    // 2. Azimuth yaw (joint 1 rotates around robot +Z which is Three.js +Y)
    const yaw = Math.atan2(-dz, dx);

    // 3. Radial distance from arm base on the table
    const rtarget = Math.hypot(dx, dz);
    const R = Math.max(0.18, Math.min(0.62, rtarget));

    // 4. Vertical offset relative to shoulder pitch joint (joint2 height is surfaceY + 0.22m = 0.67m)
    const Y = (ty + L3) - (this.robotBasePos.y + 0.22);

    // 5. Distance to wrist center (clamped to 0.635m strictly inside 2-link 0.64m envelope)
    const D = Math.min(0.635, Math.max(0.12, Math.hypot(R, Y)));

    // 6. Law of cosines for elbow pitch (joint 3)
    const cosAngle = Math.max(-0.9999, Math.min(0.9999, (D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2)));
    const j3 = Math.acos(cosAngle);

    // 7. Shoulder pitch (joint 2)
    const gamma = Math.atan2(R, Y);
    const cosBeta = Math.max(-0.9999, Math.min(0.9999, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)));
    const beta = Math.acos(cosBeta);
    const j2 = gamma - beta;

    // 8. Wrist pitch (joint 5) orienting the gripper perfectly vertical top-down
    const j5 = Math.PI - (j2 + j3);

    return [yaw, j2, j3, 0.0, j5, 0.0];
  }

  // Calculate target joint angles dynamically for each skill step
  private getTargetPositionsForSkill(skill: string, step: PlanStep, intent: Intent): number[] {
    const curr = [...this.currentJointPositions];
    const targetObj = (step.targetObject || intent.target_object || '').toLowerCase();
    const normObj = this.normalizeObjectName(targetObj);
    const resolvedObj = normObj ? this.tabletopObjects.find((o) => o.id === normObj || o.name.toLowerCase().includes(normObj)) : null;
    const objPos = resolvedObj ? resolvedObj.position : this.getObjectPosition(normObj || '');
    const poseName = step.params?.pose_name || '';

    // Active vision search scan pose: arm arches overhead, camera tilted towards target
    if (skill === 'search_object') {
      const dx = objPos.x - this.robotBasePos.x;
      const dz = objPos.z - this.robotBasePos.z;
      const yaw = Math.atan2(-dz, dx);
      return [yaw, 0.35, 0.95, 0.0, 0.85, 0.0, curr[6]];
    }

    if (skill === 'move_to_pose') {
      if (poseName === 'pre_grasp') {
        const sol = this.solveDynamicIK(objPos.x, objPos.y + 0.12, objPos.z);
        return [...sol, curr[6]];
      } else if (poseName === 'lift') {
        const sol = this.solveDynamicIK(objPos.x, objPos.y + 0.16, objPos.z);
        return [...sol, curr[6]];
      } else if (poseName === 'handover') {
        // Move directly to operator handover station at front table edge!
        const sol = this.solveDynamicIK(this.handoverPos.x, this.handoverPos.y, this.handoverPos.z);
        return [...sol, curr[6]];
      } else if (poseName === 'approach_target') {
        const isTray = step.params?.target === 'tray' || intent.target_location === 'tray';
        if (isTray) {
          const sol = this.solveDynamicIK(-0.05, 0.45 + 0.14, -0.24);
          return [...sol, curr[6]];
        }
        const sol = this.solveDynamicIK(objPos.x, objPos.y + 0.12, objPos.z);
        return [...sol, curr[6]];
      }
      const sol = this.solveDynamicIK(objPos.x, objPos.y + 0.12, objPos.z);
      return [...sol, curr[6]];
    }

    if (skill === 'pick') {
      // Descend end-effector directly to object center height for a snug grip
      const sol = this.solveDynamicIK(objPos.x, objPos.y, objPos.z);
      return [...sol, 0.015];
    }

    if (skill === 'place') {
      const isPlaceTable = step.params?.target_location === 'table';
      if (isPlaceTable) {
        const sol = this.solveDynamicIK(objPos.x, objPos.y + 0.02, objPos.z);
        return [...sol, 0.07];
      } else {
        const sol = this.solveDynamicIK(-0.05, 0.45 + 0.04, -0.24);
        return [...sol, 0.07];
      }
    }

    if (skill === 'open_gripper') {
      return [curr[0], curr[1], curr[2], curr[3], curr[4], curr[5], 0.07];
    }

    if (skill === 'close_gripper') {
      return [curr[0], curr[1], curr[2], curr[3], curr[4], curr[5], 0.015];
    }

    if (skill === 'go_home') {
      // Natural curved desk-lamp resting pose (table-mounted, bent gracefully)
      return [...DESK_LAMP_HOME_JOINTS];
    }

    return [curr[0], curr[1], curr[2], curr[3], curr[4], curr[5], curr[6]];
  }

  // Smooth continuous multi-waypoint interpolation with instant E-Stop and cancellation safety check
  private async simulateJointMotion(step: PlanStep, intent: Intent, execId?: number): Promise<void> {
    const jointNames = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6', 'gripper_joint'];
    const startPositions = [...this.currentJointPositions];
    const targetPositions = this.getTargetPositionsForSkill(step.skill, step, intent);

    const steps = 24;
    for (let s = 1; s <= steps; s++) {
      if (this.isEStopped || this.isCancelled || (execId && execId !== this.currentExecutionId)) {
        return;
      }

      const t = s / steps;
      // Cosine ease-in-out: smooth acceleration and deceleration
      const ease = (1 - Math.cos(t * Math.PI)) / 2;
      const currentPos = startPositions.map((start, i) => start + (targetPositions[i] - start) * ease);

      this.currentJointPositions = [...currentPos];
      this.jointListeners.forEach((cb) =>
        cb({
          names: jointNames,
          positions: this.currentJointPositions,
          timestamp: Date.now()
        })
      );
      await this.delay(45);
      if (this.isEStopped || this.isCancelled || (execId && execId !== this.currentExecutionId)) {
        return;
      }
    }
  }

  public emergencyStop(): void {
    this.isEStopped = true;

    // Instantly break any active sleep/delay
    if (this.activeDelayResolver) {
      this.activeDelayResolver();
      this.activeDelayResolver = null;
    }

    // Cancel active vision scans
    this.emitPerceptionScan({ active: false });

    this.emitLog({
      level: 40,
      levelName: 'ERROR',
      nodeName: 'safety_controller',
      message: '🚨 [EMERGENCY STOP (E-STOP) ACTIVATED] Trajectory halted immediately! Arm joints frozen at current physical coordinates.'
    });

    // Broadcast current frozen position so arm does NOT move another millimeter
    this.jointListeners.forEach((cb) =>
      cb({
        names: ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6', 'gripper_joint'],
        positions: [...this.currentJointPositions],
        timestamp: Date.now()
      })
    );

    this.notifyPipeline({
      stage: 'FAILED',
      error: '🚨 EMERGENCY STOP ENGAGED: Robot arm trajectory halted instantly. Servos locked in current pose.'
    });

    this.stateListeners.forEach((cb) => cb('FAILED'));
    this.eStopListeners.forEach((cb) => cb(true));

    if (this.ros && this.connected) {
      try {
        const estopTopic = new ROSLIB.Topic({
          ros: this.ros,
          name: '/emergency_stop',
          messageType: 'std_msgs/msg/Bool'
        });
        estopTopic.publish({ data: true });
      } catch (err) {
        // ignore
      }
    }
  }

  public resetEmergencyStop(): void {
    this.isEStopped = false;
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'safety_controller',
      message: '✅ Emergency Stop cleared. Safety interlock reset. NORA arm ready for operation.'
    });
    this.stateListeners.forEach((cb) => cb('IDLE'));
    this.eStopListeners.forEach((cb) => cb(false));
    this.notifyPipeline({ stage: 'DONE' });
  }

  public onEStopChange(cb: (isStopped: boolean) => void): () => void {
    this.eStopListeners.add(cb);
    cb(this.isEStopped);
    return () => this.eStopListeners.delete(cb);
  }

  public isEmergencyStopped(): boolean {
    return this.isEStopped;
  }

  public getIsEStopped(): boolean {
    return this.isEStopped;
  }

  // Listener subscriptions
  public onConnection(cb: ConnectionCallback): () => void {
    this.connectionListeners.add(cb);
    cb(this.connected, this.wsUrl);
    return () => this.connectionListeners.delete(cb);
  }

  public onJointStates(cb: JointStateCallback): () => void {
    this.jointListeners.add(cb);
    return () => this.jointListeners.delete(cb);
  }

  public onLog(cb: LogCallback): () => void {
    this.logListeners.add(cb);
    return () => this.logListeners.delete(cb);
  }

  public onOrchestratorState(cb: StateCallback): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  public onPipelineProgress(cb: PipelineProgressCallback): () => void {
    this.pipelineListeners.add(cb);
    return () => this.pipelineListeners.delete(cb);
  }

  public onArmSpeech(cb: ArmSpeechCallback): () => void {
    this.armSpeechListeners.add(cb);
    return () => this.armSpeechListeners.delete(cb);
  }

  public emitArmSpeech(event: ArmSpeechEvent): void {
    this.armSpeechListeners.forEach((cb) => cb(event));
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(event.message);
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        // speech synthesis optional
      }
    }
  }

  public onGuardrail(cb: GuardrailCallback): () => void {
    this.guardrailListeners.add(cb);
    return () => this.guardrailListeners.delete(cb);
  }

  public emitGuardrail(event: GuardrailEvent | null): void {
    this.guardrailListeners.forEach((cb) => cb(event));
  }

  public async shakeHeadNo(): Promise<void> {
    if (this.isEStopped || this.isCancelled) return;
    const jointNames = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6', 'gripper_joint'];
    const basePose = [...this.currentJointPositions];
    const j6 = basePose[5] || 0.0;

    // Expressive head-shake refusal oscillation on wrist yaw
    const offsets = [0.22, -0.22, 0.16, -0.16, 0.0];
    for (const offset of offsets) {
      if (this.isEStopped || this.isCancelled) return;
      this.currentJointPositions[5] = j6 + offset;
      this.jointListeners.forEach((cb) =>
        cb({
          names: jointNames,
          positions: [...this.currentJointPositions],
          timestamp: Date.now()
        })
      );
      await this.delay(120);
    }
    this.currentJointPositions[5] = j6;
    this.jointListeners.forEach((cb) =>
      cb({
        names: jointNames,
        positions: [...this.currentJointPositions],
        timestamp: Date.now()
      })
    );
  }

  private notifyConnection(connected: boolean): void {
    this.connectionListeners.forEach((cb) => cb(connected, this.wsUrl));
  }

  private emitLog(log: Omit<RosLog, 'id' | 'timestamp'>): void {
    const fullLog: RosLog = {
      ...log,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString()
    };
    this.logListeners.forEach((cb) => cb(fullLog));
  }

  private notifyPipeline(data: any): void {
    this.pipelineListeners.forEach((cb) => cb(data));
  }

  public async cancelTask(): Promise<void> {
    // 1. Advance execution generation to instantly invalidate running loops
    this.currentExecutionId++;
    this.isCancelled = true;
    this.isExecuting = false;

    // 2. Clear any active Emergency Stop locks so arm is permitted to move home
    this.isEStopped = false;
    this.eStopListeners.forEach((cb) => cb(false));

    // 3. Break active promise delay / sleeps
    if (this.activeDelayResolver) {
      this.activeDelayResolver();
      this.activeDelayResolver = null;
    }

    // 4. Cancel active vision scans
    this.emitPerceptionScan({ active: false });

    // 5. If an object was being held during cancellation, safely deposit it onto table
    const heldObj = this.tabletopObjects.find((o) => o.state === 'held');
    if (heldObj) {
      heldObj.state = 'table';
      heldObj.position = {
        x: Number((heldObj.position?.x ?? 0.0).toFixed(3)),
        y: 0.485,
        z: Number((heldObj.position?.z ?? 0.15).toFixed(3))
      };
      this.objectPositions[heldObj.id] = heldObj.position;
      this.emitObjectEvent({ name: heldObj.id, state: 'table', position: heldObj.position });
      this.emitObjectsChange();
      this.positionListeners.forEach((cb) => cb({ ...this.objectPositions }));
    }

    // Open gripper
    this.currentJointPositions[6] = 0.03;
    this.jointListeners.forEach((cb) =>
      cb({
        names: ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6', 'gripper_joint'],
        positions: [...this.currentJointPositions],
        timestamp: Date.now()
      })
    );

    this.emitLog({
      level: 30,
      levelName: 'WARN',
      nodeName: 'nora_orchestrator',
      message: '⏹️ [Task Cancelled] Program stopped by operator. Safely returning arm to home transit pose.'
    });

    this.notifyPipeline({
      stage: 'IDLE',
      error: 'Task was cancelled. Arm returning to home transit pose.'
    });

    // 6. Smoothly return arm to desk-lamp home pose using non-abortable motionSleep
    await this.returnHome();

    // 7. Reset cancellation flags and finalize IDLE state
    this.isCancelled = false;
    this.notifyPipeline({
      stage: 'IDLE'
    });
    this.stateListeners.forEach((cb) => cb('IDLE'));

    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'nora_orchestrator',
      message: '🏠 [Arm Parked] Arm is safely at home. Ready for any new command.'
    });
  }

  public stop(): void {
    this.emergencyStop();
  }

  public resume(): void {
    this.resetEmergencyStop();
  }

  public async returnHome(): Promise<void> {
    const jointNames = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6', 'gripper_joint'];
    const startPositions = [...this.currentJointPositions];
    const targetPositions = [...DESK_LAMP_HOME_JOINTS];

    const steps = 24;
    for (let s = 1; s <= steps; s++) {
      if (this.isEStopped) return;
      const t = s / steps;
      const ease = (1 - Math.cos(t * Math.PI)) / 2;
      const currentPos = startPositions.map((start, i) => start + (targetPositions[i] - start) * ease);

      this.currentJointPositions = [...currentPos];
      this.jointListeners.forEach((cb) =>
        cb({
          names: jointNames,
          positions: [...this.currentJointPositions],
          timestamp: Date.now()
        })
      );
      await this.motionSleep(25);
    }

    this.currentJointPositions = [...DESK_LAMP_HOME_JOINTS];
    this.jointListeners.forEach((cb) =>
      cb({
        names: jointNames,
        positions: [...this.currentJointPositions],
        timestamp: Date.now()
      })
    );
  }

  public motionSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private delay(ms: number): Promise<void> {
    if (this.isEStopped || this.isCancelled) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.activeDelayResolver = null;
        resolve();
      }, ms);
      this.activeDelayResolver = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}

export const rosService = new RosBridgeService();

