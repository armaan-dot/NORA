"""Affordance scoring dataclasses and abstract base scorer.

:class:`AffordanceScore` is the canonical result type returned by any
:class:`BaseScorer` implementation, and consumed by
:class:`~nora_core.planner.Planner`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from nora_core.affordance.environment import WorldState
from nora_core.affordance.fusion import WeightedProductFusion
from nora_core.intent import Intent


@dataclass
class AffordanceScore:
    """Scored affordance of a skill relative to an intent.

    Attributes
    ----------
    skill_name:
        The name of the skill this score applies to.
    usefulness:
        How well the skill addresses the intent, in ``[0.0, 1.0]``.
    feasibility:
        How executable the skill is given current world state, in
        ``[0.0, 1.0]``.
    combined_score:
        Fused score (weighted geometric mean of usefulness and
        feasibility), in ``[0.0, 1.0]``.
    breakdown:
        Fine-grained sub-scores (reachability, collision_free,
        object_state, preconditions) for diagnostics and explainability.
    """

    skill_name: str
    usefulness: float
    feasibility: float
    combined_score: float
    breakdown: dict[str, Any] = field(default_factory=dict)


class BaseScorer(ABC):
    """Abstract base class for affordance scorers.

    Subclasses must implement :meth:`score_usefulness` and
    :meth:`score_feasibility`.
    """

    def __init__(
        self,
        usefulness_weight: float = 0.6,
        feasibility_weight: float = 0.4,
    ) -> None:
        self.fusion = WeightedProductFusion(
            {"usefulness": usefulness_weight, "feasibility": feasibility_weight}
        )

    @abstractmethod
    def score_usefulness(self, intent: Intent, skill_name: str) -> float:
        """Estimate how useful *skill_name* is for satisfying *intent*."""
        ...

    @abstractmethod
    def score_feasibility(self, intent: Intent, skill_name: str) -> float:
        """Estimate how feasible *skill_name* is given current world state."""
        ...

    def score(self, intent: Intent, skill_name: str) -> AffordanceScore:
        """Compute a full :class:`AffordanceScore` for *skill_name*."""
        usefulness = self.score_usefulness(intent, skill_name)
        feasibility = self.score_feasibility(intent, skill_name)
        combined = self.fusion.fuse(usefulness, feasibility)
        return AffordanceScore(
            skill_name=skill_name,
            usefulness=usefulness,
            feasibility=feasibility,
            combined_score=combined,
        )


class AffordanceScorer(BaseScorer):
    """Production-grade Affordance Scorer combining semantic usefulness with physical feasibility.

    Evaluates candidate skills against the current Intent and physical WorldState,
    implementing the SayCan paradigm where a skill must be both linguistically
    useful AND physically feasible to receive a high combined score.

    Parameters
    ----------
    world_state:
        The current environmental and robot state. If omitted, defaults to
        :meth:`WorldState.default()`.
    usefulness_weight:
        Weight $w_u$ for usefulness in the geometric product (default 0.6).
    feasibility_weight:
        Weight $w_f$ for feasibility in the geometric product (default 0.4).
    """

    def __init__(
        self,
        world_state: WorldState | None = None,
        usefulness_weight: float = 0.6,
        feasibility_weight: float = 0.4,
    ) -> None:
        super().__init__(
            usefulness_weight=usefulness_weight,
            feasibility_weight=feasibility_weight,
        )
        self.world_state = world_state if world_state is not None else WorldState.default()

    def score_usefulness(self, intent: Intent, skill_name: str) -> float:
        """Compute semantic usefulness of *skill_name* for *intent*."""
        action = intent.action.value if hasattr(intent.action, "value") else str(intent.action)
        confidence = max(0.1, min(1.0, float(intent.confidence)))

        if action == "unknown":
            return 0.10

        # Direct primary match
        if skill_name == action:
            return round(0.95 * confidence, 4)

        # Preparatory and composite relations
        if action == "pick":
            if skill_name == "open_gripper":
                # Useful prerequisite if gripper is closed or holding
                return round(0.65 * confidence, 4) if self.world_state.robot.gripper_state != "open" else 0.20
            if skill_name == "move_to_pose":
                return round(0.60 * confidence, 4)
            if skill_name == "go_home":
                return 0.15
            return 0.10

        if action == "place":
            if skill_name == "open_gripper":
                # Opening gripper releases placed object
                return round(0.70 * confidence, 4)
            if skill_name == "move_to_pose":
                return round(0.60 * confidence, 4)
            if skill_name == "go_home":
                return 0.20
            return 0.10

        if action == "open_gripper":
            return round(0.95 * confidence, 4) if skill_name == "open_gripper" else 0.10

        if action == "close_gripper":
            return round(0.95 * confidence, 4) if skill_name == "close_gripper" else 0.10

        if action == "go_home":
            return round(0.95 * confidence, 4) if skill_name == "go_home" else 0.10

        if action == "move_to_pose":
            return round(0.95 * confidence, 4) if skill_name == "move_to_pose" else 0.15

        return 0.10

    def score_feasibility(self, intent: Intent, skill_name: str) -> float:
        """Compute physical feasibility of *skill_name* given current *world_state*."""
        subscores = self._compute_feasibility_breakdown(intent, skill_name)
        feasibility = (
            subscores["reachability"]
            * subscores["collision_free"]
            * subscores["object_state"]
            * subscores["preconditions"]
        )
        return round(feasibility, 4)

    def _compute_feasibility_breakdown(self, intent: Intent, skill_name: str) -> dict[str, float]:
        """Compute fine-grained physical feasibility components."""
        reachability = 1.0
        collision_free = 1.0
        object_state = 1.0
        preconditions = 1.0

        robot = self.world_state.robot
        target_obj_name = intent.target_object
        target_loc_name = intent.target_location

        if skill_name == "pick":
            # 1. Object state: Target object must exist and be visible
            if target_obj_name:
                obj = self.world_state.get_or_create_object(target_obj_name)
                if not obj.is_visible:
                    object_state = 0.0
                elif obj.is_grasped:
                    object_state = 0.0  # Already grasped
                elif not obj.is_graspable:
                    object_state = 0.2
                else:
                    object_state = 1.0

                # 2. Reachability: Object position in reach
                if not robot.is_reachable(*obj.position):
                    reachability = 0.0

                # 3. Collision: Object clearance
                if obj.is_obstructed:
                    collision_free = 0.2
            else:
                object_state = 0.5  # Unknown object target

            # 4. Precondition: Arm cannot already be holding an object
            if robot.held_object is not None or robot.gripper_state == "holding":
                preconditions = 0.0

        elif skill_name == "place":
            # 1. Precondition & Object state: Must currently hold an object to place it
            if robot.held_object is None:
                preconditions = 0.0
                object_state = 0.0
            else:
                preconditions = 1.0
                object_state = 1.0

            # 2. Reachability: Destination location in reach
            if target_loc_name:
                loc = self.world_state.get_or_create_location(target_loc_name)
                if not loc.reachable:
                    reachability = 0.0

        elif skill_name == "open_gripper":
            # Precondition: Useful if not already open
            preconditions = 1.0 if robot.gripper_state != "open" else 0.4

        elif skill_name == "close_gripper":
            # Precondition: Useful if open
            preconditions = 1.0 if robot.gripper_state == "open" else 0.2

        elif skill_name == "go_home":
            preconditions = 1.0
            reachability = 1.0

        elif skill_name == "move_to_pose":
            preconditions = 1.0
            reachability = 1.0

        return {
            "reachability": reachability,
            "collision_free": collision_free,
            "object_state": object_state,
            "preconditions": preconditions,
        }

    def score(self, intent: Intent, skill_name: str) -> AffordanceScore:
        """Compute full AffordanceScore with detailed diagnostic breakdown."""
        usefulness = self.score_usefulness(intent, skill_name)
        breakdown = self._compute_feasibility_breakdown(intent, skill_name)
        feasibility = round(
            breakdown["reachability"]
            * breakdown["collision_free"]
            * breakdown["object_state"]
            * breakdown["preconditions"],
            4,
        )
        combined = self.fusion.fuse(usefulness, feasibility)

        breakdown["confidence"] = round(float(intent.confidence), 4)

        return AffordanceScore(
            skill_name=skill_name,
            usefulness=usefulness,
            feasibility=feasibility,
            combined_score=round(combined, 4),
            breakdown=breakdown,
        )

    def score_all_skills(
        self,
        intent: Intent,
        candidate_skills: list[str] | None = None,
    ) -> list[AffordanceScore]:
        """Score all candidate skills for the given intent.

        Parameters
        ----------
        intent:
            The structured intent to evaluate against.
        candidate_skills:
            Optional list of candidate skill names. Defaults to standard
            NORA skills: ``["pick", "place", "move_to_pose", "open_gripper", "close_gripper", "go_home"]``.
        """
        if candidate_skills is None:
            candidate_skills = [
                "pick",
                "place",
                "move_to_pose",
                "open_gripper",
                "close_gripper",
                "go_home",
            ]

        return [self.score(intent, skill) for skill in candidate_skills]
