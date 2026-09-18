"""Affordance scoring dataclasses and abstract base scorer.

:class:`AffordanceScore` is the canonical result type returned by any
:class:`BaseScorer` implementation, and consumed by
:class:`~nora_core.planner.Planner`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

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
        Fused score (e.g. weighted geometric mean of usefulness and
        feasibility), in ``[0.0, 1.0]``.
    breakdown:
        Optional fine-grained sub-scores (e.g. reachability, collision_free,
        object_state) for debugging and logging.
    """

    skill_name: str
    usefulness: float
    feasibility: float
    combined_score: float
    breakdown: dict[str, Any] = field(default_factory=dict)


class BaseScorer(ABC):
    """Abstract base class for affordance scorers.

    Subclasses must implement :meth:`score_usefulness` and
    :meth:`score_feasibility`.  The concrete :meth:`score` method combines
    them via a :class:`~nora_core.affordance.fusion.WeightedProductFusion`
    instance, or subclasses may override it.
    """

    @abstractmethod
    def score_usefulness(self, intent: Intent, skill_name: str) -> float:
        """Estimate how useful *skill_name* is for satisfying *intent*.

        Parameters
        ----------
        intent:
            The current structured intent.
        skill_name:
            The skill to evaluate.

        Returns
        -------
        float
            Value in ``[0.0, 1.0]``.  Higher is more useful.
        """
        ...

    @abstractmethod
    def score_feasibility(self, intent: Intent, skill_name: str) -> float:
        """Estimate how feasible *skill_name* is given current world state.

        Parameters
        ----------
        intent:
            The current structured intent.
        skill_name:
            The skill to evaluate.

        Returns
        -------
        float
            Value in ``[0.0, 1.0]``.  Higher is more feasible.
        """
        ...

    def score(self, intent: Intent, skill_name: str) -> AffordanceScore:
        """Compute a full :class:`AffordanceScore` for *skill_name*.

        Default implementation calls :meth:`score_usefulness` and
        :meth:`score_feasibility`, then fuses them with equal weights (0.5/0.5)
        via :class:`~nora_core.affordance.fusion.WeightedProductFusion`.

        Parameters
        ----------
        intent:
            The current structured intent.
        skill_name:
            The skill to evaluate.

        Returns
        -------
        AffordanceScore
        """
        # TODO(nora): allow scorer instances to carry their own fusion config
        from nora_core.affordance.fusion import WeightedProductFusion

        usefulness = self.score_usefulness(intent, skill_name)
        feasibility = self.score_feasibility(intent, skill_name)
        fusion = WeightedProductFusion(weights={"usefulness": 0.5, "feasibility": 0.5})
        combined = fusion.fuse(usefulness, feasibility)
        return AffordanceScore(
            skill_name=skill_name,
            usefulness=usefulness,
            feasibility=feasibility,
            combined_score=combined,
        )
