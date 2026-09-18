"""Planner module for NORA.

Converts a list of :class:`~nora_core.affordance.scoring.AffordanceScore`
objects into an ordered :class:`SkillPlan` — the concrete sequence of skills
the robot should attempt, ranked by combined affordance score.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from nora_core.intent import Intent
from nora_core.affordance.scoring import AffordanceScore

_DEFAULT_TOP_K = 5


@dataclass
class SkillPlan:
    """A ranked skill candidate ready for dispatch.

    Attributes
    ----------
    skill_name:
        The name of the skill to execute.
    score:
        The combined affordance score that determined this skill's ranking.
    params:
        Parameter overrides to pass to the skill's action server.
    """

    skill_name: str
    score: float
    params: dict[str, Any] = field(default_factory=dict)


class Planner:
    """Ranks skill candidates by affordance score and returns a plan.

    Parameters
    ----------
    top_k:
        Maximum number of :class:`SkillPlan` entries to return.
        Defaults to :data:`_DEFAULT_TOP_K`.

    Example
    -------
    >>> planner = Planner(top_k=3)
    >>> plans = planner.rank_skills(intent, affordance_scores)
    >>> best = plans[0]
    """

    def __init__(self, top_k: int = _DEFAULT_TOP_K) -> None:
        if top_k < 1:
            raise ValueError(f"top_k must be >= 1, got {top_k!r}")
        self._top_k = top_k

    def rank_skills(
        self,
        intent: Intent,
        scores: list[AffordanceScore],
    ) -> list[SkillPlan]:
        """Sort *scores* descending by ``combined_score`` and return top-k plans.

        Parameters
        ----------
        intent:
            The current intent (reserved for future parameter extraction).
        scores:
            Affordance scores for each candidate skill.

        Returns
        -------
        list[SkillPlan]
            Up to :attr:`top_k` :class:`SkillPlan` objects, best skill first.
            Returns an empty list when *scores* is empty.
        """
        if not scores:
            return []

        ranked = sorted(scores, key=lambda s: s.combined_score, reverse=True)
        top = ranked[: self._top_k]

        return [
            SkillPlan(
                skill_name=aff.skill_name,
                score=aff.combined_score,
                # TODO(nora): extract per-skill params from intent.parameters
                params={},
            )
            for aff in top
        ]
