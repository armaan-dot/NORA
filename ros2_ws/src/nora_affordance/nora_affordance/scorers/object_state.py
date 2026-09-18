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

        # TODO(nora): Subscribe to perception topic and maintain a dict of
        #             detected object states, e.g.:
        #   self._detected_objects: dict[str, ObjectState] = {}

    def score(self, intent_dict: dict, skill_name: str) -> float:
        """Score the object-state feasibility of *skill_name* for *intent_dict*.

        Parameters
        ----------
        intent_dict:
            Parsed intent (keys: action, target_object, confidence, raw_text).
        skill_name:
            Candidate skill identifier.

        Returns
        -------
        float
            Object-state score in ``[0.0, 1.0]``.
        """
        # TODO(nora): Check perception data for the target object, e.g.:
        #   target = intent_dict.get("target_object", "")
        #   obj_state = self._detected_objects.get(target)
        #   if obj_state is None:
        #       return 0.0  # object not detected
        #   return obj_state.graspability_score
        return _MOCK_SCORE
