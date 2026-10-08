"""Machine Learning Intent and Entity Model for NORA NLU.

Provides a fast, zero-dependency statistical ML model combining
TF-IDF semantic n-gram vectorization, Naive Bayes / Centroid intent
classification, slot extraction, and commonsense knowledge mapping.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
import re
from typing import Any
import uuid

_VALID_ACTIONS = [
    "pick",
    "place",
    "move_to_pose",
    "open_gripper",
    "close_gripper",
    "go_home",
    "unknown",
]

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


class NLUModel:
    """NORA Natural Language Understanding Machine Learning Model."""

    def __init__(self) -> None:
        self.vocabulary: dict[str, int] = {}
        self.idf: dict[str, float] = {}
        self.action_priors: dict[str, float] = {}
        self.action_feature_weights: dict[str, dict[str, float]] = {}
        self.known_objects: list[str] = []
        self.known_locations: list[str] = []

    # ── Tokenization & Features ───────────────────────────────────────────────

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        cleaned = re.sub(r"[^\w\s]", " ", text.lower())
        tokens = [t for t in cleaned.split() if t]
        # Include unigrams + bigrams for phrase matching
        features = list(tokens)
        for i in range(len(tokens) - 1):
            features.append(f"{tokens[i]}_{tokens[i + 1]}")
        return features

    # ── Training ──────────────────────────────────────────────────────────────

    def fit(self, examples: list[dict[str, Any]]) -> "NLUModel":
        """Train the model on instruction-intent pairs."""
        doc_count = len(examples)
        if doc_count == 0:
            raise ValueError("Cannot fit on empty dataset")

        df: dict[str, int] = {}
        action_counts: dict[str, int] = {act: 0 for act in _VALID_ACTIONS}
        action_word_counts: dict[str, dict[str, int]] = {act: {} for act in _VALID_ACTIONS}
        objects_set: set[str] = set()
        locations_set: set[str] = set()

        for item in examples:
            text = item.get("instruction") or item.get("raw_text") or ""
            intent = item.get("intent", {})
            action = intent.get("action", "unknown")
            if action not in action_counts:
                action = "unknown"

            action_counts[action] += 1
            tokens = set(self._tokenize(text))
            for tok in tokens:
                df[tok] = df.get(tok, 0) + 1
                action_word_counts[action][tok] = action_word_counts[action].get(tok, 0) + 1

            t_obj = intent.get("target_object")
            if t_obj:
                objects_set.add(str(t_obj))
            t_loc = intent.get("target_location")
            if t_loc:
                locations_set.add(str(t_loc))

        # Compute IDF
        self.idf = {tok: math.log((1 + doc_count) / (1 + count)) + 1.0 for tok, count in df.items()}
        self.vocabulary = {tok: idx for idx, tok in enumerate(self.idf.keys())}
        self.known_objects = sorted(list(objects_set))
        self.known_locations = sorted(list(locations_set))

        # Compute priors & Naive Bayes log likelihoods
        total_actions = sum(action_counts.values())
        self.action_priors = {
            act: math.log((cnt + 1.0) / (total_actions + len(_VALID_ACTIONS)))
            for act, cnt in action_counts.items()
        }

        self.action_feature_weights = {}
        for act in _VALID_ACTIONS:
            total_toks = sum(action_word_counts[act].values()) + len(self.idf)
            self.action_feature_weights[act] = {}
            for tok, idf_val in self.idf.items():
                cnt = action_word_counts[act].get(tok, 0)
                prob = (cnt + 0.5) / total_toks
                self.action_feature_weights[act][tok] = math.log(prob) * idf_val

        return self

    # ── Prediction ────────────────────────────────────────────────────────────

    def predict(self, text: str) -> dict[str, Any]:
        """Predict structured intent from natural language input."""
        raw_text = text.strip()
        lower = raw_text.lower()
        if not raw_text:
            return self._format_intent(raw_text, "unknown", None, None, {}, 0.0)

        # 1. Check for coordinates in move_to_pose
        coord_match = re.search(
            r"(?:x\s*=\s*|coordinates\s+)?([-\d\.]+)[,\s]+(?:y\s*=\s*)?([-\d\.]+)[,\s]+(?:z\s*=\s*)?([-\d\.]+)",
            lower,
        )
        if coord_match and any(w in lower for w in ["move", "go to", "navigate", "position"]):
            try:
                x = float(coord_match.group(1))
                y = float(coord_match.group(2))
                z = float(coord_match.group(3))
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

        # 2. Check for explicit known objects mentioned directly
        explicit_obj = None
        for obj in sorted(self.known_objects, key=len, reverse=True):
            clean_obj = obj.replace("_", " ")
            if re.search(rf"\b{clean_obj}\b", lower):
                explicit_obj = obj
                break

        # 3. Check Indirect Commonsense (only if no explicit complex object matched)
        if explicit_obj is None:
            for keyword, mapped in _COMMONSENSE_MAP.items():
                if re.search(rf"\b{keyword}\b", lower):
                    return self._format_intent(
                        raw_text=raw_text,
                        action=mapped["action"],
                        target_object=mapped["target_object"],
                        target_location=mapped.get("target_location"),
                        parameters={},
                        confidence=0.96,
                    )


        # 3. Action classification via feature likelihoods
        tokens = self._tokenize(raw_text)
        scores: dict[str, float] = {}
        for act, weights in self.action_feature_weights.items():
            score = self.action_priors.get(act, -10.0)
            for tok in tokens:
                if tok in weights:
                    score += weights[tok]
            scores[act] = score

        # Softmax over actions for confidence calibration
        max_score = max(scores.values())
        exp_scores = {act: math.exp(s - max_score) for act, s in scores.items()}
        sum_exp = sum(exp_scores.values())
        probs = {act: exp_scores[act] / sum_exp for act in scores}

        best_action = max(probs.items(), key=lambda kv: kv[1])[0]
        confidence = probs[best_action]

        # 4. Extract entities (target_object & target_location)
        target_object, target_location = self._extract_entities(raw_text, best_action)

        # If action is pick and user asks "give me", default destination is user
        if best_action == "pick" and any(w in lower for w in ["give me", "hand me", "pass me", "bring me"]):
            target_location = "user"

        return self._format_intent(
            raw_text=raw_text,
            action=best_action,
            target_object=target_object,
            target_location=target_location,
            parameters={},
            confidence=round(confidence, 2),
        )

    def _extract_entities(self, text: str, action: str) -> tuple[str | None, str | None]:
        lower = text.lower()
        target_object = None
        target_location = None

        # Check known objects
        for obj in sorted(self.known_objects, key=len, reverse=True):
            clean_obj = obj.replace("_", " ")
            if re.search(rf"\b{clean_obj}\b", lower):
                target_object = obj
                break

        # Check known locations
        for loc in sorted(self.known_locations, key=len, reverse=True):
            clean_loc = loc.replace("_", " ")
            if re.search(rf"\b{clean_loc}\b", lower):
                target_location = loc
                break

        # Fallback regex for object
        if target_object is None and action in {"pick", "place"}:
            obj_m = re.search(
                r"(?:pick|grab|lift|give|hand|bring|pass|place|put|drop)\s+(?:(?:me|us)\s+)?(?:up\s+)?(?:the\s+|a\s+|an\s+)?([a-zA-Z0-9_-]+(?:\s+[a-zA-Z0-9_-]+)?)",
                lower,
            )
            if obj_m:
                candidate = obj_m.group(1).strip().replace(" ", "_")
                if candidate not in {"coordinates", "pose", "home", "gripper", "hand"}:
                    target_object = candidate

        # Fallback regex for location
        if target_location is None and action in {"pick", "place"}:
            loc_m = re.search(r"(?:in|into|on|onto|from|at)\s+(?:the\s+|a\s+|an\s+)?([a-zA-Z0-9_-]+)", lower)
            if loc_m:
                candidate = loc_m.group(1).strip().replace(" ", "_")
                if candidate not in {"table", "shelf", "bin", "tray"} and candidate == target_object:
                    pass
                else:
                    target_location = candidate

        return target_object, target_location

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

    # ── Persistence ───────────────────────────────────────────────────────────

    def save(self, filepath: str | Path) -> None:
        """Save model parameters to JSON file."""
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "vocabulary": self.vocabulary,
            "idf": self.idf,
            "action_priors": self.action_priors,
            "action_feature_weights": self.action_feature_weights,
            "known_objects": self.known_objects,
            "known_locations": self.known_locations,
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def load(self, filepath: str | Path) -> "NLUModel":
        """Load model parameters from JSON file."""
        path = Path(filepath)
        if not path.is_file():
            raise FileNotFoundError(f"Model file not found: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        self.vocabulary = data["vocabulary"]
        self.idf = data["idf"]
        self.action_priors = data["action_priors"]
        self.action_feature_weights = data["action_feature_weights"]
        self.known_objects = data["known_objects"]
        self.known_locations = data["known_locations"]
        return self
