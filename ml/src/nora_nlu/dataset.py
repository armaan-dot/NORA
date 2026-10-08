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
    "red_cube", "blue_sphere", "green_block", "yellow_gear", "white_box",
    "cylinder", "cone", "ball", "glass", "cup", "bottle", "water_bottle",
    "sponge", "plate", "apple", "tool",
]

_LOCATIONS = [
    "shelf", "table", "tray", "conveyor_belt", "bin", "box",
    "workbench", "user", "drop_zone", "counter",
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
        "grab the {obj} from the {loc}",
        "pick up the {obj} on the {loc}",
        "give me the {obj}",
        "hand me the {obj}",
        "pass me the {obj}",
        "bring me the {obj}",
        "can you give me the {obj}",
        "please hand me the {obj}",
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
    ],
    "move_to_pose": [
        "move to coordinates {x}, {y}, {z}",
        "move the arm to position x={x} y={y} z={z}",
        "go to pose x={x} y={y} z={z}",
        "navigate to x={x} y={y} z={z}",
        "position end-effector at {x}, {y}, {z}",
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
    ],
}

_COMMONSENSE_PAIRS: list[dict[str, Any]] = [
    {"instruction": "I am thirsty", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "I need a drink", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "can I have some water", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "I am parched", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "fetch me something to drink", "action": "pick", "target_object": "drink", "target_location": "user"},
    {"instruction": "give me a beverage", "action": "pick", "target_object": "beverage", "target_location": "user"},
    {"instruction": "I'm hungry", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "I need food", "action": "pick", "target_object": "food", "target_location": "user"},
    {"instruction": "it's cold in here", "action": "pick", "target_object": "jacket", "target_location": "user"},
    {"instruction": "clean up the table", "action": "pick", "target_object": "trash", "target_location": "bin"},
    {"instruction": "clean the desk", "action": "pick", "target_object": "trash", "target_location": "bin"},
    {"instruction": "throw away the garbage", "action": "place", "target_object": "garbage", "target_location": "bin"},
    {"instruction": "put the trash in the bin", "action": "place", "target_object": "trash", "target_location": "bin"},
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


def generate_dataset(num_samples: int = 500, seed: int = 42) -> list[dict[str, Any]]:
    """Generate a diverse synthetic training dataset."""
    rng = random.Random(seed)
    dataset: list[dict[str, Any]] = []

    # 1. Include all seed commands
    dataset.extend(load_seed_commands())

    # 2. Include commonsense pairs (with variations)
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

    # 3. Generate template samples
    actions = list(_DIRECT_TEMPLATES.keys())
    per_action = max(10, num_samples // len(actions))

    for action, templates in _DIRECT_TEMPLATES.items():
        for _ in range(per_action):
            template = rng.choice(templates)
            obj = rng.choice(_OBJECTS)
            loc = rng.choice(_LOCATIONS)
            x, y, z = round(rng.uniform(0.1, 0.8), 2), round(rng.uniform(-0.5, 0.5), 2), round(rng.uniform(0.1, 0.6), 2)

            text = template.format(obj=obj.replace("_", " "), loc=loc, x=x, y=y, z=z)

            params: dict[str, Any] = {}
            target_obj = None
            target_loc = None

            if action == "pick":
                target_obj = obj
                if "{loc}" in template:
                    target_loc = loc
                elif any(w in template for w in ["give me", "hand me", "pass me", "bring me"]):
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
