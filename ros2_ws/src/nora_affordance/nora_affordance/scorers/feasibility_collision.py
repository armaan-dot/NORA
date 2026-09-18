"""
nora_affordance/scorers/feasibility_collision.py
─────────────────────────────────────────────────
Collision-checking feasibility scorer.

Estimates whether executing a skill is likely to cause a collision with
the environment, other objects, or the robot's own body.
"""

from __future__ import annotations

from nora_affordance.scorers.base import BaseScorer

_MOCK_SCORE = 0.85


class CollisionScorer(BaseScorer):
    """Scores collision-free feasibility of executing a skill.

    Parameters
    ----------
    planning_scene_topic:
        ROS topic on which the MoveIt PlanningScene is published.
    """

    def __init__(
        self, planning_scene_topic: str = "/planning_scene"
    ) -> None:
        self._planning_scene_topic = planning_scene_topic

        # TODO(nora): Subscribe to PlanningScene and maintain a local copy, e.g.:
        #   self._scene = None
        #   # (subscribe from the node's context, not here)

    def score(self, intent_dict: dict, skill_name: str) -> float:
        """Score the collision-free feasibility of *skill_name* for *intent_dict*.

        Parameters
        ----------
        intent_dict:
            Parsed intent (keys: action, target_object, confidence, raw_text).
        skill_name:
            Candidate skill identifier.

        Returns
        -------
        float
            Collision-free score in ``[0.0, 1.0]``.  1.0 = no collision expected.
        """
        # TODO(nora): Check collision against the current planning scene, e.g.:
        #   trajectory = self._plan_trajectory(skill_name, intent_dict)
        #   if trajectory is None:
        #       return 0.0
        #   return 1.0 if not self._has_collision(trajectory) else 0.0
        return _MOCK_SCORE
