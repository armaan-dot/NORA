"""
nora_nlu.data.splits
=====================
Utilities for splitting a flat list of examples into train / val / test sets.
"""

from __future__ import annotations

import random
from typing import TypedDict


class DataSplits(TypedDict):
    """Typed dict returned by :func:`create_splits`."""

    train: list[dict]
    val: list[dict]
    test: list[dict]


def create_splits(
    data: list[dict],
    train_ratio: float = 0.8,
    val_ratio: float = 0.1,
    test_ratio: float = 0.1,
    seed: int = 42,
) -> DataSplits:
    """Split ``data`` into train / val / test subsets.

    Parameters
    ----------
    data:
        Flat list of example dicts (``{"instruction": ..., "intent": ...}``).
    train_ratio:
        Fraction of data to use for training.
    val_ratio:
        Fraction of data for validation.
    test_ratio:
        Fraction of data for testing. ``train_ratio + val_ratio + test_ratio``
        must equal ``1.0``.
    seed:
        Random seed for reproducible shuffling.

    Returns
    -------
    DataSplits
        Dict with keys ``"train"``, ``"val"``, ``"test"``.

    Raises
    ------
    ValueError
        If ratios do not sum to 1.0 (within floating-point tolerance) or if
        ``data`` is empty.
    """
    # TODO(nora): implement stratified splitting by action type to ensure
    #             all 6 action labels appear in every split.
    if not data:
        raise ValueError("data must not be empty.")

    total = train_ratio + val_ratio + test_ratio
    if abs(total - 1.0) > 1e-6:
        raise ValueError(
            f"Ratios must sum to 1.0, got {total:.6f}. "
            f"(train={train_ratio}, val={val_ratio}, test={test_ratio})"
        )

    shuffled = data.copy()
    random.Random(seed).shuffle(shuffled)

    n = len(shuffled)
    n_train = int(n * train_ratio)
    n_val = int(n * val_ratio)

    return DataSplits(
        train=shuffled[:n_train],
        val=shuffled[n_train : n_train + n_val],
        test=shuffled[n_train + n_val :],
    )
