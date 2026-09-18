"""
nora_affordance/scorers/feasibility_reachability.py
────────────────────────────────────────────────────
IK-based reachability feasibility scorer.

Checks whether the robot can physically reach the target object pose using
inverse kinematics.  Returns 1.0 if reachable, 0.0 if not.
"""

from __future__ import annotations

from nora_affordance.scorers.base import BaseScorer

_MOCK_SCORE = 0.9


class ReachabilityScorer(BaseScorer):
    """Scores the IK reachability of executing a skill.

    Parameters
    ----------
    planning_group:
        MoveIt planning group name (default ``"arm"``).
    """

    def __init__(self, planning_group: str = "arm") -> None:
        self._planning_group = planning_group

        # TODO(nora): Initialise MoveIt / KDL IK interface here, e.g.:
        #   from moveit.python_tools import RobotCommander
        #   self._robot = RobotCommander()

    def score(self, intent_dict: dict, skill_name: str) -> float:
        """Score the IK reachability of *skill_name* for *intent_dict*.

        Parameters
        ----------
        intent_dict:
            Parsed intent (keys: action, target_object, confidence, raw_text).
        skill_name:
            Candidate skill identifier.

        Returns
        -------
        float
            Reachability score in ``[0.0, 1.0]``.
        """
        # TODO(nora): Check IK feasibility for the target object pose, e.g.:
        #   target_pose = self._lookup_object_pose(intent_dict["target_object"])
        #   ik_solution = self._robot.get_group(self._planning_group).get_ik(target_pose)
        #   return 1.0 if ik_solution is not None else 0.0
        return _MOCK_SCORE
