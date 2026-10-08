"""
nora_nlu_node/mock_parser.py
─────────────────────────────
Rule-based / mock fallback parser for NLU testing and offline development.
Requires zero external models or servers.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from nora_nlu_node.intent_parser import IntentParser


class MockIntentParser(IntentParser):
    """Regex/keyword-based intent parser for testing and offline fallback."""

    def parse(self, text: str) -> dict[str, Any]:
        raw_text = text.strip()
        lower = raw_text.lower()

        action = "unknown"
        target_object = None
        target_location = None
        confidence = 0.0

        if any(w in lower for w in ["home", "rest pose", "reset"]):
            action = "go_home"
            confidence = 0.95
        elif any(w in lower for w in ["open gripper", "open hand", "release"]):
            action = "open_gripper"
            confidence = 0.95
        elif any(w in lower for w in ["close gripper", "close hand", "grip"]):
            action = "close_gripper"
            confidence = 0.95
        elif any(w in lower for w in ["pick", "grab", "lift", "take", "give", "hand", "bring", "fetch", "pass"]):
            action = "pick"
            confidence = 0.90
            obj_match = re.search(r"(?:pick|grab|lift|take|give|hand|bring|fetch|pass)\s+(?:(?:me|us)\s+)?(?:up\s+)?(?:the\s+|a\s+|an\s+)?([a-zA-Z0-9_-]+(?:\s+[a-zA-Z0-9_-]+)?)", lower)
            if obj_match:
                target_object = obj_match.group(1).replace(" ", "_")
        elif any(w in lower for w in ["place", "put", "drop"]):
            action = "place"
            confidence = 0.90
            loc_match = re.search(r"(?:in|into|on|onto|at)\s+(?:the\s+)?([a-zA-Z0-9_-]+)", lower)
            if loc_match:
                target_location = loc_match.group(1).replace(" ", "_")
        elif any(w in lower for w in ["move to", "navigate to"]):
            action = "move_to_pose"
            confidence = 0.85

        return {
            "version": "1.0",
            "command_id": str(uuid.uuid4()),
            "raw_text": raw_text,
            "action": action,
            "target_object": target_object,
            "target_location": target_location,
            "parameters": {},
            "confidence": confidence,
        }

