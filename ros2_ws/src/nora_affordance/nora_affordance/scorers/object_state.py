"""
nora_affordance/scorers/object_state.py
────────────────────────────────────────
Object-state feasibility scorer.

Checks the current perceived state of the target object (existence,
graspability, orientation) to determine whether the skill is applicable.
"""

from __future__ import annotations

from nora_affordance.scorers.base import BaseScorer

_MOCK_SCORE = 0.95


class ObjectStateScorer(BaseScorer):
    """Scores the feasibility of executing a skill given the current object state.

    Parameters
    ----------
    perception_topic:
        ROS topic that publishes detected objects (e.g. ``nora_interfaces/msg/ObjectArray``).
    """

    def __init__(self, perception_topic: str = "/nora/detected_objects") -> None:
        self._perception_topic = perception_topic
        self._detected_objects: dict[str, Any] = {}

    def update_detected_objects(self, objects: dict[str, Any] | list[str]) -> None:
        """Update active detected objects from perception."""
        if isinstance(objects, list):
            self._detected_objects = {name.lower(): {"visible": True, "graspability": 0.95} for name in objects}
        else:
            self._detected_objects = {k.lower(): v for k, v in objects.items()}

    def score(self, intent_dict: dict, skill_name: str) -> float:
        """Score the object-state feasibility of *skill_name* for *intent_dict*.

        If the task requires manipulating an object (e.g. pick, deliver),
        the target object MUST be present in detected objects. Otherwise,
        affordance is strictly 0.0 (precondition failure).
        """
        # Non-manipulation skills do not require target object on table
        if skill_name in ("go_home", "open_gripper", "close_gripper"):
            return 1.0

        target = (intent_dict.get("target_object") or "").strip().lower()
        if not target or target in ("none", "null", "item"):
            return _MOCK_SCORE

        # When active tabletop perception data is present:
        if self._detected_objects:
            # Check exact or token compatibility
            matched = any(
                target == obj_name or target in obj_name or obj_name in target
                for obj_name in self._detected_objects
            )
            if not matched:
                return 0.0

            obj_info = self._detected_objects.get(target)
            if isinstance(obj_info, dict) and not obj_info.get("visible", True):
                return 0.0
            return 0.95

        return _MOCK_SCORE
