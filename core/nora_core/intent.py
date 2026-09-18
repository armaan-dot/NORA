"""Intent model for NORA.

Defines the :class:`Intent` Pydantic v2 model that represents a structured
intent extracted from a natural language command.  The schema mirrors
``schemas/intent.schema.json`` exactly so that JSON produced by
:meth:`Intent.to_dict` always validates against that schema.
"""

from __future__ import annotations

import uuid
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class Action(str, Enum):
    """Enumeration of all robot actions NORA can dispatch."""

    PICK = "pick"
    PLACE = "place"
    MOVE_TO_POSE = "move_to_pose"
    OPEN_GRIPPER = "open_gripper"
    CLOSE_GRIPPER = "close_gripper"
    GO_HOME = "go_home"
    UNKNOWN = "unknown"


class Intent(BaseModel):
    """Structured intent extracted from a natural language command.

    Attributes
    ----------
    version:
        Schema version.  Always ``"1.0"`` for the current schema generation.
    command_id:
        UUID v4 string uniquely identifying this command instance.
    raw_text:
        The original, unmodified natural language input string.
    action:
        The primary robot action to perform, drawn from the :class:`Action`
        enum.
    target_object:
        Name of the object to act on (e.g. ``"red_cube"``), or ``None`` when
        not applicable.
    target_location:
        Named destination location (e.g. ``"bin_A"``), or ``None`` when not
        applicable.
    parameters:
        Free-form key/value pairs carrying additional action parameters (e.g.
        approach height, speed overrides).
    confidence:
        Parser confidence in this intent, in the range ``[0.0, 1.0]``.
    """

    version: str = Field(default="1.0", frozen=True)
    command_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    raw_text: str
    action: Action
    target_object: str | None = None
    target_location: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    confidence: float

    model_config = {"use_enum_values": True}

    # ------------------------------------------------------------------
    # Validators
    # ------------------------------------------------------------------

    @field_validator("confidence")
    @classmethod
    def _validate_confidence(cls, v: float) -> float:
        """Ensure confidence is in [0.0, 1.0]."""
        if not (0.0 <= v <= 1.0):
            raise ValueError(f"confidence must be between 0.0 and 1.0, got {v!r}")
        return v

    # ------------------------------------------------------------------
    # Constructors / converters
    # ------------------------------------------------------------------

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Intent":
        """Construct an :class:`Intent` from a plain dictionary.

        Parameters
        ----------
        data:
            Dictionary that should contain at minimum the required fields
            ``raw_text``, ``action``, and ``confidence``.  Optional fields
            will fall back to their defaults.

        Returns
        -------
        Intent
            A validated :class:`Intent` instance.

        Raises
        ------
        pydantic.ValidationError
            If *data* contains invalid values.

        Examples
        --------
        >>> intent = Intent.from_dict({
        ...     "raw_text": "pick up the red cube",
        ...     "action": "pick",
        ...     "target_object": "red_cube",
        ...     "confidence": 0.95,
        ... })
        """
        return cls.model_validate(data)

    def to_dict(self) -> dict[str, Any]:
        """Serialise this intent to a plain dictionary.

        The returned dictionary is JSON-serialisable and validates against
        ``schemas/intent.schema.json``.

        Returns
        -------
        dict[str, Any]
            A dictionary representation of this intent.

        Examples
        --------
        >>> d = intent.to_dict()
        >>> assert d["action"] == "pick"
        """
        return self.model_dump(mode="json")
