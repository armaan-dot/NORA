"""Usefulness of a skill for the intent action; see :mod:`nora_affordance.scoring`.

Deterministic: a relevance table scaled by the parse confidence. No language
model is called.
"""

from __future__ import annotations

from nora_affordance import scoring
from nora_affordance.scorers.base import BaseScorer


class UsefulnessScorer(BaseScorer):
    def score(self, intent_dict: dict, skill_name: str) -> float:
        return scoring.usefulness_score(skill_name, intent_dict)
