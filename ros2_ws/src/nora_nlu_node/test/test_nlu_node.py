"""
test/test_nlu_node.py
──────────────────────
pytest unit tests for the NLU node components.

Run with:
  pytest src/nora_nlu_node/test/test_nlu_node.py -v
"""

import pytest

from nora_nlu_node.mock_parser import MockRuleBasedParser


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture
def parser() -> MockRuleBasedParser:
    """Return a fresh MockRuleBasedParser instance."""
    return MockRuleBasedParser()


# ── Action detection tests ─────────────────────────────────────────────────────

class TestMockParserActions:
    def test_pick_up_red_cube(self, parser: MockRuleBasedParser) -> None:
        """Primary acceptance test: 'pick up the red cube' → action='pick', object='red cube'."""
        result = parser.parse("pick up the red cube")

        assert result["action"] == "pick", (
            f"Expected action='pick', got {result['action']!r}"
        )
        assert result["target_object"] == "red cube", (
            f"Expected target_object='red cube', got {result['target_object']!r}"
        )
        assert result["confidence"] == pytest.approx(0.85)
        assert result["raw_text"] == "pick up the red cube"

    def test_grab_keyword(self, parser: MockRuleBasedParser) -> None:
        result = parser.parse("grab the blue cylinder")
        assert result["action"] == "pick"
        assert result["target_object"] == "blue cylinder"

    def test_get_keyword(self, parser: MockRuleBasedParser) -> None:
        result = parser.parse("get the green sphere")
        assert result["action"] == "pick"
        assert result["target_object"] == "green sphere"

    def test_place_action(self, parser: MockRuleBasedParser) -> None:
        result = parser.parse("place the cube on the table")
        assert result["action"] == "place"

    def test_put_keyword(self, parser: MockRuleBasedParser) -> None:
        result = parser.parse("put the box down")
        assert result["action"] == "place"

    def test_go_home(self, parser: MockRuleBasedParser) -> None:
        result = parser.parse("go home")
        assert result["action"] == "go_home"

    def test_open_gripper(self, parser: MockRuleBasedParser) -> None:
        result = parser.parse("open the gripper")
        assert result["action"] == "open_gripper"

    def test_close_gripper(self, parser: MockRuleBasedParser) -> None:
        result = parser.parse("close gripper")
        assert result["action"] == "close_gripper"

    def test_unknown_command_low_confidence(self, parser: MockRuleBasedParser) -> None:
        result = parser.parse("dance around the room")
        assert result["action"] == "unknown"
        assert result["confidence"] == pytest.approx(0.30)


# ── Object extraction tests ────────────────────────────────────────────────────

class TestMockParserObjectExtraction:
    def test_no_object(self, parser: MockRuleBasedParser) -> None:
        result = parser.parse("go home")
        assert result["target_object"] == ""

    def test_colour_object_pair(self, parser: MockRuleBasedParser) -> None:
        result = parser.parse("pick the yellow block please")
        assert result["target_object"] == "yellow block"

    def test_case_insensitive(self, parser: MockRuleBasedParser) -> None:
        result = parser.parse("PICK UP THE RED CUBE")
        assert result["action"] == "pick"
        assert result["target_object"] == "red cube"


# ── Schema completeness ────────────────────────────────────────────────────────

class TestIntentSchema:
    """Ensure all required keys are always present in the returned dict."""

    REQUIRED_KEYS = {"action", "target_object", "confidence", "raw_text"}

    @pytest.mark.parametrize(
        "text",
        [
            "pick up the red cube",
            "go home",
            "open gripper",
            "something completely unknown",
        ],
    )
    def test_schema_keys_present(self, parser: MockRuleBasedParser, text: str) -> None:
        result = parser.parse(text)
        missing = self.REQUIRED_KEYS - result.keys()
        assert not missing, f"Intent dict missing keys: {missing}"

    @pytest.mark.parametrize(
        "text",
        [
            "pick up the red cube",
            "go home",
            "open gripper",
        ],
    )
    def test_confidence_in_range(self, parser: MockRuleBasedParser, text: str) -> None:
        result = parser.parse(text)
        assert 0.0 <= result["confidence"] <= 1.0
