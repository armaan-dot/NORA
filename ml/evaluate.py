"""Evaluation script for NORA Natural Language Understanding (NLU) model.

Usage:
    python ml/evaluate.py
"""

from __future__ import annotations

from pathlib import Path
import sys

# Ensure src is on sys.path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from nora_nlu.inference import NLUParser  # noqa: E402


def main() -> None:
    print("=" * 60)
    print("Evaluating NORA NLU Model")
    print("=" * 60)

    model_path = Path(__file__).parent / "models" / "nora_nlu_model.json"
    parser = NLUParser(model_path=model_path)

    test_cases = [
        ("give me the glass", "pick", "glass"),
        ("I am thirsty", "pick", "water"),
        ("I need a drink", "pick", "glass"),
        ("pick up the red cube", "pick", "red_cube"),
        ("place the cube on the shelf", "place", "cube"),
        ("put the white box in the bin", "place", "white_box"),
        ("open the gripper", "open_gripper", None),
        ("close the gripper tightly", "close_gripper", None),
        ("return to home position", "go_home", None),
        ("move to coordinates 0.25, 0.0, 0.4", "move_to_pose", None),
    ]

    passed = 0
    for query, expected_action, expected_obj in test_cases:
        res = parser.parse(query)
        action_match = res["action"] == expected_action
        obj_match = (expected_obj is None) or (res["target_object"] == expected_obj)

        status = "PASS" if (action_match and obj_match) else "FAIL"
        if status == "PASS":
            passed += 1

        print(f"[{status}] '{query}'")
        print(f"       Expected: action={expected_action}, obj={expected_obj}")
        print(f"       Actual  : action={res['action']}, obj={res['target_object']}, conf={res['confidence']}")
        print("-" * 60)

    print(f"\nSummary: {passed}/{len(test_cases)} tests passed ({passed/len(test_cases)*100:.1f}%)")


if __name__ == "__main__":
    main()
