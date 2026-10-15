"""
nora_nlu_node/local_parser.py
──────────────────────────────
Local ML model backend for NORA NLU.

Loads the pre-trained NORA NLU statistical model weights from
*model_path* (or defaults to ``ml/models/nora_nlu_model.json``).
Requires zero external daemons or heavy GPU dependencies.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import uuid
from typing import Any

from nora_nlu_node.intent_parser import IntentParser

_ACTIONS = {
    "pick", "place", "move_to_pose", "open_gripper", "close_gripper",
    "go_home", "unknown",
}

_COMMONSENSE_MAP: dict[str, dict[str, Any]] = {
    # --- Thirst / drinks ---
    "thirsty": {"action": "pick", "target_object": "water", "target_location": "user"},
    "parched": {"action": "pick", "target_object": "water", "target_location": "user"},
    "dehydrated": {"action": "pick", "target_object": "water", "target_location": "user"},
    "hydration": {"action": "pick", "target_object": "water", "target_location": "user"},
    "hydrate": {"action": "pick", "target_object": "water", "target_location": "user"},
    "water": {"action": "pick", "target_object": "water", "target_location": "user"},
    "drink": {"action": "pick", "target_object": "water_glass", "target_location": "user"},
    "sip": {"action": "pick", "target_object": "water_glass", "target_location": "user"},
    "beverage": {"action": "pick", "target_object": "drink", "target_location": "user"},
    "refreshment": {"action": "pick", "target_object": "drink", "target_location": "user"},
    "glass": {"action": "pick", "target_object": "water_glass", "target_location": "user"},
    "bottle": {"action": "pick", "target_object": "water_bottle", "target_location": "user"},
    "coffee": {"action": "pick", "target_object": "coffee_mug", "target_location": "user"},
    "caffeine": {"action": "pick", "target_object": "coffee_mug", "target_location": "user"},
    "espresso": {"action": "pick", "target_object": "coffee_mug", "target_location": "user"},
    "tea": {"action": "pick", "target_object": "tea_cup", "target_location": "user"},
    "mug": {"action": "pick", "target_object": "mug", "target_location": "user"},
    "cup": {"action": "pick", "target_object": "mug", "target_location": "user"},
    "soda": {"action": "pick", "target_object": "soda_can", "target_location": "user"},
    "coke": {"action": "pick", "target_object": "soda_can", "target_location": "user"},
    "pepsi": {"action": "pick", "target_object": "soda_can", "target_location": "user"},
    "sprite": {"action": "pick", "target_object": "soda_can", "target_location": "user"},
    "fizzy": {"action": "pick", "target_object": "soda_can", "target_location": "user"},
    "juice": {"action": "pick", "target_object": "juice_box", "target_location": "user"},
    "milk": {"action": "pick", "target_object": "milk_carton", "target_location": "user"},
    "energy": {"action": "pick", "target_object": "energy_drink", "target_location": "user"},
    "sleepy": {"action": "pick", "target_object": "energy_drink", "target_location": "user"},
    "tired": {"action": "pick", "target_object": "coffee_mug", "target_location": "user"},
    "exhausted": {"action": "pick", "target_object": "energy_drink", "target_location": "user"},
    "workout": {"action": "pick", "target_object": "sports_drink", "target_location": "user"},
    "thermos": {"action": "pick", "target_object": "thermos", "target_location": "user"},

    # --- Hunger / food ---
    "hungry": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "starving": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "famished": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "peckish": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "munchies": {"action": "pick", "target_object": "chips_bag", "target_location": "user"},
    "food": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "eat": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "snack": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "lunch": {"action": "pick", "target_object": "lunch_box", "target_location": "user"},
    "breakfast": {"action": "pick", "target_object": "granola_bar", "target_location": "user"},
    "sweet": {"action": "pick", "target_object": "chocolate_bar", "target_location": "user"},
    "sugar": {"action": "pick", "target_object": "candy", "target_location": "user"},
    "chocolate": {"action": "pick", "target_object": "chocolate_bar", "target_location": "user"},
    "candy": {"action": "pick", "target_object": "candy", "target_location": "user"},
    "crunchy": {"action": "pick", "target_object": "chips_bag", "target_location": "user"},
    "chips": {"action": "pick", "target_object": "chips_bag", "target_location": "user"},
    "cookie": {"action": "pick", "target_object": "cookie", "target_location": "user"},
    "fruit": {"action": "pick", "target_object": "apple", "target_location": "user"},
    "healthy": {"action": "pick", "target_object": "apple", "target_location": "user"},
    "apple": {"action": "pick", "target_object": "apple", "target_location": "user"},
    "banana": {"action": "pick", "target_object": "banana", "target_location": "user"},
    "orange": {"action": "pick", "target_object": "orange", "target_location": "user"},
    "gum": {"action": "pick", "target_object": "gum", "target_location": "user"},
    "fresh breath": {"action": "pick", "target_object": "mint_box", "target_location": "user"},

    # --- Temperature / clothing ---
    "cold": {"action": "pick", "target_object": "jacket", "target_location": "user"},
    "freeze": {"action": "pick", "target_object": "jacket", "target_location": "user"},
    "freezing": {"action": "pick", "target_object": "jacket", "target_location": "user"},
    "chilly": {"action": "pick", "target_object": "jacket", "target_location": "user"},
    "shivering": {"action": "pick", "target_object": "jacket", "target_location": "user"},
    "warm": {"action": "pick", "target_object": "jacket", "target_location": "user"},
    "blanket": {"action": "pick", "target_object": "jacket", "target_location": "user"},
    "scarf": {"action": "pick", "target_object": "scarf", "target_location": "user"},
    "gloves": {"action": "pick", "target_object": "glove", "target_location": "user"},
    "hat": {"action": "pick", "target_object": "hat", "target_location": "user"},
    "rain": {"action": "pick", "target_object": "umbrella", "target_location": "user"},
    "umbrella": {"action": "pick", "target_object": "umbrella", "target_location": "user"},
    "sun": {"action": "pick", "target_object": "sunglasses", "target_location": "user"},
    "bright": {"action": "pick", "target_object": "sunglasses", "target_location": "user"},

    # --- Trash / cleaning ---
    "trash": {"action": "place", "target_object": "trash", "target_location": "trash_bin"},
    "garbage": {"action": "place", "target_object": "garbage", "target_location": "trash_bin"},
    "waste": {"action": "place", "target_object": "trash", "target_location": "trash_bin"},
    "rubbish": {"action": "place", "target_object": "trash", "target_location": "trash_bin"},
    "junk": {"action": "place", "target_object": "trash", "target_location": "trash_bin"},
    "dispose": {"action": "place", "target_object": "trash", "target_location": "trash_bin"},
    "throw away": {"action": "place", "target_object": "trash", "target_location": "trash_bin"},
    "wrapper": {"action": "place", "target_object": "wrapper", "target_location": "trash_bin"},
    "empty can": {"action": "place", "target_object": "empty_can", "target_location": "recycle_bin"},
    "empty bottle": {"action": "place", "target_object": "empty_bottle", "target_location": "recycle_bin"},
    "recycle": {"action": "place", "target_object": "empty_bottle", "target_location": "recycle_bin"},
    "clean": {"action": "pick", "target_object": "trash", "target_location": "trash_bin"},
    "tidy": {"action": "pick", "target_object": "trash", "target_location": "trash_bin"},
    "mess": {"action": "pick", "target_object": "trash", "target_location": "trash_bin"},
    "messy": {"action": "pick", "target_object": "trash", "target_location": "trash_bin"},
    "spill": {"action": "pick", "target_object": "sponge", "target_location": "table"},
    "spilled": {"action": "pick", "target_object": "sponge", "target_location": "table"},
    "wipe": {"action": "pick", "target_object": "sponge", "target_location": "table"},
    "dirty": {"action": "pick", "target_object": "sponge", "target_location": "table"},
    "sponge": {"action": "pick", "target_object": "sponge", "target_location": "table"},
    "sticky": {"action": "pick", "target_object": "wet_wipes", "target_location": "user"},
    "sneeze": {"action": "pick", "target_object": "tissue_box", "target_location": "user"},
    "sniffle": {"action": "pick", "target_object": "tissue_box", "target_location": "user"},
    "tissue": {"action": "pick", "target_object": "tissue_box", "target_location": "user"},
    "napkin": {"action": "pick", "target_object": "napkin", "target_location": "user"},
    "germs": {"action": "pick", "target_object": "hand_sanitizer", "target_location": "user"},
    "sanitize": {"action": "pick", "target_object": "hand_sanitizer", "target_location": "user"},
    "dry lips": {"action": "pick", "target_object": "lip_balm", "target_location": "user"},
    "dry hands": {"action": "pick", "target_object": "hand_cream", "target_location": "user"},

    # --- Writing / stationery ---
    "write": {"action": "pick", "target_object": "pen", "target_location": "user"},
    "sign": {"action": "pick", "target_object": "pen", "target_location": "user"},
    "note": {"action": "pick", "target_object": "sticky_notes", "target_location": "user"},
    "remind": {"action": "pick", "target_object": "sticky_notes", "target_location": "user"},
    "draw": {"action": "pick", "target_object": "pencil", "target_location": "user"},
    "sketch": {"action": "pick", "target_object": "pencil", "target_location": "user"},
    "mistake": {"action": "pick", "target_object": "eraser", "target_location": "user"},
    "erase": {"action": "pick", "target_object": "eraser", "target_location": "user"},
    "highlight": {"action": "pick", "target_object": "highlighter", "target_location": "user"},
    "underline": {"action": "pick", "target_object": "highlighter", "target_location": "user"},
    "measure": {"action": "pick", "target_object": "ruler", "target_location": "user"},
    "straight line": {"action": "pick", "target_object": "ruler", "target_location": "user"},
    "staple": {"action": "pick", "target_object": "stapler", "target_location": "user"},
    "attach": {"action": "pick", "target_object": "paper_clip", "target_location": "user"},
    "tape": {"action": "pick", "target_object": "tape", "target_location": "user"},
    "stick": {"action": "pick", "target_object": "glue_stick", "target_location": "user"},
    "glue": {"action": "pick", "target_object": "glue_stick", "target_location": "user"},
    "cut": {"action": "pick", "target_object": "scissors", "target_location": "user"},
    "pen": {"action": "pick", "target_object": "pen", "target_location": "user"},
    "pencil": {"action": "pick", "target_object": "pencil", "target_location": "user"},
    "marker": {"action": "pick", "target_object": "marker", "target_location": "user"},
    "notebook": {"action": "pick", "target_object": "notebook", "target_location": "user"},
    "study": {"action": "pick", "target_object": "textbook", "target_location": "user"},
    "read": {"action": "pick", "target_object": "book", "target_location": "user"},
    "calculate": {"action": "pick", "target_object": "calculator", "target_location": "user"},
    "math": {"action": "pick", "target_object": "calculator", "target_location": "user"},

    # --- Putting things away (desk organization) ---
    "put away pens": {"action": "place", "target_object": "pen", "target_location": "pencil_holder"},
    "organize pens": {"action": "place", "target_object": "pen", "target_location": "pencil_holder"},
    "organize pencils": {"action": "place", "target_object": "pencil", "target_location": "pencil_holder"},
    "organize markers": {"action": "place", "target_object": "marker", "target_location": "pencil_holder"},
    "pencil holder": {"action": "place", "target_object": "pencil", "target_location": "pencil_holder"},
    "organize desk": {"action": "place", "target_object": "pen", "target_location": "desk_organizer"},
    "store": {"action": "place", "target_object": "box", "target_location": "storage_box"},

    # --- Electronics ---
    "phone": {"action": "pick", "target_object": "phone", "target_location": "user"},
    "call": {"action": "pick", "target_object": "phone", "target_location": "user"},
    "battery low": {"action": "pick", "target_object": "charger", "target_location": "user"},
    "charge": {"action": "pick", "target_object": "charger", "target_location": "user"},
    "charger": {"action": "pick", "target_object": "charger", "target_location": "user"},
    "dying": {"action": "pick", "target_object": "power_bank", "target_location": "user"},
    "music": {"action": "pick", "target_object": "headphones", "target_location": "user"},
    "listen": {"action": "pick", "target_object": "earbuds", "target_location": "user"},
    "noise": {"action": "pick", "target_object": "headphones", "target_location": "user"},
    "loud": {"action": "pick", "target_object": "earplugs", "target_location": "user"},
    "focus": {"action": "pick", "target_object": "headphones", "target_location": "user"},
    "tv": {"action": "pick", "target_object": "tv_remote", "target_location": "user"},
    "channel": {"action": "pick", "target_object": "tv_remote", "target_location": "user"},
    "remote": {"action": "pick", "target_object": "remote", "target_location": "user"},
    "dark": {"action": "pick", "target_object": "flashlight", "target_location": "user"},
    "light": {"action": "pick", "target_object": "flashlight", "target_location": "user"},
    "flashlight": {"action": "pick", "target_object": "flashlight", "target_location": "user"},
    "photo": {"action": "pick", "target_object": "camera", "target_location": "user"},
    "usb": {"action": "pick", "target_object": "usb_drive", "target_location": "user"},
    "save file": {"action": "pick", "target_object": "usb_drive", "target_location": "user"},
    "cable": {"action": "pick", "target_object": "usb_cable", "target_location": "user"},
    "game": {"action": "pick", "target_object": "game_controller", "target_location": "user"},
    "video call": {"action": "pick", "target_object": "webcam", "target_location": "user"},
    "mouse": {"action": "pick", "target_object": "mouse", "target_location": "user"},

    # --- Tools / hardware ---
    "wrench": {"action": "pick", "target_object": "wrench", "target_location": "user"},
    "bolt": {"action": "pick", "target_object": "wrench", "target_location": "user"},
    "nut": {"action": "pick", "target_object": "wrench", "target_location": "user"},
    "tighten": {"action": "pick", "target_object": "wrench", "target_location": "user"},
    "loosen": {"action": "pick", "target_object": "wrench", "target_location": "user"},
    "screw": {"action": "pick", "target_object": "screwdriver", "target_location": "user"},
    "screwdriver": {"action": "pick", "target_object": "screwdriver", "target_location": "user"},
    "hex": {"action": "pick", "target_object": "hex_key", "target_location": "user"},
    "allen": {"action": "pick", "target_object": "allen_key", "target_location": "user"},
    "pliers": {"action": "pick", "target_object": "pliers", "target_location": "user"},
    "grip": {"action": "pick", "target_object": "pliers", "target_location": "user"},
    "bend wire": {"action": "pick", "target_object": "needle_nose_pliers", "target_location": "user"},
    "strip wire": {"action": "pick", "target_object": "wire_stripper", "target_location": "user"},
    "snip": {"action": "pick", "target_object": "wire_cutters", "target_location": "user"},
    "hammer": {"action": "pick", "target_object": "hammer", "target_location": "user"},
    "nail": {"action": "pick", "target_object": "hammer", "target_location": "user"},
    "how long": {"action": "pick", "target_object": "tape_measure", "target_location": "user"},
    "how wide": {"action": "pick", "target_object": "tape_measure", "target_location": "user"},
    "voltage": {"action": "pick", "target_object": "multimeter", "target_location": "user"},
    "continuity": {"action": "pick", "target_object": "multimeter", "target_location": "user"},
    "solder": {"action": "pick", "target_object": "soldering_iron", "target_location": "user"},
    "zip tie": {"action": "pick", "target_object": "zip_tie", "target_location": "user"},
    "bundle cables": {"action": "pick", "target_object": "zip_tie", "target_location": "user"},
    "tiny": {"action": "pick", "target_object": "tweezers", "target_location": "user"},
    "magnify": {"action": "pick", "target_object": "magnifying_glass", "target_location": "user"},
    "tools": {"action": "pick", "target_object": "screwdriver", "target_location": "user"},

    # --- Personal items ---
    "keys": {"action": "pick", "target_object": "keys", "target_location": "user"},
    "leaving": {"action": "pick", "target_object": "keys", "target_location": "user"},
    "wallet": {"action": "pick", "target_object": "wallet", "target_location": "user"},
    "pay": {"action": "pick", "target_object": "wallet", "target_location": "user"},
    "glasses": {"action": "pick", "target_object": "glasses", "target_location": "user"},
    "blurry": {"action": "pick", "target_object": "glasses", "target_location": "user"},
    "watch": {"action": "pick", "target_object": "watch", "target_location": "user"},
    "time": {"action": "pick", "target_object": "watch", "target_location": "user"},
    "bag": {"action": "pick", "target_object": "backpack", "target_location": "user"},
    "comb": {"action": "pick", "target_object": "comb", "target_location": "user"},
    "mirror": {"action": "pick", "target_object": "mirror", "target_location": "user"},

    # --- Play / stress ---
    "bored": {"action": "pick", "target_object": "fidget_spinner", "target_location": "user"},
    "fidget": {"action": "pick", "target_object": "fidget_spinner", "target_location": "user"},
    "stressed": {"action": "pick", "target_object": "stress_ball", "target_location": "user"},
    "anxious": {"action": "pick", "target_object": "stress_ball", "target_location": "user"},
    "play": {"action": "pick", "target_object": "ball", "target_location": "user"},
    "toss": {"action": "pick", "target_object": "tennis_ball", "target_location": "user"},
    "dice": {"action": "pick", "target_object": "dice", "target_location": "user"},
    "cards": {"action": "pick", "target_object": "playing_cards", "target_location": "user"},
}


class LocalMLParser(IntentParser):
    """Local trained ML model backend for NORA NLU.

    Parameters
    ----------
    model_path:
        Path to ``nora_nlu_model.json`` or Hugging Face directory.
    """

    def __init__(self, model_path: str = "") -> None:
        self.model_data: dict[str, Any] | None = None
        self._hf_pipeline = None

        candidate_path = Path(model_path) if model_path else self._find_default_model_path()

        if candidate_path and candidate_path.is_file() and candidate_path.suffix == ".json":
            try:
                self.model_data = json.loads(candidate_path.read_text(encoding="utf-8"))
            except Exception:
                self.model_data = None
        elif candidate_path and candidate_path.is_dir():
            # Optional Hugging Face pipeline if directory is provided
            try:
                from transformers import pipeline
                self._hf_pipeline = pipeline("text-generation", model=str(candidate_path))
            except Exception:
                pass

    @staticmethod
    def _find_default_model_path() -> Path | None:
        """Locate bundled nora_nlu_model.json across workspace."""
        current = Path(__file__).resolve()
        for parent in current.parents:
            candidate = parent / "ml" / "models" / "nora_nlu_model.json"
            if candidate.is_file():
                return candidate
        return None

    def parse(self, text: str) -> dict[str, Any]:
        """Parse natural-language command using the trained ML model."""
        raw_text = text.strip()
        lower = raw_text.lower()
        if not raw_text:
            return self._format_intent(raw_text, "unknown", None, None, {}, 0.0)

        # 1. Coordinates detection
        coord_m = re.search(
            r"(?:x\s*=\s*|coordinates\s+)?([-\d\.]+)[,\s]+(?:y\s*=\s*)?([-\d\.]+)[,\s]+(?:z\s*=\s*)?([-\d\.]+)",
            lower,
        )
        if coord_m and any(w in lower for w in ["move", "go to", "navigate", "position"]):
            try:
                x = float(coord_m.group(1))
                y = float(coord_m.group(2))
                z = float(coord_m.group(3))
                return self._format_intent(
                    raw_text=raw_text,
                    action="move_to_pose",
                    target_object=None,
                    target_location=None,
                    parameters={"x": x, "y": y, "z": z},
                    confidence=0.95,
                )
            except ValueError:
                pass

        # 2. Check for generalized loop commands (repetitions, counts, plurals, clean, rerack)
        is_clean = any(w in lower for w in ["clean table", "clear table", "tidy table", "empty table", "clean up the table", "clear workspace"])
        is_rerack = any(w in lower for w in ["re rack", "rerack", "re-rack", "rack table", "put back all", "return objects to table", "return items to table"])
        count_m = re.search(r"(?:repeat|run|do\s+this|loop|pick\s+and\s+place)?\s*(\d+)\s*(?:times|x|iterations)", lower)
        is_count = bool(count_m or any(w in lower for w in ["twice", "thrice", "2 times", "3 times", "4 times", "both"]))
        is_quant = any(w in lower for w in ["all objects", "all items", "all blocks", "all cubes", "all cylinders", "everything", "both"])
        has_loop_kw = any(w in lower for w in ["in a loop", "loop pick", "loop", "repeat"])

        if is_clean or is_rerack or is_count or is_quant or has_loop_kw:
            count = 2 if ("twice" in lower or "both" in lower or "2 times" in lower) else 3
            if count_m:
                try:
                    count = int(count_m.group(1))
                except ValueError:
                    pass
            targets = []
            if "cube" in lower or "red" in lower:
                targets.append("red_cube")
            if "cylinder" in lower or "blue" in lower:
                targets.append("blue_cylinder")
            if "sphere" in lower or "green" in lower or "ball" in lower:
                targets.append("green_sphere")
            if not targets:
                targets = ["red_cube", "blue_cylinder", "green_sphere"]

            source = "tray" if (is_rerack or "from tray" in lower) else "table"
            destination = "table" if source == "tray" else ("user" if any(w in lower for w in ["user", "give me", "hand me", "bring me"]) else "tray")
            action_name = "rerack_table" if is_rerack else ("clean_table" if is_clean else "loop_task")

            return self._format_intent(
                raw_text=raw_text,
                action=action_name,
                target_object=", ".join(targets),
                target_location=destination,
                parameters={
                    "is_loop": True,
                    "loop_targets": targets,
                    "loop_count": max(1, count),
                    "source": source,
                    "destination": destination,
                },
                confidence=0.98,
            )

        # 3. Check for explicit known objects mentioned directly
        explicit_obj = None
        if self.model_data:
            for obj in sorted(self.model_data.get("known_objects", []), key=len, reverse=True):
                clean_obj = obj.replace("_", " ")
                if re.search(rf"\b{clean_obj}\b", lower):
                    explicit_obj = obj
                    break

        # 4. Commonsense Mapping (only if no explicit object was named)
        if explicit_obj is None:
            for kw, mapped in _COMMONSENSE_MAP.items():
                if re.search(rf"\b{kw}\b", lower):
                    return self._format_intent(
                        raw_text=raw_text,
                        action=mapped["action"],
                        target_object=mapped["target_object"],
                        target_location=mapped.get("target_location"),
                        parameters={},
                        confidence=0.96,
                    )

        # 3. Statistical model scoring if weights are loaded
        if self.model_data:
            return self._predict_with_model(raw_text)

        # 4. Fallback pattern matching
        return self._predict_heuristic(raw_text)

    def _predict_with_model(self, text: str) -> dict[str, Any]:
        lower = text.lower()
        tokens = self._tokenize(lower)

        weights = self.model_data.get("action_feature_weights", {})
        priors = self.model_data.get("action_priors", {})

        scores: dict[str, float] = {}
        for act in _ACTIONS:
            score = priors.get(act, -10.0)
            act_weights = weights.get(act, {})
            for tok in tokens:
                if tok in act_weights:
                    score += act_weights[tok]
            scores[act] = score

        best_action = max(scores.items(), key=lambda kv: kv[1])[0]

        target_obj = None
        for obj in sorted(self.model_data.get("known_objects", []), key=len, reverse=True):
            clean_obj = obj.replace("_", " ")
            if re.search(rf"\b{clean_obj}\b", lower):
                target_obj = obj
                break

        target_loc = None
        for loc in sorted(self.model_data.get("known_locations", []), key=len, reverse=True):
            clean_loc = loc.replace("_", " ")
            if re.search(rf"\b{clean_loc}\b", lower):
                target_loc = loc
                break

        if target_obj is None and best_action in {"pick", "place"}:
            m = re.search(r"(?:pick|grab|lift|give|hand|bring|pass|place|put)\s+(?:(?:me|us)\s+)?(?:up\s+)?(?:the\s+|a\s+)?([a-zA-Z0-9_-]+)", lower)
            if m:
                target_obj = m.group(1)

        if best_action == "pick" and any(w in lower for w in ["give me", "hand me", "pass me", "bring me"]):
            target_loc = "user"

        return self._format_intent(
            raw_text=text,
            action=best_action,
            target_object=target_obj,
            target_location=target_loc,
            parameters={},
            confidence=0.90,
        )

    def _predict_heuristic(self, text: str) -> dict[str, Any]:
        lower = text.lower()
        if any(w in lower for w in ["home", "park", "reset pose"]):
            return self._format_intent(text, "go_home", None, None, {}, 0.95)
        if any(w in lower for w in ["open gripper", "open hand", "release"]):
            return self._format_intent(text, "open_gripper", None, None, {}, 0.95)
        if any(w in lower for w in ["close gripper", "close hand", "grip"]):
            return self._format_intent(text, "close_gripper", None, None, {}, 0.95)
        if any(w in lower for w in ["pick", "grab", "lift", "give", "hand", "bring"]):
            obj_m = re.search(r"(?:pick|grab|lift|give|hand|bring)\s+(?:(?:me|us)\s+)?(?:up\s+)?(?:the\s+)?([a-zA-Z0-9_-]+)", lower)
            obj = obj_m.group(1) if obj_m else None
            loc = "user" if any(w in lower for w in ["give", "hand", "bring"]) else None
            return self._format_intent(text, "pick", obj, loc, {}, 0.90)
        if any(w in lower for w in ["place", "put", "drop"]):
            loc_m = re.search(r"(?:in|into|on|onto)\s+(?:the\s+)?([a-zA-Z0-9_-]+)", lower)
            loc = loc_m.group(1) if loc_m else None
            return self._format_intent(text, "place", None, loc, {}, 0.90)

        return self._format_intent(text, "unknown", None, None, {}, 0.0)

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        cleaned = re.sub(r"[^\w\s]", " ", text.lower())
        tokens = [t for t in cleaned.split() if t]
        features = list(tokens)
        for i in range(len(tokens) - 1):
            features.append(f"{tokens[i]}_{tokens[i + 1]}")
        return features

    @staticmethod
    def _format_intent(
        raw_text: str,
        action: str,
        target_object: str | None,
        target_location: str | None,
        parameters: dict[str, Any],
        confidence: float,
    ) -> dict[str, Any]:
        return {
            "version": "1.0",
            "command_id": str(uuid.uuid4()),
            "raw_text": raw_text,
            "action": action,
            "target_object": target_object,
            "target_location": target_location,
            "parameters": parameters,
            "confidence": confidence,
        }
