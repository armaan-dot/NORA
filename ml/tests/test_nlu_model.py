"""Unit tests for NORA NLU Machine Learning Model."""

from __future__ import annotations

from pathlib import Path
import sys

# Ensure src is importable
SRC_DIR = Path(__file__).parent.parent / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from nora_nlu.inference import NLUParser  # noqa: E402


class TestNLUModel:
    """Test suite for NLU model predictions."""

    @classmethod
    def setup_class(cls) -> None:
        model_path = Path(__file__).parent.parent / "models" / "nora_nlu_model.json"
        cls.parser = NLUParser(model_path=model_path)

    def test_direct_pick_intent(self) -> None:
        res = self.parser.parse("pick up the red cube")
        assert res["action"] == "pick"
        assert res["target_object"] == "red_cube"
        assert res["confidence"] >= 0.5
        assert res["version"] == "1.0"

    def test_give_me_glass_intent(self) -> None:
        res = self.parser.parse("give me the glass")
        assert res["action"] == "pick"
        assert res["target_object"] == "glass"
        assert res["target_location"] == "user"

    def test_commonsense_thirsty_intent(self) -> None:
        res = self.parser.parse("I am thirsty")
        assert res["action"] == "pick"
        assert res["target_object"] == "water"
        assert res["target_location"] == "user"

    def test_place_intent(self) -> None:
        res = self.parser.parse("place the white box on the shelf")
        assert res["action"] == "place"
        assert res["target_object"] == "white_box"
        assert res["target_location"] == "shelf"

    def test_gripper_actions(self) -> None:
        open_res = self.parser.parse("open the gripper")
        assert open_res["action"] == "open_gripper"

        close_res = self.parser.parse("close the gripper tightly")
        assert close_res["action"] == "close_gripper"

    def test_go_home_action(self) -> None:
        home_res = self.parser.parse("return to home position")
        assert home_res["action"] == "go_home"

    def test_empty_string_handling(self) -> None:
        empty_res = self.parser.parse("")
        assert empty_res["action"] == "unknown"
        assert empty_res["confidence"] == 0.0
