"""Clearance of a top-down approach from other objects; see :mod:`nora_affordance.scoring`."""

from __future__ import annotations

from typing import Optional, Sequence

from nora_affordance import scoring
from nora_affordance.scorers.base import BaseScorer


class CollisionScorer(BaseScorer):
    """Set ``objects`` (world-model objects) before scoring."""

    def __init__(self, params: scoring.Params = scoring.Params()) -> None:
        self.params = params
        self.objects: Optional[Sequence[dict]] = None

    def score(self, intent_dict: dict, skill_name: str) -> float:
        scores, _ = scoring.feasibility_scores(
            skill_name, intent_dict, self.objects, None, self.params
        )
        return scores["collision_free"]
