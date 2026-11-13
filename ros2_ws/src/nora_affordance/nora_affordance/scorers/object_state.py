"""World-model state of the target object; see :mod:`nora_affordance.scoring`."""

from __future__ import annotations

from typing import Optional, Sequence

from nora_affordance import scoring
from nora_affordance.scorers.base import BaseScorer


class ObjectStateScorer(BaseScorer):
    """Set ``objects`` (world-model objects) before scoring."""

    def __init__(self, params: scoring.Params = scoring.Params()) -> None:
        self.params = params
        self.objects: Optional[Sequence[dict]] = None

    def score(self, intent_dict: dict, skill_name: str) -> float:
        return scoring.object_state_score(skill_name, intent_dict, self.objects, self.params)[0]
