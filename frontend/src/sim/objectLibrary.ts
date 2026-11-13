/**
 * The one list of tabletop objects, shared by the web simulator and Gazebo.
 *
 * Web: the Add Object panel offers these entries; shape, mesh and physics come from objectMeshes.ts and
 * objectPhysics.ts (chosen from name + shape by objectKind).
 * Gazebo: `npm run export:gazebo` turns every entry into ros2_ws/src/nora_gazebo/models/<id>, writes GAZEBO_SCENE
 * into worlds/tabletop.world, and writes the arm commander's catalogue (nora_bringup/config/gazebo_scene.json).
 * Change an object here, run the export, and both simulators get the same object.
 */

export type ObjectCategory = 'Drinks' | 'Food' | 'Stationery' | 'Household' | 'Shapes';

export interface LibraryObject {
  /** Gazebo model name and the class name the ROS side uses (perception labels, commander catalogue). */
  id: string;
  /** Display name in the web simulator; together with shape it selects the mesh and physics (objectKind). */
  name: string;
  shape: 'box' | 'cylinder' | 'sphere' | 'glass' | 'mug' | 'apple';
  color: string;
  category: ObjectCategory;
  /** Other words for it in commands ("water" = the glass). */
  aliases: string[];
}

export const OBJECT_LIBRARY: LibraryObject[] = [
  { id: 'mug', name: 'Coffee Mug', shape: 'mug', color: '#8b4513', category: 'Drinks', aliases: ['coffee', 'coffee_mug', 'cup'] },
  { id: 'glass', name: 'Water Glass', shape: 'glass', color: '#38bdf8', category: 'Drinks', aliases: ['water', 'water_glass', 'drink', 'water_bottle', 'beverage'] },
  { id: 'tea_cup', name: 'Tea Cup', shape: 'mug', color: '#10b981', category: 'Drinks', aliases: ['tea'] },
  { id: 'can', name: 'Soda Can', shape: 'cylinder', color: '#c0392b', category: 'Drinks', aliases: ['soda', 'soda_can', 'coke', 'energy_drink', 'empty_can', 'trash', 'garbage'] },
  { id: 'apple', name: 'Red Apple', shape: 'apple', color: '#e11d48', category: 'Food', aliases: ['snack', 'food', 'fruit', 'red_apple'] },
  { id: 'green_apple', name: 'Green Apple', shape: 'apple', color: '#65a30d', category: 'Food', aliases: [] },
  { id: 'orange', name: 'Orange Fruit', shape: 'sphere', color: '#f97316', category: 'Food', aliases: ['orange_fruit'] },
  { id: 'pen', name: 'Writing Pen', shape: 'cylinder', color: '#2563eb', category: 'Stationery', aliases: ['writing_pen'] },
  { id: 'pencil', name: 'Yellow Pencil', shape: 'cylinder', color: '#f59e0b', category: 'Stationery', aliases: ['yellow_pencil'] },
  { id: 'highlighter', name: 'Highlighter', shape: 'cylinder', color: '#eab308', category: 'Stationery', aliases: ['marker'] },
  { id: 'notebook', name: 'Notebook', shape: 'box', color: '#3b82f6', category: 'Stationery', aliases: ['book', 'notepad', 'journal'] },
  { id: 'ruler', name: 'Desk Ruler', shape: 'box', color: '#cbd5e1', category: 'Stationery', aliases: [] },
  { id: 'scissors', name: 'Office Scissors', shape: 'box', color: '#64748b', category: 'Stationery', aliases: [] },
  { id: 'stapler', name: 'Paper Stapler', shape: 'box', color: '#475569', category: 'Stationery', aliases: [] },
  { id: 'eraser', name: 'Pink Eraser', shape: 'box', color: '#f43f5e', category: 'Stationery', aliases: ['rubber'] },
  { id: 'sponge', name: 'Cleaning Sponge', shape: 'box', color: '#22c55e', category: 'Household', aliases: ['wipe', 'wet_wipes', 'cleaning_sponge'] },
  { id: 'yellow_box', name: 'Yellow Box', shape: 'box', color: '#eab308', category: 'Shapes', aliases: ['block', 'cube'] },
  { id: 'blue_package', name: 'Blue Package', shape: 'box', color: '#2563eb', category: 'Shapes', aliases: ['package', 'parcel'] },
  { id: 'canister', name: 'Purple Canister', shape: 'cylinder', color: '#a855f7', category: 'Shapes', aliases: [] },
  { id: 'tennis_ball', name: 'Tennis Ball', shape: 'sphere', color: '#84cc16', category: 'Shapes', aliases: ['ball', 'stress_ball'] }
];

export const OBJECT_CATEGORIES: ObjectCategory[] = ['Drinks', 'Food', 'Stationery', 'Household', 'Shapes'];

export const libraryObject = (id: string): LibraryObject => {
  const o = OBJECT_LIBRARY.find((e) => e.id === id);
  if (!o) throw new Error(`no object '${id}' in objectLibrary.ts`);
  return o;
};

/**
 * Objects on the Gazebo table at start (ROS world frame, base_link at the origin; yaw in rad).
 * The glass, tennis ball and mug positions are the web simulator's default scene.
 */
export const GAZEBO_SCENE: { id: string; x: number; y: number; yaw?: number }[] = [
  { id: 'mug', x: 0.63, y: -0.15 },
  { id: 'glass', x: 0.47, y: -0.05 },
  { id: 'tennis_ball', x: 0.25, y: -0.19 },
  { id: 'apple', x: 0.40, y: 0.12 },
  { id: 'can', x: 0.58, y: 0.10 },
  { id: 'notebook', x: 0.32, y: -0.36 },
  { id: 'sponge', x: 0.45, y: -0.19 }
];
