import * as ROSLIB from 'roslib';
import { NluModel } from './nluModel';
import {
  solveIK,
  checkReach,
  forwardKinematics,
  tcpPosition,
  MAX_TABLE_REACH,
  GRASP_MIN_TCP_HEIGHT,
  UR5E_GEOMETRY
} from '../sim/kinematics';
import { buildWorld, type CollisionWorld } from '../sim/collision';
import { planJointPath, samplePath, pathLength, type PlanResult } from '../sim/planner';
import { topicBus } from '../sim/topicBus';
import * as THREE from 'three';
import { objectKind } from '../sim/objectMeshes';
import { findGraspedObject, GRASP_WIDTH, GRIPPER_MAX_OPEN, OBJECT_HEIGHT, dropRegion, restLift, chooseToteSlot, settleHeight, TOTE, MAT, type RestRegion } from '../sim/physics';
import type { CameraFrame } from '../sim/wristCamera';
import { associate, type Perceived } from '../sim/vision';

export { UR5E_GEOMETRY, MAX_TABLE_REACH };

type SeenSummary = { detections: Perceived[]; byId: Record<string, Perceived>; ids: Set<string>; names: string[]; count: number };
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

// Home pose: arm folded over the table, tool pointing down ~0.36 m above the surface.
// Pan is offset by -0.37 rad so the laterally-offset wrist ends up in line with the base.
// Order: [pan, lift, elbow, wrist1, wrist2, wrist3, gripper]
export const DESK_LAMP_HOME_JOINTS: number[] = [-0.37, -0.35, 1.9, 0.02, -Math.PI / 2, 0.0, 0.03];

export const DEFAULT_TABLETOP_OBJECTS: TabletopObject[] = [
  {
    id: 'water',
    name: 'Water Glass',
    shape: 'glass',
    color: '#06b6d4',
    position: { x: 0.12, y: 0.505, z: 0.0 },
    state: 'table',
    isCustom: false
  },
  {
    id: 'tennis_ball',
    name: 'Tennis Ball',
    shape: 'sphere',
    color: '#84cc16',
    position: { x: -0.1, y: 0.485, z: 0.14 },
    state: 'table',
    isCustom: false
  },
  {
    id: 'coffee_mug',
    name: 'Coffee Mug',
    shape: 'mug',
    color: '#8B4513',
    position: { x: 0.28, y: 0.492, z: 0.1 },
    state: 'table',
    isCustom: false
  }
];

const defaultObjectPositions = (): Record<string, ObjectPosition> =>
  Object.fromEntries(DEFAULT_TABLETOP_OBJECTS.map((o) => [o.id, { ...o.position }]));

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

  // Named sports equipment: never fall through to a generic ball
  if (l.includes('tennis') || l.includes('racket') || l.includes('racquet')) {
    return { name: 'Tennis Ball', shape: 'sphere', color: '#84cc16', emoji: '🎾' };
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
  private objectPositions: Record<string, ObjectPosition> = defaultObjectPositions();

  // Emergency Stop & Safety Interlock State
  private isEStopped: boolean = false;
  private isCancelled: boolean = false;
  private isExecuting: boolean = false;
  private currentExecutionId: number = 0;
  private activeDelayResolver: (() => void) | null = null;

  // Camera perception: the 3D view renders frames from the wrist camera and hands them to us.
  private perceptionProvider: (() => Promise<CameraFrame>) | null = null;
  // Number of objects the most recent full-table camera sweep saw (null = no sweep yet)
  private lastSweepCount: number | null = null;
  // Last camera estimate per object (used to aim grasps; ignored if the object has since moved).
  // THE ROBOT'S BELIEF about where objects are: built only from camera frames, refreshed continuously, and
  // forgotten when the camera looks at the spot and sees bare table. Control logic reads only this, never the
  // simulator's own object list (which is the physical world).
  private perceived: Record<string, { position: { x: number; y: number; z: number }; stamp: number; misses?: number }> = {};
  // What the gripper's finger-stroke sensor says it is holding (null = open, or closed on nothing)
  private gripHolding: { id: string; width: number } | null = null;
  // Table-resting height of each object, so a released object can come to rest on the surface below it
  private objectRestY: Record<string, number> = {};
  private toteSlot: { x: number; z: number } | null = null;
  // Where the object being carried back to the table will be put down (chosen from the belief)
  private tableSpot: { x: number; z: number } | null = null;
  // Objects whose grasp failed (3 attempts) during the current task: not queued again until the next command
  private ungraspable = new Set<string>();
  // THE ROBOT'S OBJECT DATABASE: what each object it has been told about is (name, kind, colour). It never says
  // where an object is, or whether it is still there: an object removed from the table stays in here.
  private catalogue: TabletopObject[] = JSON.parse(JSON.stringify(DEFAULT_TABLETOP_OBJECTS));
  private perceptionTimer: ReturnType<typeof setInterval> | null = null;
  private perceiving = false;

  // Trained NLU model (same weights as the ROS nlu node). null until loaded, or if loading fails;
  // in that case the built-in rule parser handles everything.
  private nlu: NluModel | null = null;
  private nluReady: Promise<void> = Promise.resolve();
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

  private audioMuted = false;

  constructor() {
    this.nluReady = NluModel.load('/nora_nlu_model.json')
      .then((m) => {
        this.nlu = m;
      })
      .catch((err) => {
        console.warn('Trained NLU model unavailable, using rule-based parser:', err);
      });
    this.attachTopicBus();
    try {
      this.audioMuted = localStorage.getItem('nora.audioMuted') === 'true';
    } catch {
      // Audio remains available when browser storage is disabled.
    }
  }

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
      const anchors: Record<string, { x: number; z: number }> = {
        center: { x: 0.0, z: 0.22 },
        left: { x: -0.24, z: 0.16 },
        right: { x: 0.22, z: 0.16 },
        user: { x: 0.0, z: 0.34 },
        auto: { x: 0.1, z: 0.05 }
      };
      const spot = this.findFreeSpot(anchors[chosenZone] ?? anchors.auto, undefined, chosenZone !== 'user');
      pos = { x: spot.x, y, z: spot.z };
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
    this.catalogue.push(JSON.parse(JSON.stringify(newObj))); // the robot is told what the new thing is, not where
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

  /**
   * A spot on the table with room for a new object: reachable by the arm, clear of the robot base, the tote and every
   * object already there, as close to `anchor` as possible. (This is the world placing a thing the user added,
   * not robot logic.)
   */
  private findFreeSpot(
    anchor: { x: number; z: number },
    taken: { x: number; z: number }[] = this.tabletopObjects.filter((o) => o.state !== 'held').map((o) => o.position),
    avoidMat = false
  ): { x: number; z: number } {
    const base = this.robotBasePos;
    let best = anchor;
    let bestScore = -Infinity;
    for (let x = -0.12; x <= 0.52; x += 0.04) {
      for (let z = -0.32; z <= 0.34; z += 0.04) {
        if (Math.hypot(x - base.x, z - base.z) < 0.24) continue; // robot base
        if (x > -0.17 && x < 0.07 && z > -0.36 && z < -0.12) continue; // storage tote
        if (avoidMat && x > MAT.x0 - 0.04 && x < MAT.x1 + 0.04 && z > MAT.z0 - 0.04) continue; // handover mat
        if (!checkReach(x, base.y + 0.04, z, base).reachable) continue;
        const gap = taken.length ? Math.min(...taken.map((p) => Math.hypot(p.x - x, p.z - z))) : 1;
        // roomy spots first (up to 15 cm clearance), then nearest the requested anchor
        const score = Math.min(gap, 0.15) * 10 - Math.hypot(x - anchor.x, z - anchor.z);
        if (score > bestScore) {
          bestScore = score;
          best = { x: Number(x.toFixed(3)), z: Number(z.toFixed(3)) };
        }
      }
    }
    return best;
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
    for (const d of DEFAULT_TABLETOP_OBJECTS) if (!this.catalogue.some((c) => c.id === d.id)) this.catalogue.push(JSON.parse(JSON.stringify(d)));
    this.objectPositions = defaultObjectPositions();

    this.emitObjectsChange();
    this.positionListeners.forEach((cb) => cb({ ...this.objectPositions }));

    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'tabletop_env',
      message: '[Workspace] Restored default tabletop objects (Water Glass, Tennis Ball, Coffee Mug).'
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
    for (const obj of this.known()) {
      const nameL = obj.name.toLowerCase();
      const idL = obj.id.toLowerCase();
      if (lower === nameL || lower === idL) {
        return obj;
      }
    }

    // 2. Exact substring phrase match for full name or ID (e.g. "red cube", "red apple", "blue cylinder")
    for (const obj of this.known()) {
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
      const matchingObjects = this.known().filter((obj) => {
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
        const found = this.known().find((o) => {
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
      for (const obj of this.known()) {
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
    for (const o of this.known()) {
      if (l === o.id.toLowerCase() || l === o.name.toLowerCase()) {
        return o.id;
      }
    }

    const obj = this.findObjectFromText(l);
    if (obj) return obj.id;

    // 2. Direct string contains
    for (const o of this.known()) {
      if (l.includes(o.id.toLowerCase()) || l.includes(o.name.toLowerCase())) {
        return o.id;
      }
    }

    // 3. Specific item identification (respecting strict semantics!)
    if (l.includes('scissors') || l.includes('scissor') || l.includes('cut') || l.includes('trim') || l.includes('snip') || l.includes('shears')) {
      const scissorsObj = this.known().find(
        (o) => o.id.toLowerCase().includes('scissor') || o.name.toLowerCase().includes('scissor')
      );
      return scissorsObj ? scissorsObj.id : 'scissors';
    }

    if (l.includes('stapler') || l.includes('staple') || l.includes('bind')) {
      const staplerObj = this.known().find(
        (o) => o.id.toLowerCase().includes('stapler') || o.name.toLowerCase().includes('stapler')
      );
      return staplerObj ? staplerObj.id : 'stapler';
    }

    if (l.includes('eraser') || l.includes('erase') || l.includes('rub out')) {
      const eraserObj = this.known().find(
        (o) => o.id.toLowerCase().includes('eraser') || o.name.toLowerCase().includes('eraser')
      );
      return eraserObj ? eraserObj.id : 'eraser';
    }

    if (l.includes('ruler') || l.includes('measure') || l.includes('straight line')) {
      const rulerObj = this.known().find(
        (o) => o.id.toLowerCase().includes('ruler') || o.name.toLowerCase().includes('ruler')
      );
      return rulerObj ? rulerObj.id : 'ruler';
    }

    if (l.includes('highlighter') || l.includes('highlight')) {
      const hlObj = this.known().find(
        (o) => o.id.toLowerCase().includes('highlighter') || o.name.toLowerCase().includes('highlighter')
      );
      return hlObj ? hlObj.id : 'highlighter';
    }

    if (l.includes('tennis') || l.includes('racket') || l.includes('racquet') || (l.includes('play') && l.includes('ball'))) {
      const tennisObj = this.known().find(
        (o) => o.id.toLowerCase().includes('tennis') || o.name.toLowerCase().includes('tennis')
      );
      return tennisObj ? tennisObj.id : 'tennis_ball';
    }

    if (l.includes('pen') || l.includes('pencil') || l.includes('marker') || l.includes('stationery') || (l.includes('write') && !l.includes('water'))) {
      const penObj = this.known().find(
        (o) => o.id.toLowerCase().includes('pen') || o.name.toLowerCase().includes('pen') || o.name.toLowerCase().includes('pencil')
      );
      return penObj ? penObj.id : 'pen';
    }

    if (l.includes('apple') || l.includes('fruit')) {
      const appleObj = this.known().find(
        (o) => o.shape === 'apple' || o.id.toLowerCase().includes('apple') || o.name.toLowerCase().includes('apple')
      );
      return appleObj ? appleObj.id : 'apple';
    }

    if (l.includes('coffee') || (l.includes('tired') && !l.includes('water')) || (l.includes('mug') && !l.includes('water'))) {
      const mugObj = this.known().find(
        (o) => o.shape === 'mug' || o.id.toLowerCase().includes('coffee') || o.name.toLowerCase().includes('coffee')
      );
      return mugObj ? mugObj.id : 'coffee_mug';
    }

    if (l.includes('cube') || l.includes('box') || l.includes('block')) {
      const cubeObj = this.known().find((o) => o.shape === 'box' || o.id.toLowerCase().includes('cube'));
      return cubeObj ? cubeObj.id : 'red_cube';
    }

    if (l.includes('cylinder') || (l.includes('blue') && !l.includes('cube') && !l.includes('apple'))) {
      const cylObj = this.known().find((o) => o.shape === 'cylinder' || o.id.toLowerCase().includes('cylinder'));
      return cylObj ? cylObj.id : 'blue_cylinder';
    }

    if (l.includes('water') || l.includes('glass') || l.includes('drink')) {
      const glassObj = this.known().find((o) => o.shape === 'glass' || o.id.toLowerCase().includes('water'));
      return glassObj ? glassObj.id : 'water';
    }

    if (l.includes('sphere') || (!l.includes('tennis') && l.includes('ball'))) {
      const sphereObj = this.known().find((o) => o.shape === 'sphere' || o.id.toLowerCase().includes('sphere'));
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
    topicBus.publish('/nora/intent', 'nora_interfaces/msg/Intent', intent);
    topicBus.publish('/nora/task_affordance', 'std_msgs/msg/String', {
      task: intent.raw_text,
      winning_skill: topAff.skill_name,
      combined_score: topAff.combined_score,
      usefulness: topAff.usefulness,
      feasibility: topAff.feasibility,
      breakdown: topAff.breakdown
    });
    topicBus.publish('/nora/affordance_score', 'std_msgs/msg/Float32', { data: topAff.combined_score });

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
    this.ungraspable.clear(); // a new task gets a fresh try at everything
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

      await this.nluReady;
      const intent = this.parseSimulatedIntent(text);
      if (intent.action === 'cancel_task') {
        await this.cancelTask();
        return;
      }
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'nora_nlu',
      message: `[NLU ${intent.parameters?.nlu_source === 'trained_model' ? `trained model, ${this.nlu?.vocabSize ?? 0} features` : 'rule parser'}] Parsed intent: action='${intent.action}' target='${intent.target_object || 'none'}' loc='${intent.target_location || 'none'}' conf=${(intent.confidence * 100).toFixed(0)}%`
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
         this.known().find((o) => o.id === targetObjName || o.name.toLowerCase() === targetObjName.toLowerCase()))
      : null;
    const isMissingObject =
      !isExplicit &&
      !isPhysical &&
      !targetObj &&
      Boolean(targetObjName) &&
      targetObjName !== 'none' &&
      targetObjName !== 'null' &&
      intent.action !== 'search_object';

    // SayCan Safety Guardrail: Block immediately ONLY for explicit violations, impossible actions, or guardrail test triggers.
    // Manipulation commands with target objects always execute on-arm camera visual search first!
    if (
      !topAff ||
      topAff.combined_score < 0.30 ||
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
        ? `SayCan Reachability Guardrail: Target "${friendlyTarget}" is positioned too far from the table-mounted arm base (> ${MAX_TABLE_REACH.toFixed(2)} m limit). Drag it closer to enable manipulation.`
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
        ? `[SayCan Reachability Guardrail] Target "${friendlyTarget}" is outside table-mounted arm physical reach envelope (> ${MAX_TABLE_REACH.toFixed(2)} m from base). Motion aborted for safety.`
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
        nodeName: 'motion_planner',
        message: `[Motion] Step ${i + 1}/${plan.length}: ${step.skill}`
      });

      if (step.skill === 'search_object' && step.params?.scan_mode === 'target_check') {
        // Closed loop: fly the camera above where the object was last seen and look again before reaching for it.
        const tid = step.targetObject as string;
        const known = this.perceived[tid]?.position; // only where the camera last saw it
        const name = this.known().find((o) => o.id === tid)?.name ?? tid.replace(/_/g, ' ');
        let present = false;
        if (known) {
          const lookPose = [...this.solveDynamicIK(known.x, this.robotBasePos.y + 0.45, known.z), this.currentJointPositions[6]];
          this.emitPerceptionScan({ active: true, targetObject: tid });
          await this.moveAlongPlan(lookPose, this.buildCollisionWorld(null), { execId, frameMs: 30, abortable: true, label: 'target_check' });
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
          await this.delay(150);
          const seen = await this.perceive();
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
          present = Boolean(seen.byId[tid]);
          this.emitPerceptionScan({ active: false, targetObject: tid, detectedCount: seen.count, objectsOnFrame: seen.names });
        }
        if (!present) {
          this.emitLog({
            level: 30,
            levelName: 'WARN',
            nodeName: 'nora_perception',
            message: `[Perception] ${name} is no longer where it was last seen. Skipping it.`
          });
          for (let j = plan.length - 1; j > i; j--) if (plan[j].loopGroup === step.loopGroup) plan.splice(j, 1);
          delete this.perceived[tid];
          this.notifyPipeline({ stage: 'EXECUTING', intent, affordances, plan: [...plan], activeStepId: step.id });
        }
        step.status = 'completed';
        continue;
      }

      if (step.skill === 'search_object') {
        // Loop and re-rack commands: look first, then queue a transfer for every matching object the camera sees.
        if (step.params?.scan_mode === 'loop_survey') {
          const source = (step.params.source ?? 'table') as 'table' | 'tray';
          const destination = (step.params.destination ?? 'tray') as 'tray' | 'table' | 'user';
          const keywords: string[] = step.params.keywords ?? [];
          const round = Number(step.params.round ?? 0);
          const limit: number | null = step.params.count ?? null;
          const where = source === 'tray' ? 'the storage tote' : 'the table';
          const what = keywords.length ? keywords.join(' / ') : 'every object';
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_perception',
            message: round === 0
              ? `[On-Arm Camera Perception] Surveying ${where} for ${what}.`
              : `[On-Arm Camera Perception] Re-checking ${where} for anything matching that is left.`
          });
          this.emitArmSpeech({ message: `Looking at ${where} for ${what}...`, subtext: 'RGB-D eye-in-hand camera active', type: 'info' });
          this.emitPerceptionScan({ active: true, targetObject: 'tabletop_workspace' });
          await this.simulateJointMotion(step, intent, execId);
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
          const seen = await this.visualSweep(() => false, execId, { exhaustive: true });
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
          let matches = this.seenIn(seen, source).filter((o) => {
            const entry = this.known().find((k) => k.id === o.id);
            return entry ? this.objectMatches(entry, keywords) : keywords.length === 0;
          });
          const gaveUp = matches.filter((o) => this.ungraspable.has(o.id));
          if (gaveUp.length) {
            this.emitLog({ level: 30, levelName: 'WARN', nodeName: 'nora_perception', message: `[Perception] Still sees ${gaveUp.map((o) => o.name).join(', ')}, but grasping it already failed in this task. Leaving it.` });
            matches = matches.filter((o) => !this.ungraspable.has(o.id));
          }
          if (limit !== null && matches.length > limit) matches = matches.slice(0, limit);
          this.lastSweepCount = matches.length;
          this.emitPerceptionScan({ active: false, targetObject: 'tabletop_workspace', detectedCount: matches.length, objectsOnFrame: matches.map((o) => o.name) });
          if (matches.length === 0) {
            this.emitLog({
              level: round === 0 ? 30 : 20,
              levelName: round === 0 ? 'WARN' : 'INFO',
              nodeName: 'nora_perception',
              message: round === 0
                ? `[On-Arm Camera Perception] The camera sees nothing matching ${what} in ${where}. Nothing to do.`
                : `[On-Arm Camera Perception] Nothing matching is left in ${where}.`
            });
            this.emitArmSpeech({
              message: round === 0 ? `I can't see ${what} in ${where}.` : 'Done: nothing matching is left.',
              subtext: `Camera survey: 0 matching objects in ${where}`,
              type: round === 0 ? 'warning' : 'info'
            });
          } else {
            const names = matches.map((o) => o.name).join(', ');
            this.emitLog({
              level: 20,
              levelName: 'INFO',
              nodeName: 'nora_perception',
              message: `[On-Arm Camera Perception] Camera sees ${matches.length} matching object(s) in ${where}: [${names}]. Queuing them.`
            });
            if (limit !== null && matches.length < limit) {
              this.emitLog({ level: 30, levelName: 'WARN', nodeName: 'nora_perception', message: `[Perception] Asked for ${limit}, but the camera only sees ${matches.length}.` });
            }
            const queued = matches.flatMap((o) => this.buildTransferSteps(o.id, o.name, source, destination));
            // "all of them": look again afterwards, in case something was missed, added, or a grasp failed
            if (limit === null && round < 2) {
              queued.push({
                id: Math.random().toString(36).substring(2, 7),
                skill: 'search_object',
                params: { ...step.params, round: round + 1 },
                status: 'pending',
                detail: `[Re-check] On-arm camera looks at ${where} again for anything matching that is left`,
                loopGroup: 'Perception Verification',
                targetObject: 'tabletop_workspace'
              });
            }
            plan.splice(i + 1, 0, ...queued);
            this.notifyPipeline({ stage: 'EXECUTING', intent, affordances, plan: [...plan], activeStepId: step.id });
          }
          step.status = 'completed';
          continue;
        }

        // Tabletop workspace post-cleanup verification re-scan with on-arm camera
        if (step.params?.scan_mode === 'verification_survey') {
          let currentTableItems: { id: string; name: string }[] = [];
          let count = 0;
          let names = '';

          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_perception',
            message: `[On-Arm Camera Perception] Initiating post-cleanup tabletop verification re-scan to confirm all objects removed.`
          });
          this.emitArmSpeech({
            message: 'Re-scanning tabletop workspace with on-arm camera to verify all objects are removed...',
            subtext: 'RGB-D Eye-in-Hand camera active • Post-cleanup verification',
            type: 'info'
          });

          this.emitPerceptionScan({ active: true, targetObject: 'tabletop_workspace', scanMode: 'verification_survey' });
          await this.simulateJointMotion(step, intent, execId);
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
          await this.delay(650);
          {
            const seen = await this.visualSweep(() => false, execId, { exhaustive: true });
            if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
            currentTableItems = this.seenIn(seen, 'table').filter((o) => !this.ungraspable.has(o.id)); // what the camera sees on the table, minus what it already failed to grasp
            count = currentTableItems.length;
            names = currentTableItems.map((o) => o.name).join(', ');
            this.lastSweepCount = count;
          }
          this.emitPerceptionScan({
            active: false,
            targetObject: 'tabletop_workspace',
            detectedCount: count,
            objectsOnFrame: currentTableItems.map((o) => o.name),
            scanMode: 'verification_survey'
          });

          if (count === 0) {
            this.emitLog({
              level: 20,
              levelName: 'INFO',
              nodeName: 'nora_perception',
              message: `✅ [Verification Confirmed] Re-scan complete: 0 objects detected on frame. All objects have been verified removed from tabletop.`
            });
            this.emitArmSpeech({
              message: 'Verification confirmed! On-arm camera detected 0 objects on frame. Table is completely clean.',
              subtext: 'Perception verification • Tabletop 100% clear',
              type: 'info'
            });
          } else {
            this.emitLog({
              level: 30,
              levelName: 'WARN',
              nodeName: 'nora_perception',
              message: `⚠️ [Verification Alert] Re-scan detected ${count} remaining object(s) on frame: [${names}]. Queuing real-time removal before final parking...`
            });
            this.emitArmSpeech({
              message: `Verification detected ${count} remaining object${count > 1 ? 's' : ''} on frame: ${names}. Clearing them now...`,
              subtext: `Dynamic queue update • ${count} objects detected`,
              type: 'warning'
            });

            const round = Number(step.params?.round ?? 0);
            const newSteps: PlanStep[] = [];
            if (round < 2) {
              for (const o of currentTableItems) newSteps.push(...this.buildClearSteps(o.id, o.name, 'Real-Time Clear'));
              newSteps.push({
                id: Math.random().toString(36).substring(2, 7),
                skill: 'search_object',
                params: { target_object: 'tabletop_workspace', scan_mode: 'verification_survey', round: round + 1 },
                status: 'pending',
                detail: '[Verification Sweep] On-arm camera re-scans the tabletop to confirm nothing is left',
                loopGroup: 'Perception Verification',
                targetObject: 'tabletop_workspace'
              });
            } else {
              this.emitLog({
                level: 30,
                levelName: 'WARN',
                nodeName: 'nora_perception',
                message: `[Verification] The camera still sees ${names} after ${round + 1} clearing passes. Leaving it: it may be out of reach or not graspable.`
              });
            }
            plan.splice(i + 1, 0, ...newSteps);
            this.notifyPipeline({
              stage: 'EXECUTING',
              intent,
              affordances,
              plan: [...plan],
              activeStepId: step.id
            });
          }

          step.status = 'completed';
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_skills',
            message: `[Skill] Step ${i + 1} (${step.skill}) completed successfully.`
          });
          continue;
        }

        // Tabletop workspace survey with on-arm camera (dynamically scans all objects in live frame)
        if (step.params?.scan_mode === 'frame_survey' || step.targetObject === 'tabletop_workspace') {
          let currentTableItems: { id: string; name: string }[] = [];
          let count = 0;
          let names = '';

          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_perception',
            message: `[On-Arm Camera Perception] Initiating tabletop workspace survey sweep.`
          });
          this.emitArmSpeech({
            message: 'Scanning tabletop workspace with on-arm camera...',
            subtext: 'RGB-D Eye-in-Hand camera active',
            type: 'info'
          });

          this.emitPerceptionScan({ active: true, targetObject: 'tabletop_workspace' });
          await this.simulateJointMotion(step, intent, execId);
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
          await this.delay(500);
          {
            const seen = await this.visualSweep(() => false, execId, { exhaustive: true });
            if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
            currentTableItems = this.seenIn(seen, 'table'); // everything the camera saw lying on the table
            count = currentTableItems.length;
            names = currentTableItems.map((o) => o.name).join(', ');
            this.lastSweepCount = count;
          }
          this.emitPerceptionScan({
            active: false,
            targetObject: 'tabletop_workspace',
            detectedCount: count,
            objectsOnFrame: currentTableItems.map((o) => o.name)
          });

          if (count === 0) {
            this.emitLog({
              level: 20,
              levelName: 'INFO',
              nodeName: 'nora_perception',
              message: `[On-Arm Camera Perception] Tabletop workspace sweep complete: 0 objects detected on frame. Table is already clear.`
            });
            this.emitArmSpeech({
              message: 'Tabletop is already clear! On-arm camera detected 0 objects on frame.',
              subtext: 'Workspace clear • 0 objects detected',
              type: 'info'
            });
          } else {
            this.emitLog({
              level: 20,
              levelName: 'INFO',
              nodeName: 'nora_perception',
              message: `[On-Arm Camera Perception] Visual sweep active. Detected ${count} object(s) on frame: [${names}]. Executing clear workspace sequence...`
            });
            this.emitArmSpeech({
              message: `On-arm camera detected ${count} object${count > 1 ? 's' : ''} on frame: ${names}. Clearing workspace...`,
              subtext: `Live frame detection: ${count} objects found`,
              type: 'info'
            });
            if (intent.action === 'clean_table') {
              // Queue exactly what the camera saw, then a verification sweep, ahead of the final go_home
              const queued = currentTableItems.flatMap((o) => this.buildClearSteps(o.id, o.name));
              queued.push({
                id: Math.random().toString(36).substring(2, 7),
                skill: 'search_object',
                params: { target_object: 'tabletop_workspace', scan_mode: 'verification_survey' },
                status: 'pending',
                detail: '[Verification Sweep] On-arm camera re-scans the tabletop to confirm nothing is left',
                loopGroup: 'Perception Verification',
                targetObject: 'tabletop_workspace'
              });
              plan.splice(i + 1, 0, ...queued);
              this.notifyPipeline({ stage: 'EXECUTING', intent, affordances, plan: [...plan], activeStepId: step.id });
            }
          }
          step.status = 'completed';
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_skills',
            message: `[Skill] Step ${i + 1} (${step.skill}) completed successfully.`
          });
          continue;
        }

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
          const isCandidate = (o: TabletopObject) => {
            const oId = o.id.toLowerCase();
            const oName = o.name.toLowerCase();
            return catInfo.candidateIds.some(
              (c) => oId === c || oId.includes(c) || oName.includes(c) || o.shape === c
            );
          };
          let found: TabletopObject | undefined;

          this.emitPerceptionScan({ active: true, targetObject: catInfo.defaultId });
          await this.simulateJointMotion(step, intent, execId);
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
          await this.delay(450);
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;

          // Look with the wrist camera: only objects that appear in a rendered frame can be acquired.
          const seenCat = await this.visualSweep((id) => this.known().some((o) => o.id === id && isCandidate(o)), execId);
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
          found = this.known().find((o) => isCandidate(o) && seenCat.ids.has(o.id));

          if (!found) {
            this.emitPerceptionScan({ active: false, targetObject: catInfo.defaultId, detectedCount: seenCat.count, objectsOnFrame: seenCat.names });
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

            this.emitArmSpeech({
              message: `${catInfo.defaultName} was not found on the table`,
              subtext: `SayCan Guardrail • ${catInfo.defaultName} is not present on tabletop`,
              type: 'warning'
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
          const det = seenCat.byId[found.id];
          const pos = det ? det.position : found.position;
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_perception',
            message: `[Perception] Target acquired: ${found.name} (category: ${catInfo.category}). Recognised as ${det?.label ?? 'unknown'} (${Math.round((det?.confidence ?? 0) * 100)}% of nearest examples agree); mask ${det?.maskPixels ?? 0} px at ${(det?.depthM ?? 0).toFixed(2)} m depth; estimated position X ${pos.x.toFixed(3)} m, Y ${pos.y.toFixed(3)} m, Z ${pos.z.toFixed(3)} m.`
          });
          this.emitPerceptionScan({ active: false, targetObject: found.id, detectedPosition: pos, detectedCount: seenCat.count, objectsOnFrame: seenCat.names });

          // Update subsequent steps so they pick/deliver the detected item
          for (let j = i + 1; j < plan.length; j++) {
            if (plan[j].targetObject) {
              plan[j].targetObject = found.id;
            }
          }
        } else {
          // Direct item search
          const obj = this.normalizeObjectName(step.targetObject || intent.target_object);
          // The database entry says WHAT to look for. Whether it is on the table is for the camera to say.
          const candidate = this.known().find(
            (o) =>
              o.id === obj ||
              o.id === step.targetObject ||
              o.name.toLowerCase() === (step.targetObject || '').toLowerCase()
          );
          let found = candidate;
          let seenFirst: SeenSummary | null = null;
          const friendlyTarget = intent.parameters?.target_name || step.targetObject || 'target';

          if (candidate) {
            this.emitArmSpeech({ message: `Searching for ${candidate.name}...`, subtext: 'On-arm camera scan active', type: 'info' });
            this.emitPerceptionScan({ active: true, targetObject: obj });
            this.emitLog({
              level: 20,
              levelName: 'INFO',
              nodeName: 'nora_perception',
              message: `[Active Vision Search] Initiated visual search for [${candidate.name}] across tabletop workspace.`
            });
            await this.simulateJointMotion(step, intent, execId);
            if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
            await this.delay(450);
            if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
            seenFirst = await this.visualSweep((id) => id === candidate.id, execId);
            if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
            if (!seenFirst.ids.has(candidate.id)) found = undefined; // the camera did not find it: as far as the robot knows it is not there
          }

          if (!found) {
            // Object not present on table: perform scan and report missing cleanly without inventing objects
            this.emitArmSpeech({
              message: `Scanning tabletop workspace for ${friendlyTarget}...`,
              subtext: `On-arm camera search active`,
              type: 'info'
            });
            this.emitPerceptionScan({ active: true, targetObject: obj || step.targetObject });
            this.emitLog({
              level: 20,
              levelName: 'INFO',
              nodeName: 'nora_perception',
              message: `[Active Vision Search] Initiated visual search for [${friendlyTarget}] across tabletop workspace.`
            });
            if (!seenFirst) {
              await this.simulateJointMotion(step, intent, execId);
              if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
              await this.delay(450);
            }
            const seenAbsent: SeenSummary = seenFirst ?? (await this.visualSweep(() => false, execId, { exhaustive: true }));
            if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) return;
            this.emitPerceptionScan({ active: false, targetObject: obj || step.targetObject, detectedCount: seenAbsent.count, objectsOnFrame: seenAbsent.names });
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

            this.emitArmSpeech({
              message: `${friendlyTarget} was not found on the table`,
              subtext: `SayCan Guardrail • ${friendlyTarget} is not present on tabletop`,
              type: 'warning'
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

          // found implies the camera saw it (seenFirst is set whenever a database entry exists)
          const seenOne = seenFirst as SeenSummary;
          const det = seenOne.byId[found.id];
          const seenPos = det.position;
          if (det) {
            this.emitLog({
              level: 20,
              levelName: 'INFO',
              nodeName: 'nora_perception',
              message: `[Perception] Target acquired: [${found.name}]. Recognised as ${det.label} (${Math.round(det.confidence * 100)}% of nearest examples agree); mask ${det.maskPixels} px at ${det.depthM.toFixed(2)} m depth; estimated position X ${seenPos.x.toFixed(3)} m, Y ${seenPos.y.toFixed(3)} m, Z ${seenPos.z.toFixed(3)} m.`
            });
            this.emitArmSpeech({
              message: `Target acquired: [${found.name}] detected on table!`,
              subtext: `Recognised from RGB-D: ${det.label} • ${Math.round(det.confidence * 100)}% • ${det.depthM.toFixed(2)} m`,
              type: 'info'
            });
          } else {
            this.emitLog({
              level: 30,
              levelName: 'WARN',
              nodeName: 'nora_perception',
              message: `[Perception] [${found.name}] was not visible from any scan viewpoint (occluded or out of frame). Continuing with its last known position.`
            });
          }
          this.emitPerceptionScan({ active: false, targetObject: obj, detectedPosition: seenPos, detectedCount: seenOne.count, objectsOnFrame: seenOne.names });
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
      } else if (step.skill === 'pick') {
        const ok = await this.executePick(step, intent, execId);
        if (!ok && step.targetObject) this.ungraspable.add(step.targetObject);
        if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) {
          step.status = 'failed';
          return;
        }
        if (!ok) {
          const failedName = this.known().find((o) => o.id === this.normalizeObjectName(step.targetObject || intent.target_object))?.name ?? 'the object';
          this.emitLog({ level: 40, levelName: 'ERROR', nodeName: 'nora_gripper', message: `[Gripper] Could not grasp ${failedName} after 3 attempts.` });
          if (this.isLoopIntent(intent) && step.loopGroup) {
            // skip just this object and carry on with the rest
            for (let j = plan.length - 1; j > i; j--) if (plan[j].loopGroup === step.loopGroup) plan.splice(j, 1);
            await this.openGripper();
            step.status = 'failed';
            this.notifyPipeline({ stage: 'EXECUTING', intent, affordances, plan: [...plan], activeStepId: step.id });
            continue;
          }
          this.notifyPipeline({ stage: 'FAILED', intent, affordances, error: `Could not grasp ${failedName}: the gripper closed on nothing or the wrong object after 3 attempts.` });
          this.stateListeners.forEach((cb) => cb('FAILED'));
          setTimeout(() => {
            this.stateListeners.forEach((cb) => cb('IDLE'));
            this.returnHome();
          }, 3500);
          step.status = 'failed';
          return;
        }
      } else if (step.skill === 'open_gripper') {
        await this.openGripper();
      } else if (step.skill === 'close_gripper') {
        await this.closeGripper();
      } else {
        // Before reaching for an object, the robot must actually know where it is (from the camera).
        const reachTarget = this.normalizeObjectName(step.targetObject || intent.target_object);
        const poseName = step.params?.pose_name;
        const reachesForObject =
          step.skill === 'move_to_pose' &&
          reachTarget &&
          reachTarget !== 'tabletop_workspace' &&
          !this.gripHolding &&
          (poseName === 'pre_grasp' || (poseName === 'approach_target' && step.params?.target !== 'tray'));
        if (reachesForObject && !this.beliefPosition(reachTarget)) {
          this.emitLog({ level: 20, levelName: 'INFO', nodeName: 'nora_perception', message: '[Perception] No current sighting of the target: looking for it first.' });
          const got = await this.acquireTarget(reachTarget, execId);
          if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) {
            step.status = 'failed';
            return;
          }
          if (!got) {
            this.emitLog({ level: 40, levelName: 'ERROR', nodeName: 'nora_perception', message: '[Perception] The target could not be found. Stopping.' });
            if (this.isLoopIntent(intent) && step.loopGroup) {
              for (let j = plan.length - 1; j >= i; j--) if (plan[j].loopGroup === step.loopGroup) plan.splice(j, 1);
              this.notifyPipeline({ stage: 'EXECUTING', intent, affordances, plan: [...plan], activeStepId: step.id });
              i--;
              continue;
            }
            this.notifyPipeline({ stage: 'FAILED', intent, affordances, error: 'Lost track of the target: the camera cannot find it.' });
            this.stateListeners.forEach((cb) => cb('FAILED'));
            setTimeout(() => {
              this.stateListeners.forEach((cb) => cb('IDLE'));
              this.returnHome();
            }, 3500);
            step.status = 'failed';
            return;
          }
        }
        await this.simulateJointMotion(step, intent, execId);
      }

      if (this.isEStopped || this.isCancelled || execId !== this.currentExecutionId) {
        step.status = 'failed';
        return;
      }

      // (Attachment and release now happen physically inside executePick / closeGripper / openGripper.)
      if (step.skill === 'pick' && this.gripHolding && intent.action === 'clean_table') {
        const heldName = this.known().find((o) => o.id === this.gripHolding?.id)?.name ?? 'object';
        this.emitArmSpeech({ message: `Clearing ${heldName} to storage tray...`, subtext: `On-arm camera tracking [${heldName}]`, type: 'info' });
        this.emitLog({ level: 20, levelName: 'INFO', nodeName: 'nora_perception', message: `[On-Arm Camera] Tracking [${heldName}] for transfer to storage tray.` });
      }

      step.status = 'completed';
      this.emitLog({
        level: 20,
        levelName: 'INFO',
        nodeName: 'nora_skills',
        message: `[Skill] Step ${i + 1} (${step.skill}) completed successfully.`
      });

      // Objects that appear or remain during a clean are found by the verification sweep below, which uses the camera.
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

    if (intent.action === 'clean_table') {
      const remaining = this.lastSweepCount ?? 0; // what the last camera sweep saw
      if (remaining === 0) {
        this.emitArmSpeech({
          message: 'Tabletop fully clear! All objects safely stored in tray.',
          subtext: 'Perception verification: 0 objects on frame',
          type: 'info'
        });
        this.emitLog({
          level: 20,
          levelName: 'INFO',
          nodeName: 'nora_perception',
          message: '[On-Arm Camera Perception] Tabletop verification sweep: 0 objects remaining on table. All items transferred to tray.'
        });
      }
    }

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

    // 1. Dynamic Clean Table Intent Grounding: Always scan the live frame, never remember static initial objects
    const isCleanCommand =
      lower === 'clean table' ||
      lower === 'clean up the table' ||
      lower === 'clean up table' ||
      lower === 'clean up' ||
      lower === 'clean the table' ||
      lower.includes('clean table') ||
      lower.includes('clean up the table') ||
      lower.includes('clean up table') ||
      lower.includes('clean the table') ||
      lower.includes('clear table') ||
      lower.includes('clear the table') ||
      lower.includes('clear workspace') ||
      lower.includes('clean workspace') ||
      lower.includes('tidy table') ||
      lower.includes('tidy up table') ||
      lower.includes('empty table') ||
      lower.includes('empty the table');

    if (isCleanCommand) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'clean_table',
        target_object: 'all_objects',
        target_location: 'tray',
        parameters: {
          is_loop: true,
          loop_targets: [], // decided by the camera survey when the task runs
          loop_count: null,
          source: 'table',
          destination: 'tray',
          dynamic_frame_scan: true
        },
        confidence: 1.0
      };
    }

    // 2. Canned answers for the seed commands. Only used when the trained model could not be loaded;
    //    otherwise these phrases go through the model like everything else.
    const seed = this.nlu
      ? undefined
      : SEED_COMMANDS.find(
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
      if ((loop as any).missingConcept) {
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
            loop_keywords: [missingTarget],
            loop_count: null,
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
        target_object: loop.targets.length ? loop.targets.join(', ') : 'all_objects',
        target_location: loop.destination,
        parameters: {
          is_loop: true,
          loop_targets: loop.targets,
          loop_keywords: loop.keywords,
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

    // 5. Trained NLU model decides the action for natural-language commands.
    //    Simulator controls (clean/delete/scatter/loop), search and impossible-verb filters ran above;
    //    anything the model cannot ground to a concrete skill falls through to the rule parser below.
    const modelIntent = this.nlu && !this.looksLikeSearch(lower) ? this.intentFromTrainedModel(text) : null;
    if (modelIntent) return modelIntent;

    // 5b. Explicit Actuator / Pose Commands (rule fallback)
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

  public setPerceptionProvider(fn: (() => Promise<CameraFrame>) | null): void {
    this.perceptionProvider = fn;
    if (this.perceptionTimer) {
      clearInterval(this.perceptionTimer);
      this.perceptionTimer = null;
    }
    if (fn) {
      // The camera runs continuously like a real sensor: the belief is refreshed from every frame,
      // whether or not a command is running.
      this.perceptionTimer = setInterval(() => {
        if (this.perceiving || (typeof document !== 'undefined' && document.hidden)) return;
        void this.perceive().catch(() => undefined);
      }, 800);
    }
  }

  /** The believed position of an object, or null if the robot has not seen it (or has seen it gone). */
  /** The object database (what things are), with objects the camera currently believes are on the table first. */
  private known(): TabletopObject[] {
    const believed = this.catalogue.filter((o) => this.perceived[o.id]);
    return [...believed, ...this.catalogue.filter((o) => !this.perceived[o.id])];
  }

  private beliefPosition(id: string | null | undefined): { x: number; y: number; z: number } | null {
    if (!id) return null;
    const p = this.perceived[id];
    return p && Date.now() - p.stamp < 180000 ? p.position : null;
  }

  /** Believed positions of everything the robot thinks is on the table. */
  public getBelief(): { id: string; name: string; position: { x: number; y: number; z: number }; ageMs: number }[] {
    return Object.entries(this.perceived).map(([id, b]) => ({
      id,
      name: this.known().find((o) => o.id === id)?.name ?? id.replace(/_/g, ' '),
      position: b.position,
      ageMs: Date.now() - b.stamp
    }));
  }

  /**
   * Refresh the belief from one frame. Objects it recognised are updated. An object it believes is somewhere the
   * camera can clearly see, but where the camera sees bare table, is forgotten after two such frames.
   */
  private updateBelief(frame: CameraFrame, detections: Perceived[]): void {
    const now = Date.now();
    const seen = new Set<string>();
    for (const d of detections) {
      seen.add(d.id);
      const prev = this.perceived[d.id];
      if (d.truncated && prev) {
        // a cropped view only confirms an object it already has; it must not drag the position around
        prev.stamp = now;
        prev.misses = 0;
        continue;
      }
      this.perceived[d.id] = { position: d.position, stamp: now, misses: 0 };
    }

    const M = new THREE.Matrix4().compose(new THREE.Vector3(...frame.position), new THREE.Quaternion(...frame.quaternion), new THREE.Vector3(1, 1, 1));
    const inv = M.clone().invert();
    const rot = new THREE.Quaternion(...frame.quaternion);
    const { fx, fy, cx, cy } = frame.intrinsics;
    const tableY = this.robotBasePos.y;
    for (const [id, b] of Object.entries(this.perceived)) {
      if (seen.has(id)) continue;
      if (id === this.gripHolding?.id) {
        delete this.perceived[id];
        continue;
      }
      const p = new THREE.Vector3(b.position.x, tableY + 0.03, b.position.z).applyMatrix4(inv); // camera frame, looks down -Z
      const z = -p.z;
      if (z < 0.25) continue; // behind or too close to judge
      const u = cx + (p.x / z) * fx;
      const v = cy - (p.y / z) * fy;
      if (u < 14 || v < 14 || u > frame.width - 14 || v > frame.height - 14) continue; // not in view
      const depth = frame.depth[Math.round(v) * frame.width + Math.round(u)];
      const ray = new THREE.Vector3((u - cx) / fx, -(v - cy) / fy, -1).applyQuaternion(rot);
      if (ray.y > -1e-3) continue;
      const tableDepth = (tableY - frame.position[1]) / ray.y; // distance along the optical axis to bare table
      if (depth > 0 && Math.abs(depth - tableDepth) < 0.012) {
        b.misses = (b.misses ?? 0) + 1;
        if (b.misses >= 2) {
          delete this.perceived[id];
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_perception',
            message: `[Perception] ${this.known().find((o) => o.id === id)?.name ?? id} is no longer where it was last seen: the camera sees bare table there. Forgetting it.`
          });
        }
      }
    }
  }

  /** What the wrist camera sees right now. Falls back to the object list only if no camera is attached. */
  private async perceive(): Promise<{
    detections: Perceived[];
    byId: Record<string, Perceived>;
    ids: Set<string>;
    names: string[];
    count: number;
  }> {
    this.perceiving = true;
    try {
    let detections: Perceived[] = [];
    let frame: CameraFrame | null = null;
    if (this.perceptionProvider) {
      try {
        frame = await this.perceptionProvider();
      } catch (err) {
        this.emitLog({
          level: 40,
          levelName: 'ERROR',
          nodeName: 'nora_perception',
          message: `[Perception] Camera pipeline failed (${err instanceof Error ? err.message : String(err)}). The robot cannot see until it recovers.`
        });
      }
    }
    if (frame) {
      // The camera names what it sees (kind + colour) from pixels; matching that to an entry in the
      // object database is a separate step. Held objects are in the gripper, not on the table.
      const registry = this.known()
        .filter((o) => o.id !== this.gripHolding?.id)
        .map((o) => ({ id: o.id, name: o.name, shape: o.shape, color: o.color }));
      const lastSeen = Object.fromEntries(Object.entries(this.perceived).map(([id, p]) => [id, { x: p.position.x, z: p.position.z }]));
      const matched = associate(frame.detections, registry, lastSeen);
      detections = matched.filter((m) => m.id).map((m) => ({ ...m.rec, id: m.id as string }));
      this.updateBelief(frame, detections);
    } else {
      this.emitLog({
        level: 40,
        levelName: 'ERROR',
        nodeName: 'nora_perception',
        message: '[Perception] No camera frame available: the robot cannot see the table.'
      });
      detections = [];
    }
    return this.summarizePerception(detections);
    } finally {
      this.perceiving = false;
    }
  }

  private summarizePerception(detections: Perceived[]) {
    const byId: Record<string, Perceived> = {};
    // keep the better view of each object: a complete one beats a cropped one, then the larger mask
    const better = (a: Perceived, b: Perceived) => (a.truncated === b.truncated ? a.maskPixels > b.maskPixels : !a.truncated);
    for (const d of detections) if (!byId[d.id] || better(d, byId[d.id])) byId[d.id] = d;
    const ids = new Set(Object.keys(byId));
    const names = [...ids].map((id) => this.known().find((o) => o.id === id)?.name ?? id);
    return { detections: Object.values(byId), byId, ids, names, count: ids.size };
  }

  /**
   * Look at the table from the current pose; if `wanted` is not (all) in view, move the camera to further
   * overhead poses and merge what each frame sees. Stops early once every wanted object has been seen.
   */
  private async visualSweep(
    wanted: (id: string) => boolean,
    execId?: number,
    opts: { exhaustive?: boolean } = {}
  ) {
    let seen = await this.perceive();
    const satisfied = () => !opts.exhaustive && seen.detections.some((d) => wanted(d.id));
    if (satisfied()) return seen;

    const base = this.robotBasePos;
    const viewpoints: [number, number][] = [
      [0.1, 0.0],
      [0.3, 0.16],
      [-0.05, 0.2],
      [0.3, -0.16],
      [-0.05, -0.2]
    ];
    for (const [cx, cz] of viewpoints) {
      if (this.isEStopped || this.isCancelled || (execId && execId !== this.currentExecutionId)) return seen;
      const pose = [...this.solveDynamicIK(cx, base.y + 0.45, cz), this.currentJointPositions[6]];
      await this.moveAlongPlan(pose, this.buildCollisionWorld(null), {
        execId,
        frameMs: 30,
        abortable: true,
        label: 'scan_viewpoint'
      });
      await this.delay(180);
      const next = await this.perceive();
      seen = this.summarizePerception([...seen.detections, ...next.detections]);
      if (satisfied()) break;
    }
    return seen;
  }

  private looksLikeSearch(lower: string): boolean {
    return (
      lower.startsWith('search') ||
      lower.startsWith('find') ||
      lower.startsWith('where is') ||
      lower.startsWith('scan for') ||
      lower.startsWith('locate') ||
      lower.startsWith('detect') ||
      lower.includes('search for') ||
      lower.includes('find the') ||
      lower.includes('scan the')
    );
  }

  /** Resolve the object a command refers to: the user's words first, then the model's target. */
  private groundTarget(text: string, modelObject: string | null): { id: string; name: string } | null {
    const hint = modelObject ? modelObject.replace(/_/g, ' ') : null;
    const obj = this.findObjectFromText(text) ?? (hint ? this.findObjectFromText(hint) : null);
    if (obj) return { id: obj.id, name: obj.name };
    const concept = this.getConceptForText(text) ?? (hint ? this.getConceptForText(hint) : null);
    if (concept) {
      const id = concept.id === 'tennis' ? 'tennis_ball' : concept.id === 'coffee' ? 'coffee_mug' : concept.id;
      return { id, name: concept.defaultName };
    }
    const normalized = this.normalizeObjectName(text) ?? this.normalizeObjectName(modelObject);
    if (normalized) return { id: normalized, name: normalized.replace(/_/g, ' ') };
    // A recognised object that is not on the table: keep it so the missing-object guardrail can offer to place it.
    if (modelObject) return { id: modelObject, name: hint as string };
    return null;
  }

  /** Map a trained-model prediction to the simulator's intent schema; null = let the rule parser decide. */
  private intentFromTrainedModel(text: string): Intent | null {
    const pred = this.nlu?.predict(text);
    if (!pred) return null;
    const base = {
      version: '1.0',
      command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
      raw_text: text,
      confidence: pred.confidence
    };
    const meta = { nlu_source: 'trained_model', nlu_action: pred.action };

    switch (pred.action) {
      case 'explicit_blocked':
        return {
          ...base,
          action: 'explicit_blocked',
          target_object: null,
          target_location: null,
          parameters: { ...meta, reason: 'Cannot process explicit words.', error: 'Cannot process explicit words.', is_explicit: true },
          confidence: 0
        };
      case 'go_home':
      case 'open_gripper':
      case 'close_gripper':
        return { ...base, action: pred.action, target_object: null, target_location: null, parameters: meta };
      case 'pick':
      case 'place': {
        const lower = text.toLowerCase();
        const target = this.groundTarget(text, pred.target_object);
        if (!target) return null;
        const params = { ...meta, ...pred.parameters, target_name: target.name };
        if (pred.action === 'pick') {
          const handover =
            pred.target_location === 'user' ||
            /(give|hand|pass|bring|fetch|serve|get me)/.test(lower);
          return handover
            ? { ...base, action: 'deliver_to_user', target_object: target.id, target_location: 'user', parameters: { ...params, activity_context: text } }
            : { ...base, action: 'pick', target_object: target.id, target_location: 'table', parameters: params };
        }
        const dest = lower.includes('table') || pred.target_location === 'table' ? 'table' : pred.target_location === 'user' ? 'user' : 'tray';
        return { ...base, action: 'place', target_object: target.id, target_location: dest, parameters: params };
      }
      default:
        // move_to_pose and unknown are not simulator skills
        return null;
    }
  }

  public detectLoopIntent(text: string): {
    isLoop: boolean;
    targets: string[];
    keywords: string[];
    count: number | null;
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
      'loop', 'repeat', 'again', 'iterate', 'objects', 'items', 'stuff', 'pieces', 'blocks',
      'move', 'carry', 'transfer', 'storage', 'tote', 'bin', 'rack', 'rerack', 'back', 'return', 'clean', 'clear',
      'tidy', 'empty', 'workspace', 'them', 'these', 'those', 'onto', 'out', 'away', 'everything', 'entire'
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
      for (const obj of this.known()) {
        const matched = this.objectMatches(obj, [...targetKeywords]);

        if (matched && !extractedTargets.includes(obj.id)) {
          extractedTargets.push(obj.id);
        }
      }
    } else {
      // No specific object name was given (e.g. "clean table", "clear all", "rerack all items")
      for (const obj of this.known()) {
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
    if (hasSpecificObjectFilter && (extractedTargets.length > 0 || !(isClean || isRerack || hasAllGeneral))) {
      finalTargets = extractedTargets;
      if (finalTargets.length === 0) {
        // Specific item requested (e.g. "apples"), but 0 exist on the tabletop!
        // Do NOT pick random objects or defaults. Flag missing concept for SayCan guardrail.
        const missing = Array.from(targetKeywords).find((k) => targetKeywords.has(getStem(k)) && getStem(k) === k) || Array.from(targetKeywords)[0] || 'requested objects';
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
      finalTargets = []; // "everything": the camera survey decides what that is
    } else {
      finalTargets = extractedTargets;
    }

    // Determine count
    const finalCount = count !== null ? Math.max(1, count) : null; // null = every matching object the camera finds
    // Words that name a kind of object in the database; the survey matches what it sees against these.
    const finalKeywords = finalTargets.length
      ? [...targetKeywords].filter((kw) => this.known().some((o) => this.objectMatches(o, [kw])))
      : [];

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
      keywords: finalKeywords,
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

    const isHoldingObject = this.gripHolding !== null;

    const isLoopAction =
      Boolean(intent.parameters?.is_loop) ||
      ['clean_table', 'rerack_table', 'loop_task'].includes(intent.action);

    // Dynamic Kinematic Reachability & Tabletop Presence Grounding
    let targetDistFromBase: number | null = null;
    let targetExistsOnTable = false;
    let planTarget: TabletopObject | null = null;
    const targetObjName = intent.target_object;
    if (targetObjName && targetObjName !== 'null' && targetObjName !== 'none') {
      let foundObj =
        this.findObjectFromText(targetObjName) ||
        this.known().find(
          (o) =>
            o.id.toLowerCase() === targetObjName.toLowerCase() ||
            o.name.toLowerCase() === targetObjName.toLowerCase()
        );

      if (!foundObj) {
        const cat = CATEGORY_SEARCH_MAP[targetObjName.toLowerCase()];
        if (cat) {
          foundObj = this.known().find((o) => {
            const oId = o.id.toLowerCase();
            const oName = o.name.toLowerCase();
            return cat.candidateIds.some((c) => oId === c || oId.includes(c) || oName.includes(c) || o.shape === c);
          });
        }
      }

      // "On the table" means the robot has seen it there. If it has not looked yet, active perception comes first.
      const believedPos = foundObj ? this.beliefPosition(foundObj.id) : null;
      if (foundObj && believedPos) {
        targetExistsOnTable = true;
        planTarget = { ...foundObj, position: { ...foundObj.position, ...believedPos } };
        targetDistFromBase = Math.hypot(believedPos.x - this.robotBasePos.x, believedPos.z - this.robotBasePos.z);
      }
    }
    const isTargetOutOfReach =
      planTarget !== null &&
      !checkReach(planTarget.position.x, Math.max(planTarget.position.y, this.robotBasePos.y + GRASP_MIN_TCP_HEIGHT), planTarget.position.z, this.robotBasePos).reachable;
    const isTargetMissing = Boolean(
      targetObjName &&
      targetObjName !== 'none' &&
      targetObjName !== 'all_objects' &&
      targetObjName !== 'all' &&
      targetObjName !== 'tabletop_workspace' &&
      !isLoopAction &&
      intent.action !== 'clean_table' &&
      !targetExistsOnTable
    );

    // Real motion check: can the arm reach the pre-grasp pose and descend to the object without hitting anything?
    const approach = planTarget && !isTargetOutOfReach ? this.assessApproach(planTarget) : null;

    const results: AffordanceScore[] = candidateSkills.map((skill) => {
      let usefulness = 0.15;
      let reachability = 0.94;
      let collision_free = 0.96;
      let object_state = 0.98;

      // Active Perception Grounding: Do not assume precondition failure upfront.
      // The robot arm always schedules and executes an on-arm camera search first!
      if (isTargetMissing) {
        if (skill === 'search_object') {
          reachability = 0.95;
          collision_free = 0.98;
          object_state = 0.95;
        } else if (['pick', 'deliver_to_user', 'place', 'move_to_pose'].includes(skill)) {
          reachability = 0.94;
          collision_free = 0.96;
          object_state = 0.90;
        }
      } else if (targetDistFromBase !== null) {
        if (isTargetOutOfReach) {
          if (['pick', 'deliver_to_user', 'place', 'move_to_pose'].includes(skill)) {
            // IK cannot reach the target (verified through forward kinematics): drop reachability to trigger the SayCan guardrail
            reachability = 0.05;
            collision_free = 0.30;
          }
        } else {
          reachability = Math.min(0.99, Math.max(0.78, 0.98 - (targetDistFromBase / MAX_TABLE_REACH) * 0.10));
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
          if (!isTargetOutOfReach) {
            reachability = 0.95;
            collision_free = 0.97;
            object_state = 0.98;
          }
        } else if (skill === 'deliver_to_user') {
          if (!isTargetOutOfReach) {
            reachability = 0.94;
            collision_free = 0.96;
            object_state = 0.97;
          }
        } else if (skill === 'search_object') {
          reachability = 0.99;
          collision_free = 0.99;
          object_state = 0.99;
        }
      }

      // Collision feasibility comes from the planner, not a constant
      if (approach && ['pick', 'deliver_to_user', 'move_to_pose'].includes(skill)) {
        collision_free = Math.min(collision_free, approach.score);
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

  /** Pick one object and store it in the tray. It begins with a fresh camera check, so a vanished object is skipped. */
  private buildClearSteps(objId: string, name: string, tag = 'Clear'): PlanStep[] {
    return this.buildTransferSteps(objId, name, 'table', 'tray', tag);
  }

  /**
   * Move one object from where the camera saw it to a destination: look at it again, grasp with feedback, carry,
   * put it down, let go. A vanished object is skipped by the first step; a failed grasp skips the rest of the group.
   */
  private buildTransferSteps(
    objId: string,
    name: string,
    source: 'table' | 'tray',
    destination: 'tray' | 'table' | 'user',
    tag?: string
  ): PlanStep[] {
    const id = () => Math.random().toString(36).substring(2, 7);
    const verb = tag ?? (source === 'tray' ? 'Re-rack' : destination === 'user' ? 'Deliver' : destination === 'table' ? 'Move' : 'Clear');
    const label = `${verb}: ${name}`;
    const base = { status: 'pending' as const, loopGroup: label, targetObject: objId };
    const from = source === 'tray' ? 'the storage tote' : 'the table';
    const steps: PlanStep[] = [
      { id: id(), skill: 'search_object', params: { target_object: objId, scan_mode: 'target_check' }, detail: `[${label}] Look at ${name} before reaching for it`, ...base },
      { id: id(), skill: 'move_to_pose', params: { pose_name: 'pre_grasp', target: objId }, detail: `[${label}] Align end-effector above ${name} in ${from}`, ...base },
      { id: id(), skill: 'open_gripper', params: { stroke_mm: 80 }, detail: `[${label}] Open gripper fingers`, ...base },
      { id: id(), skill: 'pick', params: { target_object: objId }, detail: `[${label}] Descend to ${name} and grasp`, ...base },
      { id: id(), skill: 'move_to_pose', params: { pose_name: 'lift', target: objId }, detail: `[${label}] Lift ${name} clear`, ...base }
    ];
    if (destination === 'tray') {
      steps.push(
        { id: id(), skill: 'move_to_pose', params: { pose_name: 'approach_target', target: 'tray' }, detail: `[${label}] Carry ${name} to the storage tote`, ...base },
        { id: id(), skill: 'place', params: { target_location: 'tray', target_object: objId }, detail: `[${label}] Lower ${name} into the tote`, ...base }
      );
    } else if (destination === 'user') {
      steps.push(
        { id: id(), skill: 'move_to_pose', params: { pose_name: 'handover', target: 'user' }, detail: `[${label}] Carry ${name} to the handover mat`, ...base },
        { id: id(), skill: 'place', params: { target_location: 'user', target_object: objId }, detail: `[${label}] Lower ${name} onto the handover mat`, ...base }
      );
    } else {
      steps.push(
        { id: id(), skill: 'move_to_pose', params: { pose_name: 'table_spot', target: 'table' }, detail: `[${label}] Carry ${name} to a free spot on the table`, ...base },
        { id: id(), skill: 'place', params: { target_location: 'table', target_object: objId }, detail: `[${label}] Lower ${name} onto the table`, ...base }
      );
    }
    steps.push({ id: id(), skill: 'open_gripper', params: { stroke_mm: 80 }, detail: `[${label}] Release grip`, ...base });
    return steps;
  }

  private isLoopIntent(intent: Intent): boolean {
    return Boolean(intent.parameters?.is_loop) || ['clean_table', 'rerack_table', 'loop_task'].includes(intent.action);
  }

  /** Does a database entry fit any of the words the user used ("balls", "cups", ...)? No words = anything fits. */
  private objectMatches(obj: TabletopObject, keywords: string[]): boolean {
    if (!keywords.length) return true;
    const SYNONYMS: Record<string, string[]> = {
      cup: ['mug', 'glass'], drink: ['glass', 'mug', 'can', 'water', 'coffee', 'soda'], beverage: ['glass', 'mug', 'can'],
      fruit: ['apple', 'orange', 'banana'], food: ['apple', 'orange', 'banana'], ball: ['ball', 'sphere'],
      stationery: ['pen', 'pencil', 'ruler', 'eraser', 'stapler', 'scissors', 'notebook', 'book'],
      toy: ['ball', 'cube', 'block'], block: ['cube', 'box'], bottle: ['can', 'cylinder']
    };
    keywords = [...new Set(keywords.flatMap((k) => [k, ...(SYNONYMS[k] ?? [])]))];
    const nameL = obj.name.toLowerCase();
    const idL = obj.id.toLowerCase();
    const shapeL = obj.shape.toLowerCase();
    const nameTokens = nameL.split(/[^a-z0-9]+/);
    const idTokens = idL.split(/[^a-z0-9]+/);
    return keywords.some((kw) => nameTokens.includes(kw) || idTokens.includes(kw) || shapeL === kw || nameL.includes(kw) || idL.includes(kw));
  }

  /**
   * Objects the camera saw in one part of the workspace, judged only from where it saw them
   * (the tote gets a small margin, since things lean on its walls).
   */
  private seenIn(seen: SeenSummary, region: RestRegion): { id: string; name: string }[] {
    const regionOf = (x: number, z: number): RestRegion => {
      const m = 0.025;
      if (x >= TOTE.x0 - m && x <= TOTE.x1 + m && z >= TOTE.z0 - m && z <= TOTE.z1 + m) return 'tray';
      const i = 0.03; // the mat counts only when the object is clearly on it
      if (x > MAT.x0 + i && x < MAT.x1 - i && z > MAT.z0 + i && z < MAT.z1 - i) return 'user';
      return 'table';
    };
    return seen.detections
      .filter((d) => regionOf(d.position.x, d.position.z) === region)
      .map((d) => ({ id: d.id, name: this.known().find((o) => o.id === d.id)?.name ?? d.id.replace(/_/g, ' ') }));
  }

  private buildGeneralizedLoopPlan(intent: Intent): PlanStep[] {
    const id = () => Math.random().toString(36).substring(2, 7);
    const isCleanTable = intent.action === 'clean_table';
    const park: PlanStep = { id: id(), skill: 'go_home', params: {}, status: 'pending', detail: 'Retract arm to the home pose' };

    // Clean table: look, then park. The survey queues a pick-and-place for every object it actually sees.
    if (isCleanTable) {
      return [
        {
          id: id(),
          skill: 'search_object',
          params: { target_object: 'tabletop_workspace', scan_mode: 'frame_survey' },
          status: 'pending',
          detail: '[Visual Survey] On-arm camera sweeps the tabletop; objects it sees are queued for clearing',
          targetObject: 'tabletop_workspace'
        },
        park
      ];
    }

    // Loops and re-rack: the same. Which objects, and how many, is decided by the camera when the survey runs.
    const isRerack = intent.action === 'rerack_table';
    const source: 'table' | 'tray' = intent.parameters?.source || (isRerack ? 'tray' : 'table');
    const destination: 'tray' | 'table' | 'user' = intent.parameters?.destination || (isRerack ? 'table' : 'tray');
    const keywords: string[] = intent.parameters?.loop_keywords ?? [];
    const count: number | null = intent.parameters?.loop_count ?? null;
    const where = source === 'tray' ? 'storage tote' : 'tabletop';
    return [
      {
        id: id(),
        skill: 'search_object',
        params: { target_object: 'tabletop_workspace', scan_mode: 'loop_survey', source, destination, keywords, count, round: 0 },
        status: 'pending',
        detail: `[Visual Survey] On-arm camera looks at the ${where} for ${keywords.length ? keywords.join(' / ') : 'every object'}; what it sees is queued`,
        targetObject: 'tabletop_workspace'
      },
      park
    ];
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
          detail: `Active RGB-D visual search & segmentation scan for ${friendlyName} (no prior coordinates assumed)`,
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
          detail: `Active RGB-D visual sweep & target localisation for ${friendlyName}`,
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
          detail: `Active RGB-D visual search & segmentation scan for ${friendlyName} (no prior coordinates assumed)`,
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
      const isHoldingObject = this.gripHolding !== null;

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

  // Closed-form IK for the UR5e-style arm, tool pointing straight down (see sim/kinematics.ts).
  // Returns [shoulder_pan, shoulder_lift, elbow, wrist1, wrist2, wrist3].
  public solveDynamicIK(tx: number, ty: number, tz: number): number[] {
    return solveIK(tx, ty, tz, this.robotBasePos);
  }

  // Calculate target joint angles dynamically for each skill step
  private getTargetPositionsForSkill(skill: string, step: PlanStep, intent: Intent): number[] {
    const curr = [...this.currentJointPositions];
    const targetObj = (step.targetObject || intent.target_object || '').toLowerCase();
    const normObj = this.normalizeObjectName(targetObj);
    const resolvedObj = normObj ? this.known().find((o) => o.id === normObj || o.name.toLowerCase().includes(normObj)) : null;
    // The robot only knows where things are from what its camera has seen. With no belief it holds position.
    const here = tcpPosition(curr.slice(0, 6), this.robotBasePos);
    const believed = resolvedObj ? this.beliefPosition(resolvedObj.id) : null;
    const objPos = believed ?? { x: here.x, y: here.y - 0.12, z: here.z };
    const poseName = step.params?.pose_name || '';

    if (skill === 'search_object') {
      if (step.params?.scan_mode === 'frame_survey' || step.targetObject === 'tabletop_workspace') {
        // Wide-angle overhead scan pose with on-arm camera surveying entire tabletop workspace
        // Raised pose with the camera tilted ~45 degrees down toward the table centre
        // (pan offset compensates for the wrist sitting off the arm plane)
        return [-0.33, -0.3, 1.3, Math.PI / 4 - 1.0, -Math.PI / 2, 0.0, curr[6]];
      }
      if (!believed) return [-0.33, -0.3, 1.3, Math.PI / 4 - 1.0, -Math.PI / 2, 0.0, curr[6]]; // nothing to look toward yet: survey pose
      const dx = objPos.x - this.robotBasePos.x;
      const dz = objPos.z - this.robotBasePos.z;
      const yaw = Math.atan2(-dz, dx);
      // Look toward the target with the camera tilted ~70 degrees down
      return [yaw - 0.3, -0.2, 1.45, 1.2 - 1.25, -Math.PI / 2, 0.0, curr[6]];
    }

    if (skill === 'move_to_pose') {
      if (poseName === 'pre_grasp') {
        const sol = this.solveDynamicIK(objPos.x, objPos.y + 0.12, objPos.z);
        return [...sol, curr[6]];
      } else if (poseName === 'lift') {
        if (this.gripHolding) {
          // carrying something: lift straight up from where the tool is
          const up = this.solveDynamicIK(here.x, Math.max(here.y + 0.1, this.robotBasePos.y + 0.2), here.z);
          return [...up, curr[6]];
        }
        const sol = this.solveDynamicIK(objPos.x, objPos.y + 0.16, objPos.z);
        return [...sol, curr[6]];
      } else if (poseName === 'handover') {
        // To the handover mat, over a part of it that the camera believes is free
        const spot = this.nextMatSpot();
        const sol = this.solveDynamicIK(spot.x, this.handoverPos.y, spot.z);
        return [...sol, curr[6]];
      } else if (poseName === 'table_spot') {
        // carrying something back to the table: above a free spot, chosen from what the camera believes is there
        const spot = this.nextTableSpot();
        const sol = this.solveDynamicIK(spot.x, this.robotBasePos.y + 0.16, spot.z);
        return [...sol, curr[6]];
      } else if (poseName === 'approach_target') {
        const isTray = step.params?.target === 'tray' || intent.target_location === 'tray';
        if (isTray) {
          const slot = this.nextToteSlot();
          const sol = this.solveDynamicIK(slot.x, Math.max(this.robotBasePos.y + 0.14, this.toteStackTop(slot) + 0.14), slot.z);
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
      const sol = this.solveDynamicIK(objPos.x, Math.max(objPos.y, this.robotBasePos.y + GRASP_MIN_TCP_HEIGHT), objPos.z);
      return [...sol, GRIPPER_MAX_OPEN]; // descend with the fingers open; closing is a separate, physical act
    }

    if (skill === 'place') {
      const loc = step.params?.target_location;
      if (loc === 'table' || loc === 'user') {
        // lower until the held object is just above the surface under the tool (table or handover mat), still holding
        const heldEntry = this.gripHolding ? this.known().find((o) => o.id === this.gripHolding?.id) : undefined;
        const half = heldEntry ? OBJECT_HEIGHT[objectKind(heldEntry)] / 2 : 0.04;
        const surface = this.robotBasePos.y + (loc === 'user' ? MAT.top : 0);
        const sol = this.solveDynamicIK(here.x, Math.max(surface + half, this.robotBasePos.y + GRASP_MIN_TCP_HEIGHT) + 0.012, here.z);
        return [...sol, curr[6]]; // keep holding until the release step
      } else {
        const slot = this.nextToteSlot();
        // release just above whatever is already piled there
        const sol = this.solveDynamicIK(slot.x, Math.max(this.robotBasePos.y + 0.06, this.toteStackTop(slot) + 0.05), slot.z);
        return [...sol, curr[6]]; // keep holding until the release step
      }
    }

    if (skill === 'open_gripper') {
      return [curr[0], curr[1], curr[2], curr[3], curr[4], curr[5], GRIPPER_MAX_OPEN];
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

  /** Plan home->pre-grasp->grasp for an object and turn the result into a 0..1 collision-free score. */
  private assessApproach(obj: TabletopObject): { score: number; clearance: number | null; detail: string } {
    const base = this.robotBasePos;
    const gy = Math.max(obj.position.y, base.y + GRASP_MIN_TCP_HEIGHT);
    const world = this.buildCollisionWorld(obj.id);
    const start = this.currentJointPositions.slice(0, 6);
    const pre = solveIK(obj.position.x, gy + 0.12, obj.position.z, base);
    const grasp = solveIK(obj.position.x, gy, obj.position.z, base);

    const toPre = planJointPath(start, pre, base, world);
    const descend = toPre.ok ? planJointPath(pre, grasp, base, world) : toPre;
    const ok = toPre.ok && descend.ok;
    const clearance = ok ? Math.min(toPre.minClearance, descend.minClearance) : null;
    const score = ok ? 0.8 + 0.19 * Math.min(1, Math.max(0, (clearance as number) / 0.02)) : 0.1;
    const detail = ok
      ? `min clearance ${((clearance as number) * 1000).toFixed(0)} mm`
      : (toPre.ok ? descend.reason : toPre.reason) ?? 'blocked';

    this.emitLog({
      level: ok ? 20 : 30,
      levelName: ok ? 'INFO' : 'WARN',
      nodeName: 'motion_planner',
      message: `[Planner] Approach check for "${obj.name}": ${ok ? 'collision-free path found' : 'NO collision-free approach'} (${detail})`
    });
    return { score, clearance, detail };
  }

  /** Collision world built from the robot's BELIEF about the table (not from the simulator's object list). */
  private buildCollisionWorld(allowRaw?: string | null): CollisionWorld {
    const resolved = allowRaw
      ? this.findObjectFromText(allowRaw) ?? this.known().find((o) => o.id === allowRaw)
      : null;
    return buildWorld(
      Object.entries(this.perceived)
        .filter(([id]) => id !== this.gripHolding?.id)
        .map(([id, b]) => ({ id, x: b.position.x, y: b.position.y, z: b.position.z, held: false })),
      { allowId: resolved?.id ?? null, tableTopY: this.robotBasePos.y }
    );
  }

  /** Height of the pile at a tote slot, from what the robot believes is there. */
  private toteStackTop(slot: { x: number; z: number }): number {
    let top = this.robotBasePos.y + 0.005;
    for (const [id, b] of Object.entries(this.perceived)) {
      if (Math.hypot(b.position.x - slot.x, b.position.z - slot.z) >= 0.045) continue;
      const entry = this.known().find((o) => o.id === id);
      const h = entry ? OBJECT_HEIGHT[objectKind(entry)] : 0.06;
      top = Math.max(top, b.position.y + h / 2);
    }
    return top;
  }

  /** Where on the handover mat to put the next thing: the centre, or the free part of it furthest from what is there. */
  private nextMatSpot(): { x: number; z: number } {
    if (!this.tableSpot) {
      const onMat = Object.entries(this.perceived)
        .filter(([id]) => id !== this.gripHolding?.id)
        .map(([, b]) => b.position)
        .filter((p) => dropRegion(p.x, p.z) === 'user');
      const centre = { x: this.handoverPos.x, z: this.handoverPos.z };
      let best = centre;
      let bestScore = -Infinity;
      for (let x = MAT.x0 + 0.04; x <= MAT.x1 - 0.04; x += 0.02) {
        for (let z = MAT.z0 + 0.04; z <= MAT.z1 - 0.04; z += 0.02) {
          if (!checkReach(x, this.robotBasePos.y + 0.04, z, this.robotBasePos).reachable) continue;
          const gap = onMat.length ? Math.min(...onMat.map((p) => Math.hypot(p.x - x, p.z - z))) : 1;
          const score = Math.min(gap, 0.1) * 10 - Math.hypot(x - centre.x, z - centre.z);
          if (score > bestScore) {
            bestScore = score;
            best = { x: Number(x.toFixed(3)), z: Number(z.toFixed(3)) };
          }
        }
      }
      this.tableSpot = best;
      this.emitLog({ level: 20, levelName: 'INFO', nodeName: 'motion_planner', message: `[Planner] Handover spot (${best.x.toFixed(2)}, ${best.z.toFixed(2)}) chosen; ${onMat.length} object(s) believed on the mat.` });
    }
    return this.tableSpot;
  }

  /** A free spot on the table for something the robot is putting back, judged from what the camera believes is there. */
  private nextTableSpot(): { x: number; z: number } {
    if (!this.tableSpot) {
      const taken = Object.entries(this.perceived)
        .filter(([id]) => id !== this.gripHolding?.id)
        .map(([, b]) => b.position);
      this.tableSpot = this.findFreeSpot({ x: 0.18, z: 0.02 }, taken, true);
    }
    return this.tableSpot;
  }

  /** Where to put the next object in the tote: the free spot furthest from what the robot believes is already there. */
  private nextToteSlot(): { x: number; z: number } {
    if (!this.toteSlot) {
      const occupied = Object.values(this.perceived)
        .map((b) => b.position)
        .filter((p) => dropRegion(p.x, p.z) === 'tray');
      this.toteSlot = chooseToteSlot(occupied);
    }
    return this.toteSlot;
  }

  // ---------------------------------------------------------------------------------------------
  // Gripper. The robot commands motion; the WORLD decides what physically happens. The robot only learns the
  // outcome through the finger-stroke sensor and its camera.
  // ---------------------------------------------------------------------------------------------

  /** Close the fingers. Returns what the stroke sensor reports (holding + width); width 0 = closed on nothing. */
  private async closeGripper(): Promise<{ holding: boolean; width: number }> {
    const tcp = tcpPosition(this.currentJointPositions.slice(0, 6), this.robotBasePos);
    const opening = this.currentJointPositions[6];
    // --- the world's response ---
    const hit = findGraspedObject(
      { x: tcp.x, y: tcp.y, z: tcp.z },
      this.tabletopObjects
        .filter((o) => o.state !== 'held')
        .map((o) => ({ id: o.id, kind: objectKind(o), x: o.position.x, y: o.position.y, z: o.position.z })),
      opening
    );
    const end = hit ? hit.width : 0;
    for (let f = 1; f <= 10; f++) {
      const ease = (1 - Math.cos((f / 10) * Math.PI)) / 2;
      this.currentJointPositions[6] = opening + (end - opening) * ease;
      this.publishJointState();
      await this.motionSleep(35);
    }
    if (hit) {
      const obj = this.tabletopObjects.find((o) => o.id === hit.id);
      if (obj) {
        this.objectRestY[obj.id] ??= obj.position.y;
        obj.state = 'held';
        this.emitObjectEvent({ name: obj.id, state: 'held' });
      }
      this.gripHolding = { id: hit.id, width: hit.width };
      delete this.perceived[hit.id]; // it is in the hand now, not on the table
    }
    return { holding: Boolean(hit), width: end };
  }

  /** Open the fingers. Anything held is released and falls to the surface below the tool. */
  private async openGripper(): Promise<void> {
    const start = this.currentJointPositions[6];
    for (let f = 1; f <= 10; f++) {
      const ease = (1 - Math.cos((f / 10) * Math.PI)) / 2;
      this.currentJointPositions[6] = start + (GRIPPER_MAX_OPEN - start) * ease;
      this.publishJointState();
      await this.motionSleep(30);
    }
    const held = this.gripHolding;
    this.gripHolding = null;
    this.toteSlot = null;
    this.tableSpot = null;
    if (!held) return;
    // --- the world's response: gravity ---
    const obj = this.tabletopObjects.find((o) => o.id === held.id);
    if (!obj) return;
    const tcp = tcpPosition(this.currentJointPositions.slice(0, 6), this.robotBasePos);
    const region = dropRegion(tcp.x, tcp.z);
    // gravity: it falls until it meets the surface, or whatever is already lying there
    const ownRestY = this.objectRestY[obj.id] ?? obj.position.y;
    const ownHalf = ownRestY - this.robotBasePos.y;
    const below = this.tabletopObjects
      .filter((o) => o.id !== obj.id && o.state !== 'held')
      .map((o) => ({ x: o.position.x, z: o.position.z, y: o.position.y, height: OBJECT_HEIGHT[objectKind(o)] }));
    const dropX = Number(tcp.x.toFixed(3));
    const dropZ = Number(tcp.z.toFixed(3));
    const pos = { x: dropX, y: settleHeight(this.robotBasePos.y + restLift(region), ownHalf, dropX, dropZ, below), z: dropZ };
    obj.state = region;
    obj.position = pos;
    this.objectPositions[obj.id] = pos;
    // The robot knows where it just put something (it did the action); the camera will confirm or correct this.
    this.perceived[obj.id] = { position: { ...pos }, stamp: Date.now(), misses: 0 };
    this.emitObjectEvent({ name: obj.id, state: region, position: pos });
    this.emitObjectsChange();
    this.positionListeners.forEach((cb) => cb({ ...this.objectPositions }));
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'nora_gripper',
      message: `[Gripper] Released ${obj.name}: it dropped onto the ${region === 'tray' ? 'storage tray' : region === 'user' ? 'handover mat' : 'table'}.`
    });
  }

  /** Look at where an object is believed to be (from above) and refresh the belief. True if the camera sees it. */
  private async acquireTarget(id: string | null, execId?: number, fresh = false): Promise<boolean> {
    if (!id) return false;
    if (!fresh && this.beliefPosition(id)) return true;
    const t0 = Date.now();
    const last = this.perceived[id]?.position;
    if (last) {
      const pose = [...this.solveDynamicIK(last.x, this.robotBasePos.y + 0.45, last.z), this.currentJointPositions[6]];
      await this.moveAlongPlan(pose, this.buildCollisionWorld(id), { execId, frameMs: 30, abortable: true, label: 'look_at_target' }); // the tool may be touching the target
      if (this.isEStopped || this.isCancelled || (execId && execId !== this.currentExecutionId)) return false;
      await this.delay(150);
      await this.perceive();
      if ((this.perceived[id]?.stamp ?? 0) >= t0) return true;
    }
    const seen = await this.visualSweep((sid) => sid === id, execId);
    return seen.ids.has(id);
  }

  /** Grasp with feedback: descend, close, read the finger stroke; if it closed on nothing or the wrong thing, look again and retry. */
  private async executePick(step: PlanStep, intent: Intent, execId?: number): Promise<boolean> {
    const tid = this.normalizeObjectName(step.targetObject || intent.target_object);
    const entry = tid ? this.known().find((o) => o.id === tid) : undefined; // database entry (what it is), not where it is
    const name = entry?.name ?? (tid ?? 'object');
    const expectedWidth = entry ? GRASP_WIDTH[objectKind(entry)] : null;
    const aborted = () => this.isEStopped || this.isCancelled || Boolean(execId && execId !== this.currentExecutionId);
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (aborted()) return false;
      if (attempt > 1) {
        this.emitLog({ level: 30, levelName: 'WARN', nodeName: 'nora_gripper', message: `[Gripper] Grasp attempt ${attempt - 1} failed. Looking at ${name} again before retrying.` });
        if (!(await this.acquireTarget(tid, execId, true))) return false;
        const b = this.beliefPosition(tid);
        if (!b) return false;
        const pre = [...this.solveDynamicIK(b.x, Math.max(b.y, this.robotBasePos.y + GRASP_MIN_TCP_HEIGHT) + 0.12, b.z), GRIPPER_MAX_OPEN];
        await this.moveAlongPlan(pre, this.buildCollisionWorld(tid), { execId, frameMs: 35, abortable: true, label: 'regrasp_approach' });
        if (aborted()) return false;
      }
      const target = this.getTargetPositionsForSkill('pick', step, intent);
      await this.moveAlongPlan(target, this.buildCollisionWorld(tid), { execId, frameMs: 45, abortable: true, label: attempt > 1 ? 'pick_retry' : 'pick' });
      if (aborted()) return false;
      const res = await this.closeGripper();
      if (!res.holding) {
        this.emitLog({ level: 30, levelName: 'WARN', nodeName: 'nora_gripper', message: '[Gripper] Fingers closed on nothing (stroke 0 mm): the object was not where the camera placed it.' });
        await this.openGripper();
        continue;
      }
      if (expectedWidth !== null && Math.abs(res.width - expectedWidth) > 0.015) {
        this.emitLog({
          level: 30,
          levelName: 'WARN',
          nodeName: 'nora_gripper',
          message: `[Gripper] Closed on something ${(res.width * 1000).toFixed(0)} mm wide but ${name} should be about ${(expectedWidth * 1000).toFixed(0)} mm: wrong object. Putting it back.`
        });
        await this.openGripper();
        continue;
      }
      this.emitLog({ level: 20, levelName: 'INFO', nodeName: 'nora_gripper', message: `Grasp confirmed: [${tid}] held, finger stroke ${(res.width * 1000).toFixed(0)} mm.` });
      return true;
    }
    return false;
  }

  private publishJointState(): void {
    const names = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6', 'gripper_joint'];
    this.jointListeners.forEach((cb) =>
      cb({ names, positions: [...this.currentJointPositions], timestamp: Date.now() })
    );
  }

  /**
   * Plan a collision-free joint path to `target` and play it back. Falls back to a direct (unplanned)
   * move, clearly logged, if no path exists.
   */
  private async moveAlongPlan(
    target: number[],
    world: CollisionWorld,
    opts: { execId?: number; frameMs: number; abortable: boolean; label: string }
  ): Promise<PlanResult> {
    const start = [...this.currentJointPositions];
    const plan = planJointPath(start.slice(0, 6), target.slice(0, 6), this.robotBasePos, world);

    // MoveIt-style: expose the plan on a topic and as a TCP polyline for the 3D view.
    const tcpPath: [number, number, number][] = [];
    const pathForViz = plan.ok ? plan.path : [start.slice(0, 6), target.slice(0, 6)];
    for (let k = 0; k <= 24; k++) {
      const p = tcpPosition(samplePath(pathForViz, k / 24), this.robotBasePos);
      tcpPath.push([p.x, p.y, p.z]);
    }
    topicBus.publish('/move_group/display_planned_path', 'moveit_msgs/msg/DisplayTrajectory', {
      label: opts.label,
      planner: 'RRTConnect (sim/planner.ts)',
      success: plan.ok,
      waypoints: plan.path.length,
      iterations: plan.iterations,
      planning_time_ms: Number(plan.planningMs.toFixed(2)),
      min_clearance_m: plan.ok ? Number(plan.minClearance.toFixed(4)) : null,
      nearest_obstacle: plan.nearest,
      reason: plan.reason ?? null,
      tcp_path: tcpPath
    });

    if (plan.ok) {
      this.emitLog({
        level: 20,
        levelName: 'INFO',
        nodeName: 'motion_planner',
        message: `[Planner] RRTConnect ${opts.label}: ${plan.path.length} waypoints, ${plan.iterations} iterations, ${plan.planningMs.toFixed(1)} ms, min clearance ${(plan.minClearance * 1000).toFixed(0)} mm (${plan.nearest})`
      });
    } else {
      this.emitLog({
        level: 30,
        levelName: 'WARN',
        nodeName: 'motion_planner',
        message: `[Planner] ${opts.label}: ${plan.reason}. Executing direct, unplanned motion.`
      });
    }

    const path = plan.ok ? plan.path : [start.slice(0, 6), target.slice(0, 6)];
    const frames = Math.max(24, Math.min(80, Math.round(pathLength(path) / 0.03)));
    const gripStart = start[6];
    const gripEnd = target[6] ?? start[6];
    const aborted = () =>
      this.isEStopped || (opts.abortable && (this.isCancelled || (opts.execId && opts.execId !== this.currentExecutionId)));

    for (let f = 1; f <= frames; f++) {
      if (aborted()) return plan;
      const ease = (1 - Math.cos((f / frames) * Math.PI)) / 2; // smooth accel / decel
      this.currentJointPositions = [...samplePath(path, ease), gripStart + (gripEnd - gripStart) * ease];
      this.publishJointState();
      await (opts.abortable ? this.delay(opts.frameMs) : this.motionSleep(opts.frameMs));
      if (aborted()) return plan;
    }
    return plan;
  }

  // Plan a collision-free path for a skill step and execute it, with E-Stop / cancel safety checks.
  private async simulateJointMotion(step: PlanStep, intent: Intent, execId?: number): Promise<void> {
    const targetPositions = this.getTargetPositionsForSkill(step.skill, step, intent);
    const world = this.buildCollisionWorld(step.targetObject || intent.target_object);
    await this.moveAlongPlan(targetPositions, world, {
      execId,
      frameMs: 45,
      abortable: true,
      label: step.skill
    });
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

  public isAudioMuted(): boolean {
    return this.audioMuted;
  }

  public setAudioMuted(muted: boolean): void {
    this.audioMuted = muted;
    try {
      localStorage.setItem('nora.audioMuted', String(muted));
    } catch {
      // Keep the current preference even when it cannot be saved.
    }
    if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Speech synthesis is optional.
      }
    }
  }

  public emitArmSpeech(event: ArmSpeechEvent): void {
    this.armSpeechListeners.forEach((cb) => cb(event));
    if (!this.audioMuted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
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
    const j5 = basePose[4] ?? -Math.PI / 2;

    // Head-shake refusal: wiggle wrist 2 so the tool sweeps side to side
    const offsets = [0.22, -0.22, 0.16, -0.16, 0.0];
    for (const offset of offsets) {
      if (this.isEStopped || this.isCancelled) return;
      this.currentJointPositions[4] = j5 + offset;
      this.jointListeners.forEach((cb) =>
        cb({
          names: jointNames,
          positions: [...this.currentJointPositions],
          timestamp: Date.now()
        })
      );
      await this.delay(120);
    }
    this.currentJointPositions[4] = j5;
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

  /** Mirror simulator state onto ROS-style topics (read by the Topics / Plots / Sensors panels). */
  private attachTopicBus(): void {
    topicBus.retain('/joint_states', 1800); // ~40 s of motion for the Plots panel
    let lastTf = 0;
    this.jointListeners.add((js) => {
      topicBus.publish('/joint_states', 'sensor_msgs/msg/JointState', { name: js.names, position: js.positions });
      const now = performance.now();
      if (now - lastTf < 100) return; // /tf at 10 Hz, derived from forward kinematics
      lastTf = now;
      const frames = forwardKinematics(js.positions.slice(0, 6), this.robotBasePos);
      const names = ['base_link', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'gripper_link'];
      const transforms = names.slice(1).map((child, i) => {
        const rel = frames[i].clone().invert().multiply(frames[i + 1]);
        const p = rel.elements;
        return { parent: names[i], child, translation: [p[12], p[13], p[14]].map((v) => Number(v.toFixed(4))) };
      });
      topicBus.publish('/tf', 'tf2_msgs/msg/TFMessage', { transforms });
    });
    this.logListeners.add((log) => topicBus.publish('/rosout', 'rcl_interfaces/msg/Log', log));
    this.pipelineListeners.add((data) => topicBus.publish('/nora/orchestrator/state', 'nora_interfaces/msg/PipelineState', data));
    this.perceptionListeners.add((evt) => topicBus.publish('/nora/perception/scan', 'nora_interfaces/msg/PerceptionScan', evt));
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

    // 5. If something is in the gripper, release it: it falls to whatever is below
    if (this.gripHolding) await this.openGripper();

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
    await this.moveAlongPlan([...DESK_LAMP_HOME_JOINTS], this.buildCollisionWorld(null), {
      frameMs: 25,
      abortable: false,
      label: 'return_home'
    });
    if (this.isEStopped) return;
    this.currentJointPositions = [...DESK_LAMP_HOME_JOINTS];
    this.publishJointState();
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

