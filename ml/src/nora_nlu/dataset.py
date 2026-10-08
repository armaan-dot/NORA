"""Dataset generator and loader for NORA NLU.

Provides seed commands and template-based synthetic command generation,
including direct commands (pick, place, move, grippers, home) and
indirect commonsense commands (e.g. "I am thirsty" -> pick water).
"""

from __future__ import annotations

import json
from pathlib import Path
import random
from typing import Any
import uuid

_OBJECTS = [
    # Primitive & Lab Objects
    "red_cube", "blue_cube", "green_cube", "yellow_cube", "black_cube",
    "white_box", "small_box", "large_box", "cardboard_box",
    "blue_sphere", "red_sphere", "green_block", "yellow_gear",
    "metal_cylinder", "plastic_cone", "rubber_ball", "cylinder", "cone", "ball",
    # Kitchen & Everyday items
    "glass", "cup", "mug", "coffee_cup", "tea_cup",
    "bottle", "water_bottle", "soda_can", "can",
    "water", "drink", "coffee", "tea", "beverage",
    "snack", "apple", "banana", "food",
    "plate", "bowl", "fork", "spoon", "sponge", "towel", "napkin",
    # Tools & Hardware
    "tool", "wrench", "screwdriver", "pliers",
    "bolt", "nut", "screw", "bracket", "part", "wire", "circuit_board",
    # Waste & Domestic
    "trash", "garbage", "waste", "rubbish",
    "jacket", "cloth", "pen", "marker", "book",
]

_LOCATIONS = [
    "shelf", "table", "tray", "conveyor_belt", "bin", "box",
    "workbench", "user", "drop_zone", "counter",
    "cart", "platform", "basket", "drawer", "rack", "stand",
    "sink", "trash_can", "recycling_bin", "storage_bin",
]

_DIRECT_TEMPLATES: dict[str, list[str]] = {
    "pick": [
        "pick up the {obj}",
        "grab the {obj}",
        "lift the {obj}",
        "retrieve the {obj}",
        "take the {obj}",
        "fetch the {obj}",
        "pick the {obj} up",
        "pick up {obj}",
        "grab {obj}",
        "lift {obj}",
        "snatch the {obj}",
        "grasp the {obj}",
        "hold the {obj}",
        "secure the {obj}",
        "grab the {obj} from the {loc}",
        "pick up the {obj} on the {loc}",
        "retrieve the {obj} off the {loc}",
        "take the {obj} out of the {loc}",
        "get the {obj} from {loc}",
        "give me the {obj}",
        "hand me the {obj}",
        "pass me the {obj}",
        "bring me the {obj}",
        "hand over the {obj}",
        "pass the {obj} to me",
        "can you give me the {obj}",
        "please hand me the {obj}",
        "could you bring me the {obj}",
        "fetch me the {obj}",
        "give {obj}",
        "hand {obj}",
        "bring {obj}",
        "pass {obj}",
    ],
    "place": [
        "place the {obj} on the {loc}",
        "put the {obj} on the {loc}",
        "set the {obj} down on the {loc}",
        "put the {obj} in the {loc}",
        "deposit the {obj} into the {loc}",
        "drop the {obj} in the {loc}",
        "leave the {obj} on the {loc}",
        "set {obj} on the {loc}",
        "store the {obj} in the {loc}",
        "place {obj} onto {loc}",
        "put {obj} into {loc}",
        "drop {obj} into {loc}",
        "deposit {obj} in {loc}",
        "stack the {obj} on the {loc}",
        "insert the {obj} into the {loc}",
        "position the {obj} on {loc}",
        "set down the {obj} at {loc}",
        "throw away the {obj} in the {loc}",
        "discard the {obj} into the {loc}",
        "toss the {obj} into the {loc}",
        "dispose of the {obj} in the {loc}",
        "toss {obj} in the {loc}",
        "clear the {obj} to the {loc}",
    ],
    "move_to_pose": [
        "move to coordinates {x}, {y}, {z}",
        "move the arm to position x={x} y={y} z={z}",
        "go to pose x={x} y={y} z={z}",
        "navigate to x={x} y={y} z={z}",
        "position end-effector at {x}, {y}, {z}",
        "move to position {x}, {y}, {z}",
        "align end-effector at x={x} y={y} z={z}",
        "navigate the arm to {x}, {y}, {z}",
        "go to coordinates x={x} y={y} z={z}",
        "position arm at {x}, {y}, {z}",
    ],
    "open_gripper": [
        "open the gripper",
        "release the gripper",
        "open gripper",
        "spread the fingers",
        "release your grip",
        "let go of the object",
        "open the hand",
        "open wide",
        "release grip",
        "open fingers",
        "loosen grip",
        "unclamp the gripper",
        "disengage gripper",
        "drop grip",
        "release jaws",
        "open jaw",
    ],
    "close_gripper": [
        "close the gripper",
        "close gripper",
        "grip tightly",
        "squeeze the gripper",
        "engage the gripper",
        "close the hand",
        "grip the item",
        "clamp down",
        "close fingers",
        "tighten grip",
        "grasp firmly",
        "clamp jaws",
        "pinch the gripper",
        "hold tightly",
        "engage jaws",
    ],
    "go_home": [
        "go home",
        "move to home position",
        "return to home",
        "go to the home position",
        "reset to home",
        "move arm to home",
        "park the arm",
        "standby pose",
        "reset pose",
        "return home",
        "home the arm",
        "dock the manipulator",
        "move to resting position",
        "park manipulator",
        "zero joints",
        "standby position",
        "move back to base pose",
    ],
}

_COMMONSENSE_PAIRS: list[dict[str, Any]] = [
    # Thirst & Beverages
    {"instruction": "I am thirsty", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "I'm so thirsty", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "I need a drink", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "can I have some water", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "could you bring me some water", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "I am parched", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "fetch me something to drink", "action": "pick", "target_object": "drink", "target_location": "user"},
    {"instruction": "give me a beverage", "action": "pick", "target_object": "beverage", "target_location": "user"},
    {"instruction": "bring me a glass of water", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "get me a cup of water", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "I need hydration", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "fetch me a coffee", "action": "pick", "target_object": "coffee", "target_location": "user"},
    {"instruction": "bring me a cup of tea", "action": "pick", "target_object": "tea", "target_location": "user"},
    {"instruction": "give me the mug", "action": "pick", "target_object": "mug", "target_location": "user"},
    {"instruction": "pass me the water bottle", "action": "pick", "target_object": "water_bottle", "target_location": "user"},
    {"instruction": "hand me the soda", "action": "pick", "target_object": "soda_can", "target_location": "user"},

    # Hunger & Food
    {"instruction": "I'm hungry", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "I am starving", "action": "pick", "target_object": "food", "target_location": "user"},
    {"instruction": "I need food", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "bring me something to eat", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "get me an apple", "action": "pick", "target_object": "apple", "target_location": "user"},
    {"instruction": "hand me the banana", "action": "pick", "target_object": "banana", "target_location": "user"},
    {"instruction": "fetch me a snack", "action": "pick", "target_object": "snack", "target_location": "user"},

    # Cold & Temperature
    {"instruction": "it's cold in here", "action": "pick", "target_object": "jacket", "target_location": "user"},
    {"instruction": "I am freezing", "action": "pick", "target_object": "jacket", "target_location": "user"},
    {"instruction": "I'm chilly", "action": "pick", "target_object": "jacket", "target_location": "user"},
    {"instruction": "bring me my jacket", "action": "pick", "target_object": "jacket", "target_location": "user"},
    {"instruction": "fetch a blanket", "action": "pick", "target_object": "cloth", "target_location": "user"},

    # Cleaning & Waste Disposal
    {"instruction": "clean up the table", "action": "pick", "target_object": "trash", "target_location": "bin"},
    {"instruction": "clean the desk", "action": "pick", "target_object": "trash", "target_location": "bin"},
    {"instruction": "clear the mess", "action": "pick", "target_object": "trash", "target_location": "bin"},
    {"instruction": "clean this workspace", "action": "pick", "target_object": "trash", "target_location": "bin"},
    {"instruction": "throw away the garbage", "action": "place", "target_object": "garbage", "target_location": "bin"},
    {"instruction": "put the trash in the bin", "action": "place", "target_object": "trash", "target_location": "bin"},
    {"instruction": "toss the waste in the trash can", "action": "place", "target_object": "waste", "target_location": "trash_can"},
    {"instruction": "dump the rubbish", "action": "place", "target_object": "rubbish", "target_location": "bin"},
    {"instruction": "wipe the table", "action": "pick", "target_object": "sponge", "target_location": "table"},
    {"instruction": "get me a sponge to clean", "action": "pick", "target_object": "sponge", "target_location": "user"},

    # Tools & Hardware
    {"instruction": "I need to tighten a bolt", "action": "pick", "target_object": "wrench", "target_location": "user"},
    {"instruction": "hand me a wrench", "action": "pick", "target_object": "wrench", "target_location": "user"},
    {"instruction": "I need to drive a screw", "action": "pick", "target_object": "screwdriver", "target_location": "user"},
    {"instruction": "give me the pliers", "action": "pick", "target_object": "pliers", "target_location": "user"},
    {"instruction": "I need to write something", "action": "pick", "target_object": "pen", "target_location": "user"},
    {"instruction": "pass me a marker", "action": "pick", "target_object": "marker", "target_location": "user"},
]


def load_seed_commands(seed_file: Path | str | None = None) -> list[dict[str, Any]]:
    """Load hand-crafted seed commands from jsonl file."""
    if seed_file is None:
        seed_file = Path(__file__).parent.parent.parent / "data" / "examples" / "seed_commands.jsonl"
    path = Path(seed_file)
    if not path.is_file():
        return []
    examples = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                examples.append(json.loads(line))
    return examples


def generate_dataset(num_samples: int = 5000, seed: int = 42) -> list[dict[str, Any]]:
    """Generate a diverse synthetic training dataset."""
    rng = random.Random(seed)
    dataset: list[dict[str, Any]] = []

    # 1. Include seed commands multiple times to boost priority
    seeds = load_seed_commands()
    for _ in range(5):
        dataset.extend(seeds)

    # 2. Include commonsense pairs multiple times to ensure robust weighting
    for _ in range(10):
        for cs in _COMMONSENSE_PAIRS:
            dataset.append({
                "instruction": cs["instruction"],
                "intent": {
                    "version": "1.0",
                    "command_id": str(uuid.uuid4()),
                    "raw_text": cs["instruction"],
                    "action": cs["action"],
                    "target_object": cs["target_object"],
                    "target_location": cs.get("target_location"),
                    "parameters": {},
                    "confidence": 1.0,
                },
            })

    # 3. Generate template samples with variations
    actions = list(_DIRECT_TEMPLATES.keys())
    per_action = max(20, num_samples // len(actions))

    for action, templates in _DIRECT_TEMPLATES.items():
        for _ in range(per_action):
            template = rng.choice(templates)
            obj = rng.choice(_OBJECTS)
            loc = rng.choice(_LOCATIONS)
            x = round(rng.uniform(-0.8, 0.8), 2)
            y = round(rng.uniform(-0.8, 0.8), 2)
            z = round(rng.uniform(0.05, 0.75), 2)

            text = template.format(obj=obj.replace("_", " "), loc=loc.replace("_", " "), x=x, y=y, z=z)

            params: dict[str, Any] = {}
            target_obj = None
            target_loc = None

            if action == "pick":
                target_obj = obj
                if "{loc}" in template:
                    target_loc = loc
                elif any(w in template for w in ["give", "hand", "pass", "bring"]):
                    target_loc = "user"
            elif action == "place":
                target_obj = obj
                target_loc = loc
            elif action == "move_to_pose":
                params = {"x": x, "y": y, "z": z}

            dataset.append({
                "instruction": text,
                "intent": {
                    "version": "1.0",
                    "command_id": str(uuid.uuid4()),
                    "raw_text": text,
                    "action": action,
                    "target_object": target_obj,
                    "target_location": target_loc,
                    "parameters": params,
                    "confidence": 1.0,
                },
            })

    rng.shuffle(dataset)
    return dataset
