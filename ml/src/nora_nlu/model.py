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
    "thirsty": {"action": "pick", "target_object": "water", "target_location": "user"},
    "parched": {"action": "pick", "target_object": "water", "target_location": "user"},
    "drink": {"action": "pick", "target_object": "glass", "target_location": "user"},
    "water": {"action": "pick", "target_object": "water", "target_location": "user"},
    "beverage": {"action": "pick", "target_object": "drink", "target_location": "user"},
    "hungry": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "food": {"action": "pick", "target_object": "snack", "target_location": "user"},
    "cold": {"action": "pick", "target_object": "jacket", "target_location": None},
    "freeze": {"action": "pick", "target_object": "jacket", "target_location": None},
    "trash": {"action": "place", "target_object": "trash", "target_location": "bin"},
    "garbage": {"action": "place", "target_object": "garbage", "target_location": "bin"},
    "clean": {"action": "pick", "target_object": "trash", "target_location": "bin"},
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

        # 1. Check Commonsense Association first
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

        # 2. Extract Coordinates for move_to_pose if present
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
