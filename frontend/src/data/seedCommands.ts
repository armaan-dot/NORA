import type { SeedCommandExample } from '../types';

export const SEED_COMMANDS: SeedCommandExample[] = [
  {
    instruction: "I am thirsty",
    intent: {
      version: "1.0",
      command_id: "seed-thirsty-01",
      raw_text: "I am thirsty",
      action: "pick",
      target_object: "water",
      target_location: "user",
      parameters: {},
      confidence: 1.0
    }
  },
  {
    instruction: "pick up the red cube",
    intent: {
      version: "1.0",
      command_id: "seed-pick-red-02",
      raw_text: "pick up the red cube",
      action: "pick",
      target_object: "red_cube",
      target_location: null,
      parameters: {},
      confidence: 1.0
    }
  },
  {
    instruction: "grab the blue sphere from the table",
    intent: {
      version: "1.0",
      command_id: "seed-grab-blue-03",
      raw_text: "grab the blue sphere from the table",
      action: "pick",
      target_object: "blue_sphere",
      target_location: "table",
      parameters: {},
      confidence: 1.0
    }
  },
  {
    instruction: "put the green block on the shelf",
    intent: {
      version: "1.0",
      command_id: "seed-put-green-04",
      raw_text: "put the green block on the shelf",
      action: "place",
      target_object: "green_block",
      target_location: "shelf",
      parameters: {},
      confidence: 1.0
    }
  },
  {
    instruction: "give me the glass",
    intent: {
      version: "1.0",
      command_id: "seed-give-glass-05",
      raw_text: "give me the glass",
      action: "pick",
      target_object: "glass",
      target_location: "user",
      parameters: {},
      confidence: 1.0
    }
  },
  {
    instruction: "move to the home position",
    intent: {
      version: "1.0",
      command_id: "seed-home-06",
      raw_text: "move to the home position",
      action: "go_home",
      target_object: null,
      target_location: null,
      parameters: {},
      confidence: 1.0
    }
  },
  {
    instruction: "open the gripper",
    intent: {
      version: "1.0",
      command_id: "seed-open-07",
      raw_text: "open the gripper",
      action: "open_gripper",
      target_object: null,
      target_location: null,
      parameters: {},
      confidence: 1.0
    }
  },
  {
    instruction: "close the gripper tightly",
    intent: {
      version: "1.0",
      command_id: "seed-close-08",
      raw_text: "close the gripper tightly",
      action: "close_gripper",
      target_object: null,
      target_location: null,
      parameters: { force: "tight" },
      confidence: 1.0
    }
  },
  {
    instruction: "move the arm to position x=0.3 y=0.1 z=0.5",
    intent: {
      version: "1.0",
      command_id: "seed-pose-09",
      raw_text: "move the arm to position x=0.3 y=0.1 z=0.5",
      action: "move_to_pose",
      target_object: null,
      target_location: null,
      parameters: { x: 0.3, y: 0.1, z: 0.5 },
      confidence: 1.0
    }
  },
  {
    instruction: "clean up the table",
    intent: {
      version: "1.0",
      command_id: "seed-clean-10",
      raw_text: "clean up the table",
      action: "clean_table",
      target_object: "all_objects",
      target_location: "tray",
      parameters: {
        objects: ["red_cube", "blue_cylinder", "green_sphere"]
      },
      confidence: 1.0
    }
  }
];

