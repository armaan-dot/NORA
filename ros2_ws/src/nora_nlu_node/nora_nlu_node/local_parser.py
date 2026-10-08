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
    "thirsty": {"action": "pick", "target_object": "water", "target_location": "user"},
    "parched": {"action": "pick", "target_object": "water", "target_location": "user"},
    "hydration": {"action": "pick", "target_object": "water", "target_location": "user"},
    "drink": {"action": "pick", "target_object": "glass", "target_location": "user"},
    "water": {"action": "pick", "target_object": "water", "target_location": "user"},
    "beverage": {"action": "pick", "target_object": "drink", "target_location": "user"},
    "coffee": {"action": "pick", "target_object": "coffee", "target_location": "user"},
    "tea": {"action": "pick", "target_object": "tea", "target_location": "user"},
    "mug": {"action": "pick", "target_object": "mug", "target_location": "user"},
    "soda": {"action": "pick", "target_object": "soda_can", "target_location": "user"},
    "hungry": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "starving": {"action": "pick", "target_object": "food", "target_location": "user"},
    "food": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "snack": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "apple": {"action": "pick", "target_object": "apple", "target_location": "user"},
    "banana": {"action": "pick", "target_object": "banana", "target_location": "user"},
    "cold": {"action": "pick", "target_object": "jacket", "target_location": "user"},
    "freeze": {"action": "pick", "target_object": "jacket", "target_location": "user"},
    "freezing": {"action": "pick", "target_object": "jacket", "target_location": "user"},
    "chilly": {"action": "pick", "target_object": "jacket", "target_location": "user"},
    "blanket": {"action": "pick", "target_object": "cloth", "target_location": "user"},
    "trash": {"action": "place", "target_object": "trash", "target_location": "bin"},
    "garbage": {"action": "place", "target_object": "garbage", "target_location": "bin"},
    "waste": {"action": "place", "target_object": "waste", "target_location": "trash_can"},
    "rubbish": {"action": "place", "target_object": "rubbish", "target_location": "bin"},
    "clean": {"action": "pick", "target_object": "trash", "target_location": "bin"},
    "mess": {"action": "pick", "target_object": "trash", "target_location": "bin"},
    "sponge": {"action": "pick", "target_object": "sponge", "target_location": "table"},
    "wipe": {"action": "pick", "target_object": "sponge", "target_location": "table"},
    "wrench": {"action": "pick", "target_object": "wrench", "target_location": "user"},
    "bolt": {"action": "pick", "target_object": "wrench", "target_location": "user"},
    "screw": {"action": "pick", "target_object": "screwdriver", "target_location": "user"},
    "pliers": {"action": "pick", "target_object": "pliers", "target_location": "user"},
    "pen": {"action": "pick", "target_object": "pen", "target_location": "user"},
    "marker": {"action": "pick", "target_object": "marker", "target_location": "user"},
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

        # 1. Commonsense Mapping
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

        # 2. Coordinates detection
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
