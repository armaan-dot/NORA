"""Weighted geometric mean fusion for affordance sub-scores.

:class:`WeightedProductFusion` implements the formula::

    combined = usefulness^w_u * feasibility^w_f

where ``w_u`` and ``w_f`` are the weights for usefulness and feasibility
respectively, and must sum to ``1.0``.
"""

from __future__ import annotations

import math

_WEIGHT_SUM_TOLERANCE = 1e-9


class WeightedProductFusion:
    """Fuse usefulness and feasibility via a weighted geometric mean.

    Parameters
    ----------
    weights:
        Dictionary with keys ``"usefulness"`` and ``"feasibility"`` whose
        values are non-negative floats that must sum to ``1.0``.

    Raises
    ------
    ValueError
        If required keys are missing, any weight is negative, or the weights
        do not sum to ``1.0`` (within :data:`_WEIGHT_SUM_TOLERANCE`).

    Example
    -------
    >>> fusion = WeightedProductFusion({"usefulness": 0.6, "feasibility": 0.4})
    >>> score = fusion.fuse(0.8, 0.9)
    >>> round(score, 4)
    0.8379
    """

    def __init__(self, weights: dict[str, float]) -> None:
        self._w_u = self._validate_weight(weights, "usefulness")
        self._w_f = self._validate_weight(weights, "feasibility")

        weight_sum = self._w_u + self._w_f
        if abs(weight_sum - 1.0) > _WEIGHT_SUM_TOLERANCE:
            raise ValueError(
                f"Weights must sum to 1.0, but got {weight_sum} "
                f"(usefulness={self._w_u}, feasibility={self._w_f})"
            )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_weight(weights: dict[str, float], key: str) -> float:
        """Extract and validate a single weight value."""
        if key not in weights:
            raise ValueError(f"Missing required weight key: {key!r}")
        v = float(weights[key])
        if v < 0.0:
            raise ValueError(f"Weight for {key!r} must be non-negative, got {v}")
        return v

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def fuse(self, usefulness: float, feasibility: float) -> float:
        """Compute the weighted geometric mean of *usefulness* and *feasibility*.

        Formula: ``usefulness^w_u * feasibility^w_f``

        Parameters
        ----------
        usefulness:
            Usefulness sub-score in ``[0.0, 1.0]``.
        feasibility:
            Feasibility sub-score in ``[0.0, 1.0]``.

        Returns
        -------
        float
            Combined score in ``[0.0, 1.0]``.

        Notes
        -----
        When either input is exactly ``0.0`` the result is ``0.0`` regardless
        of the weights, which matches the semantics: a completely infeasible or
        completely useless skill should never be selected.
        """
        if usefulness == 0.0 or feasibility == 0.0:
            return 0.0

        return (usefulness ** self._w_u) * (feasibility ** self._w_f)

    # ------------------------------------------------------------------
    # Dunder helpers
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        return (
            f"WeightedProductFusion("
            f"usefulness={self._w_u}, feasibility={self._w_f})"
        )
