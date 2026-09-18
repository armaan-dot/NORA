"""
nora_nlu_node/mock_parser.py
──────────────────────────────
Rule-based NLU backend — no ML model required.

This parser is the default backend used in simulation and during development.
It maps keyword patterns to actions and extracts simple colour+object mentions.

Supported actions
-----------------
* ``pick``          — keywords: pick, grab, get
* ``place``         — keywords: place, put
* ``go_home``       — keyword: home
* ``open_gripper``  — keyword: open
* ``close_gripper`` — keyword: close

Supported objects
-----------------
Colours: red, blue, green, yellow, orange, purple
Objects: cube, cylinder, sphere, block, box, bottle, can
"""

from __future__ import annotations

import re

from nora_nlu_node.intent_parser import IntentParser

# ── Keyword tables ────────────────────────────────────────────────────────────

_ACTION_KEYWORDS: list[tuple[str, list[str]]] = [
    ("pick",          ["pick", "grab", "get", "take", "lift", "grasp"]),
    ("place",         ["place", "put", "drop", "set", "release"]),
    ("go_home",       ["home", "reset", "return"]),
    ("open_gripper",  ["open"]),
    ("close_gripper", ["close"]),
]

_COLOURS: list[str] = [
    "red", "blue", "green", "yellow", "orange", "purple", "white", "black",
]

_OBJECTS: list[str] = [
    "cube", "cylinder", "sphere", "block", "box", "bottle", "can", "object",
]

# Pre-compile colour + object pattern, e.g. "red cube", "blue cylinder"
_OBJECT_PATTERN = re.compile(
    r"\b(" + "|".join(_COLOURS) + r")\s+(" + "|".join(_OBJECTS) + r")\b",
    re.IGNORECASE,
)

_CONFIDENCE_MATCH   = 0.85
_CONFIDENCE_UNKNOWN = 0.30


class MockRuleBasedParser(IntentParser):
    """Keyword-driven rule-based parser — fully working, no dependencies.

    Suitable for unit tests, simulation bringup, and as a fallback when
    no ML model is available.
    """

    # ── Public API ─────────────────────────────────────────────────────────────

    def parse(self, text: str) -> dict:
        """Parse *text* into a structured intent dict.

        Parameters
        ----------
        text:
            Raw natural-language command.

        Returns
        -------
        dict
            Keys: ``action``, ``target_object``, ``confidence``, ``raw_text``.
        """
        lowered = text.lower()
        action = self._match_action(lowered)
        target_object = self._extract_object(lowered)
        confidence = _CONFIDENCE_MATCH if action != "unknown" else _CONFIDENCE_UNKNOWN

        return {
            "action": action,
            "target_object": target_object,
            "confidence": confidence,
            "raw_text": text,
        }

    # ── Private helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _match_action(lowered: str) -> str:
        """Return the first action whose keywords appear in *lowered*."""
        tokens = set(re.findall(r"\b\w+\b", lowered))
        for action, keywords in _ACTION_KEYWORDS:
            if tokens.intersection(keywords):
                return action
        return "unknown"

    @staticmethod
    def _extract_object(lowered: str) -> str:
        """Return 'colour object' string if found, else empty string."""
        match = _OBJECT_PATTERN.search(lowered)
        if match:
            return f"{match.group(1).lower()} {match.group(2).lower()}"
        return ""
