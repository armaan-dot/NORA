"""
nora_nlu.data.dataset
=====================
HuggingFace-compatible dataset loading utilities for the NORA NLU fine-tuning
pipeline.

Each record in the JSONL files is expected to conform to the structure::

    {
        "instruction": "<raw natural language command>",
        "intent": { ... }  # validated against intent.schema.json
    }
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

# TODO(nora): import datasets after confirming HF datasets is installed
# from datasets import Dataset, DatasetDict


class NLUDataset:
    """Thin wrapper around a HuggingFace ``Dataset`` loaded from JSONL files.

    Attributes
    ----------
    path:
        Absolute or relative path to the ``.jsonl`` source file.
    hf_dataset:
        Underlying HuggingFace ``Dataset`` object (set after :meth:`load` is
        called).

    Example
    -------
    >>> ds = NLUDataset("data/processed/train.jsonl")
    >>> ds.load()
    >>> print(len(ds.hf_dataset))
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        # TODO(nora): store as datasets.Dataset instead of plain list
        self.hf_dataset: Optional[list[dict]] = None

    def load(self) -> "NLUDataset":
        """Load the JSONL file and populate :attr:`hf_dataset`.

        Returns
        -------
        NLUDataset
            ``self`` for method chaining.

        Raises
        ------
        FileNotFoundError
            If the specified ``path`` does not exist.
        """
        # TODO(nora): replace with datasets.load_dataset("json", ...) for full
        #             HF compatibility (streaming, caching, sharding).
        if not self.path.exists():
            raise FileNotFoundError(f"Dataset file not found: {self.path}")

        records = []
        with self.path.open("r", encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"Invalid JSON on line {lineno} of {self.path}: {exc}"
                    ) from exc

        self.hf_dataset = records
        return self

    def __len__(self) -> int:
        if self.hf_dataset is None:
            raise RuntimeError("Call .load() before using the dataset.")
        return len(self.hf_dataset)

    def __repr__(self) -> str:
        loaded = self.hf_dataset is not None
        n = len(self.hf_dataset) if loaded else "?"
        return f"NLUDataset(path={self.path!r}, loaded={loaded}, n={n})"


def load_dataset_from_jsonl(path: str | Path) -> list[dict]:
    """Load a JSONL file and return a list of parsed record dicts.

    This is a convenience function for quick scripting. For training, prefer
    :class:`NLUDataset` which wraps the HF ``Dataset`` API.

    Parameters
    ----------
    path:
        Path to the ``.jsonl`` file.

    Returns
    -------
    list[dict]
        Parsed records. Each element corresponds to one line in the file.

    Raises
    ------
    FileNotFoundError
        If ``path`` does not exist.
    ValueError
        If any line contains invalid JSON.

    Example
    -------
    >>> records = load_dataset_from_jsonl("data/examples/seed_commands.jsonl")
    >>> len(records)
    15
    """
    return NLUDataset(path).load().hf_dataset  # type: ignore[return-value]
