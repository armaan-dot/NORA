"""Abstract base classes (interfaces) for NORA pluggable components.

Any concrete implementation — whether it calls an LLM, runs a local model,
or wraps a ROS service — must inherit from these ABCs so the rest of
``nora_core`` can depend on stable contracts.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from nora_core.intent import Intent
from nora_core.affordance.scoring import AffordanceScore


class IntentParser(ABC):
    """Contract for components that convert raw text into structured intent.

    Implementations might call an LLM, run a regex matcher, or decode a
    ROS message, but the rest of the system only ever sees this interface.

    Example
    -------
    >>> class MyParser(IntentParser):
    ...     def parse(self, text: str) -> Intent:
    ...         ...  # call GPT-4, etc.
    """

    @abstractmethod
    def parse(self, text: str) -> Intent:
        """Parse a natural language command into a validated :class:`Intent`.

        Parameters
        ----------
        text:
            Raw natural language command from the user or a higher-level
            orchestrator (e.g. ``"pick up the red cube and place it in bin A"``).

        Returns
        -------
        Intent
            A fully validated :class:`Intent` instance.  The ``confidence``
            field should reflect the parser's self-assessed certainty.

        Raises
        ------
        ValueError
            If *text* is empty or unparseable and no fallback is available.
        """
        ...


class AffordanceScorer(ABC):
    """Contract for components that score a skill's affordance for an intent.

    An affordance scorer estimates how *useful* and *feasible* a specific
    skill is given the current intent and world state.

    Example
    -------
    >>> class MyScorer(AffordanceScorer):
    ...     def score(self, intent: Intent, skill_name: str) -> AffordanceScore:
    ...         ...  # query perception, collision checker, etc.
    """

    @abstractmethod
    def score(self, intent: Intent, skill_name: str) -> AffordanceScore:
        """Score the affordance of *skill_name* relative to *intent*.

        Parameters
        ----------
        intent:
            The structured intent describing what the robot should do.
        skill_name:
            The name of the skill to evaluate (must exist in
            :class:`~nora_core.skills.SkillRegistry`).

        Returns
        -------
        AffordanceScore
            Scores for usefulness, feasibility, and a fused combined score.

        Raises
        ------
        KeyError
            If *skill_name* is not found in the registry.
        RuntimeError
            If world-state perception is unavailable.
        """
        ...
