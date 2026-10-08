"""Metrics logging for affordance scores.

Provides :class:`AffordanceMetricsLogger` for recording per-score events and
persisting them to CSV for offline analysis and visualisation.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from nora_core.affordance.scoring import AffordanceScore


class AffordanceMetricsLogger:
    """Accumulates :class:`~nora_core.affordance.scoring.AffordanceScore`
    events in memory and can flush them to a CSV file.

    Example
    -------
    >>> logger = AffordanceMetricsLogger()
    >>> logger.log_score(score, timestamp=time.time())
    >>> logger.save_csv("/tmp/affordance_metrics.csv")
    """

    def __init__(self, max_records: int = 10000) -> None:
        self.max_records = max_records
        self._records: list[dict[str, Any]] = []

    def log_score(
        self,
        score: AffordanceScore,
        timestamp: float,
        intent_action: str = "",
        target_object: str | None = None,
    ) -> None:
        """Record an :class:`AffordanceScore` event.

        Parameters
        ----------
        score:
            The affordance score to log.
        timestamp:
            Unix timestamp (seconds since epoch) of the scoring event.
        intent_action:
            Optional intent action associated with the scoring event.
        target_object:
            Optional target object associated with the scoring event.
        """
        record: dict[str, Any] = {
            "timestamp": timestamp,
            "skill_name": score.skill_name,
            "intent_action": intent_action,
            "target_object": target_object or "",
            "usefulness": round(score.usefulness, 4),
            "feasibility": round(score.feasibility, 4),
            "combined_score": round(score.combined_score, 4),
            "reachability": round(score.breakdown.get("reachability", 1.0), 4),
            "collision_free": round(score.breakdown.get("collision_free", 1.0), 4),
            "object_state": round(score.breakdown.get("object_state", 1.0), 4),
            "preconditions": round(score.breakdown.get("preconditions", 1.0), 4),
        }

        if len(self._records) >= self.max_records:
            self._records.pop(0)

        self._records.append(record)

    @property
    def records(self) -> list[dict[str, Any]]:
        """Return a copy of the buffered records."""
        return list(self._records)

    def clear(self) -> None:
        """Clear all buffered records."""
        self._records.clear()

    def save_csv(self, path: str | Path) -> None:
        """Flush all buffered records to a CSV file at *path*.

        Parameters
        ----------
        path:
            Absolute or relative filesystem path for the output CSV.
            Parent directories are created if they do not exist.
        """
        file_path = Path(path)
        file_path.parent.mkdir(parents=True, exist_ok=True)

        fieldnames = [
            "timestamp",
            "skill_name",
            "intent_action",
            "target_object",
            "usefulness",
            "feasibility",
            "combined_score",
            "reachability",
            "collision_free",
            "object_state",
            "preconditions",
        ]

        with file_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for record in self._records:
                writer.writerow(record)
