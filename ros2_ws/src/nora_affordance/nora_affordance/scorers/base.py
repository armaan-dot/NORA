"""
nora_affordance/scorers/base.py
────────────────────────────────
Abstract base class for all affordance scorers.

All scorers receive the current parsed intent and a candidate skill name,
and return a scalar score in [0, 1].  Higher is better.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseScorer(ABC):
    """Abstract base class for all affordance scorers.

    Subclasses implement :meth:`score` and return a float in ``[0.0, 1.0]``.

    Parameters are injected at construction time by the
    :class:`~nora_affordance.affordance_node.AffordanceNode`.
    """

    @abstractmethod
    def score(self, intent_dict: dict, skill_name: str) -> float:
        """Score the affordance of executing *skill_name* given *intent_dict*.

        Parameters
        ----------
        intent_dict:
            Parsed intent dict from the NLU node (keys: action, target_object,
            confidence, raw_text).
        skill_name:
            Name of the candidate skill to evaluate, e.g. ``"pick_red_cube"``.

        Returns
        -------
        float
            Affordance score in ``[0.0, 1.0]``.  Higher means more appropriate.
        """
        ...
