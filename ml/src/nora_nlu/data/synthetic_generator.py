"""
nora_nlu.data.synthetic_generator
==================================
Template-based synthetic data generator for NORA NLU training examples.

Generates varied natural language commands for each of the 6 supported action
types and pairs them with valid intent JSON dicts — no model required.
"""

from __future__ import annotations

import random
import uuid
from typing import Optional


# ── Action templates ────────────────────────────────────────────────────────────

_OBJECTS = [
    "red_cube", "blue_sphere", "green_block", "yellow_gear", "white_box",
    "metal_cylinder", "plastic_cone", "rubber_ball", "steel_rod", "glass_plate",
]

_LOCATIONS = [
    "shelf", "table", "tray", "conveyor_belt", "bin", "platform",
    "storage_area", "assembly_zone", "drop_zone", "workbench",
]

_PICK_TEMPLATES = [
    "pick up the {obj}",
    "grab the {obj}",
    "lift the {obj}",
    "retrieve the {obj}",
    "take the {obj}",
    "pick the {obj} up",
    "get the {obj} from the {loc}",
    "grab the {obj} from the {loc}",
    "lift the {obj} off the {loc}",
    "fetch the {obj} on the {loc}",
]

_PLACE_TEMPLATES = [
    "place the {obj} on the {loc}",
    "put the {obj} on the {loc}",
    "set the {obj} down on the {loc}",
    "deposit the {obj} onto the {loc}",
    "drop the {obj} onto the {loc}",
    "leave the {obj} on the {loc}",
    "put down the {obj} at the {loc}",
    "set {obj} on {loc}",
]

_MOVE_TO_POSE_TEMPLATES = [
    "move to coordinates {x}, {y}, {z}",
    "move the arm to position x={x} y={y} z={z}",
    "go to pose x={x} y={y} z={z}",
    "navigate to x={x} y={y} z={z}",
    "position the end-effector at {x}, {y}, {z}",
    "move end-effector to x={x} y={y} z={z}",
]

_OPEN_GRIPPER_TEMPLATES = [
    "open the gripper",
    "release the gripper",
    "open gripper",
    "spread the fingers",
    "release your grip",
    "let go",
    "open the hand",
    "disengage the gripper",
]

_CLOSE_GRIPPER_TEMPLATES = [
    "close the gripper",
    "grip tightly",
    "close gripper",
    "squeeze the gripper",
    "engage the gripper",
    "close your hand",
    "grip firmly",
    "clamp the gripper",
]

_GO_HOME_TEMPLATES = [
    "go home",
    "move to home position",
    "return to home",
    "go to the home position",
    "reset to home",
    "move arm to home",
    "home the arm",
    "return to the starting position",
]


class SyntheticGenerator:
    """Generates synthetic NORA NLU training examples from template strings.

    Each generated example is a dict with keys ``instruction`` and ``intent``,
    where ``intent`` is a valid intent dict conforming to the shared schema.

    Parameters
    ----------
    seed:
        Random seed for reproducibility. ``None`` uses system entropy.

    Example
    -------
    >>> gen = SyntheticGenerator(seed=42)
    >>> examples = gen.generate(n=50)
    >>> len(examples)
    50
    >>> examples[0].keys()
    dict_keys(['instruction', 'intent'])
    """

    def __init__(self, seed: Optional[int] = None) -> None:
        self._rng = random.Random(seed)

    # ── Public API ──────────────────────────────────────────────────────────────

    def generate(self, n: int) -> list[dict]:
        """Generate ``n`` synthetic (instruction, intent) pairs.

        The generator cycles through all 6 action types to ensure coverage.

        Parameters
        ----------
        n:
            Number of examples to generate. Must be >= 1.

        Returns
        -------
        list[dict]
            List of ``{"instruction": str, "intent": dict}`` records.
        """
        if n < 1:
            raise ValueError(f"n must be >= 1, got {n}")

        generators = [
            self._gen_pick,
            self._gen_place,
            self._gen_move_to_pose,
            self._gen_open_gripper,
            self._gen_close_gripper,
            self._gen_go_home,
        ]

        examples: list[dict] = []
        for i in range(n):
            gen_fn = generators[i % len(generators)]
            examples.append(gen_fn())

        # Shuffle so action types aren't strictly interleaved in the file
        self._rng.shuffle(examples)
        return examples

    # ── Private generators ──────────────────────────────────────────────────────

    def _make_intent(
        self,
        raw_text: str,
        action: str,
        target_object: Optional[str] = None,
        target_location: Optional[str] = None,
        parameters: Optional[dict] = None,
    ) -> dict:
        """Build a valid intent dict."""
        return {
            "version": "1.0",
            "command_id": str(uuid.uuid4()),
            "raw_text": raw_text,
            "action": action,
            "target_object": target_object,
            "target_location": target_location,
            "parameters": parameters or {},
            "confidence": 1.0,
        }

    def _gen_pick(self) -> dict:
        obj = self._rng.choice(_OBJECTS)
        loc = self._rng.choice(_LOCATIONS)
        template = self._rng.choice(_PICK_TEMPLATES)
        instruction = template.format(obj=obj.replace("_", " "), loc=loc.replace("_", " "))
        intent = self._make_intent(
            raw_text=instruction,
            action="pick",
            target_object=obj,
            target_location=loc if "{loc}" in template else None,
        )
        return {"instruction": instruction, "intent": intent}

    def _gen_place(self) -> dict:
        obj = self._rng.choice(_OBJECTS)
        loc = self._rng.choice(_LOCATIONS)
        template = self._rng.choice(_PLACE_TEMPLATES)
        instruction = template.format(obj=obj.replace("_", " "), loc=loc.replace("_", " "))
        intent = self._make_intent(
            raw_text=instruction,
            action="place",
            target_object=obj,
            target_location=loc,
        )
        return {"instruction": instruction, "intent": intent}

    def _gen_move_to_pose(self) -> dict:
        x = round(self._rng.uniform(-0.5, 0.5), 3)
        y = round(self._rng.uniform(-0.5, 0.5), 3)
        z = round(self._rng.uniform(0.1, 0.8), 3)
        template = self._rng.choice(_MOVE_TO_POSE_TEMPLATES)
        instruction = template.format(x=x, y=y, z=z)
        intent = self._make_intent(
            raw_text=instruction,
            action="move_to_pose",
            parameters={"x": x, "y": y, "z": z},
        )
        return {"instruction": instruction, "intent": intent}

    def _gen_open_gripper(self) -> dict:
        instruction = self._rng.choice(_OPEN_GRIPPER_TEMPLATES)
        intent = self._make_intent(raw_text=instruction, action="open_gripper")
        return {"instruction": instruction, "intent": intent}

    def _gen_close_gripper(self) -> dict:
        instruction = self._rng.choice(_CLOSE_GRIPPER_TEMPLATES)
        intent = self._make_intent(raw_text=instruction, action="close_gripper")
        return {"instruction": instruction, "intent": intent}

    def _gen_go_home(self) -> dict:
        instruction = self._rng.choice(_GO_HOME_TEMPLATES)
        intent = self._make_intent(raw_text=instruction, action="go_home")
        return {"instruction": instruction, "intent": intent}
