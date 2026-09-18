"""Metrics logging for affordance scores.

Provides :class:`AffordanceMetricsLogger` for recording per-score events and
persisting them to CSV for offline analysis and visualisation.
"""

from __future__ import annotations

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

    def __init__(self) -> None:
        # TODO(nora): decide on a max-buffer size to avoid unbounded memory use
        self._records: list[dict] = []

    def log_score(self, score: AffordanceScore, timestamp: float) -> None:
        """Record an :class:`AffordanceScore` event.

        Parameters
        ----------
        score:
            The affordance score to log.
        timestamp:
            Unix timestamp (seconds since epoch) of the scoring event.
        """
        # TODO(nora): append a record dict to self._records with all score fields + timestamp
        # TODO(nora): optionally emit to a ROS topic or structured logger
        raise NotImplementedError("AffordanceMetricsLogger.log_score is not yet implemented")

    def save_csv(self, path: str) -> None:
        """Flush all buffered records to a CSV file at *path*.

        Parameters
        ----------
        path:
            Absolute or relative filesystem path for the output CSV.
            Parent directories must exist.
        """
        # TODO(nora): use csv.DictWriter with fieldnames from self._records[0].keys()
        # TODO(nora): handle empty self._records gracefully (write header only or skip)
        raise NotImplementedError("AffordanceMetricsLogger.save_csv is not yet implemented")
