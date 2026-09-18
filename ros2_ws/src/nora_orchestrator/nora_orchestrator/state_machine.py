"""nora_orchestrator.state_machine
====================================
Simple deterministic state machine for the NORA task orchestrator.

States
------
- IDLE        : waiting for an intent message.
- PARSING     : NLU parsing in progress (delegated to nora_nlu).
- SCORING     : affordance scorer is ranking candidate skills.
- PLANNING    : skill planner is building the execution sequence.
- EXECUTING   : executing skills one at a time.
- RECOVERING  : a skill failed; attempting replanning.
- DONE        : task completed successfully.
- FAILED      : could not complete task after max replanning attempts.

Allowed transitions are enforced by :class:`OrchestratorStateMachine`.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional


class OrchestratorState(Enum):
    """Enumeration of valid orchestrator states."""

    IDLE = "idle"
    PARSING = "parsing"
    SCORING = "scoring"
    PLANNING = "planning"
    EXECUTING = "executing"
    RECOVERING = "recovering"
    DONE = "done"
    FAILED = "failed"


# Valid (source → target) state transitions.
_VALID_TRANSITIONS: dict[OrchestratorState, set[OrchestratorState]] = {
    OrchestratorState.IDLE: {
        OrchestratorState.PARSING,
    },
    OrchestratorState.PARSING: {
        OrchestratorState.SCORING,
        OrchestratorState.FAILED,
    },
    OrchestratorState.SCORING: {
        OrchestratorState.PLANNING,
        OrchestratorState.FAILED,
    },
    OrchestratorState.PLANNING: {
        OrchestratorState.EXECUTING,
        OrchestratorState.FAILED,
    },
    OrchestratorState.EXECUTING: {
        OrchestratorState.DONE,
        OrchestratorState.RECOVERING,
        OrchestratorState.FAILED,
    },
    OrchestratorState.RECOVERING: {
        OrchestratorState.PLANNING,  # replan
        OrchestratorState.FAILED,   # gave up
    },
    OrchestratorState.DONE: {
        OrchestratorState.IDLE,     # ready for next task
    },
    OrchestratorState.FAILED: {
        OrchestratorState.IDLE,     # reset after failure
    },
}


class InvalidTransitionError(Exception):
    """Raised when an illegal state transition is attempted."""


class OrchestratorStateMachine:
    """Lightweight state machine for the task orchestrator.

    Parameters
    ----------
    initial_state:
        Starting state; defaults to ``OrchestratorState.IDLE``.
    on_transition:
        Optional callback ``(old_state, new_state) → None`` fired after every
        successful transition.  Use this to publish state updates to ROS topics.

    Examples
    --------
    >>> sm = OrchestratorStateMachine()
    >>> sm.transition(OrchestratorState.PARSING)
    >>> sm.current_state
    <OrchestratorState.PARSING: 'parsing'>
    """

    def __init__(
        self,
        initial_state: OrchestratorState = OrchestratorState.IDLE,
        on_transition=None,
    ) -> None:
        self._state: OrchestratorState = initial_state
        self._on_transition = on_transition
        self._history: list[OrchestratorState] = [initial_state]

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def current_state(self) -> OrchestratorState:
        """The current state of the machine."""
        return self._state

    @property
    def history(self) -> list[OrchestratorState]:
        """Immutable snapshot of the state transition history."""
        return list(self._history)

    # ------------------------------------------------------------------
    # Transition
    # ------------------------------------------------------------------

    def transition(self, new_state: OrchestratorState) -> None:
        """Attempt a transition to *new_state*.

        Parameters
        ----------
        new_state:
            The target state.

        Raises
        ------
        InvalidTransitionError
            If the transition from the current state to *new_state* is not
            listed in ``_VALID_TRANSITIONS``.
        """
        allowed = _VALID_TRANSITIONS.get(self._state, set())
        if new_state not in allowed:
            raise InvalidTransitionError(
                f"Cannot transition from {self._state.value!r} to "
                f"{new_state.value!r}.  "
                f"Allowed targets: {[s.value for s in allowed]}"
            )
        old_state = self._state
        self._state = new_state
        self._history.append(new_state)
        if self._on_transition is not None:
            self._on_transition(old_state, new_state)

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """Force-reset to IDLE without a transition guard (e.g. on startup)."""
        self._state = OrchestratorState.IDLE
        self._history = [OrchestratorState.IDLE]

    def is_terminal(self) -> bool:
        """Return True if the machine is in a terminal state (DONE or FAILED)."""
        return self._state in (OrchestratorState.DONE, OrchestratorState.FAILED)

    def __repr__(self) -> str:  # pragma: no cover
        return f"OrchestratorStateMachine(current={self._state.value!r})"
