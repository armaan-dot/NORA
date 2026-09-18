"""Tests for :mod:`nora_core.intent`."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from nora_core.intent import Action, Intent


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

VALID_DICT = {
    "raw_text": "pick up the red cube",
    "action": "pick",
    "target_object": "red_cube",
    "target_location": None,
    "confidence": 0.95,
}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestIntentCreation:
    """Valid Intent construction."""

    def test_from_dict_creates_valid_intent(self) -> None:
        intent = Intent.from_dict(VALID_DICT)

        assert intent.raw_text == "pick up the red cube"
        assert intent.action == Action.PICK.value
        assert intent.target_object == "red_cube"
        assert intent.target_location is None
        assert intent.confidence == pytest.approx(0.95)
        assert intent.version == "1.0"
        # command_id should be a non-empty UUID string
        assert len(intent.command_id) == 36
        assert intent.command_id.count("-") == 4

    def test_default_parameters_is_empty_dict(self) -> None:
        intent = Intent.from_dict(VALID_DICT)
        assert isinstance(intent.parameters, dict)
        assert intent.parameters == {}

    def test_parameters_stored_correctly(self) -> None:
        data = {**VALID_DICT, "parameters": {"speed": 0.5, "approach_height": 0.1}}
        intent = Intent.from_dict(data)
        assert intent.parameters["speed"] == pytest.approx(0.5)


class TestConfidenceValidation:
    """Confidence boundary enforcement."""

    @pytest.mark.parametrize("bad_confidence", [-0.01, 1.001, 2.0, -100.0])
    def test_invalid_confidence_raises_validation_error(self, bad_confidence: float) -> None:
        data = {**VALID_DICT, "confidence": bad_confidence}
        with pytest.raises(ValidationError):
            Intent.from_dict(data)

    @pytest.mark.parametrize("good_confidence", [0.0, 0.5, 1.0])
    def test_boundary_confidence_values_are_valid(self, good_confidence: float) -> None:
        data = {**VALID_DICT, "confidence": good_confidence}
        intent = Intent.from_dict(data)
        assert intent.confidence == pytest.approx(good_confidence)


class TestActionEnumValidation:
    """Action field enum validation."""

    @pytest.mark.parametrize(
        "valid_action",
        ["pick", "place", "move_to_pose", "open_gripper", "close_gripper", "go_home", "unknown"],
    )
    def test_valid_actions_are_accepted(self, valid_action: str) -> None:
        data = {**VALID_DICT, "action": valid_action}
        intent = Intent.from_dict(data)
        assert intent.action == valid_action

    def test_invalid_action_raises_validation_error(self) -> None:
        data = {**VALID_DICT, "action": "fly"}
        with pytest.raises(ValidationError):
            Intent.from_dict(data)


class TestToDictRoundTrip:
    """to_dict / from_dict round-trip."""

    def test_round_trip_preserves_all_fields(self) -> None:
        original = Intent.from_dict(VALID_DICT)
        d = original.to_dict()
        restored = Intent.from_dict(d)

        assert restored.command_id == original.command_id
        assert restored.raw_text == original.raw_text
        assert restored.action == original.action
        assert restored.target_object == original.target_object
        assert restored.confidence == pytest.approx(original.confidence)
        assert restored.version == original.version

    def test_to_dict_contains_version_key(self) -> None:
        intent = Intent.from_dict(VALID_DICT)
        d = intent.to_dict()
        assert "version" in d
        assert d["version"] == "1.0"

    def test_to_dict_is_json_serialisable(self) -> None:
        import json

        intent = Intent.from_dict(VALID_DICT)
        d = intent.to_dict()
        # Should not raise
        json_str = json.dumps(d)
        assert isinstance(json_str, str)
