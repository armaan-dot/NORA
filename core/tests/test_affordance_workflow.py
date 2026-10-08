"""Unit tests for NORA Affordance scoring and end-to-end workflow."""

from __future__ import annotations

from pathlib import Path
import tempfile

import pytest

from nora_core.affordance import (
    AffordanceMetricsLogger,
    AffordanceScorer,
    AffordanceWorkflow,
    WorldState,
)
from nora_core.intent import Intent


class TestAffordanceScoring:
    """Test unit scoring behaviour of AffordanceScorer."""

    def test_direct_pick_usefulness_and_feasibility(self) -> None:
        world = WorldState.default()
        scorer = AffordanceScorer(world_state=world)
        intent = Intent.from_dict({
            "raw_text": "pick up the water glass",
            "action": "pick",
            "target_object": "water_glass",
            "confidence": 0.95,
        })

        score = scorer.score(intent, "pick")
        assert score.skill_name == "pick"
        assert score.usefulness >= 0.85
        assert score.feasibility == 1.0
        assert score.combined_score >= 0.85
        assert score.breakdown["reachability"] == 1.0
        assert score.breakdown["preconditions"] == 1.0

    def test_unreachable_object_drops_feasibility_to_zero(self) -> None:
        world = WorldState.with_unreachable_object("water_glass")
        scorer = AffordanceScorer(world_state=world)
        intent = Intent.from_dict({
            "raw_text": "pick up the water glass",
            "action": "pick",
            "target_object": "water_glass",
            "confidence": 0.95,
        })

        score = scorer.score(intent, "pick")
        assert score.breakdown["reachability"] == 0.0
        assert score.feasibility == 0.0
        assert score.combined_score == 0.0

    def test_cannot_pick_when_already_holding_object(self) -> None:
        world = WorldState.with_held_object("water_glass")
        scorer = AffordanceScorer(world_state=world)
        intent = Intent.from_dict({
            "raw_text": "pick up the apple",
            "action": "pick",
            "target_object": "apple",
            "confidence": 0.95,
        })

        score = scorer.score(intent, "pick")
        assert score.breakdown["preconditions"] == 0.0
        assert score.feasibility == 0.0
        assert score.combined_score == 0.0

    def test_place_feasible_only_when_holding_object(self) -> None:
        # 1. When empty: place is infeasible
        world_empty = WorldState.default()
        scorer_empty = AffordanceScorer(world_state=world_empty)
        intent_place = Intent.from_dict({
            "raw_text": "place the water glass on the table",
            "action": "place",
            "target_object": "water_glass",
            "target_location": "table",
            "confidence": 0.95,
        })
        score_empty = scorer_empty.score(intent_place, "place")
        assert score_empty.feasibility == 0.0
        assert score_empty.combined_score == 0.0

        # 2. When holding object: place is fully feasible
        world_holding = WorldState.with_held_object("water_glass")
        scorer_holding = AffordanceScorer(world_state=world_holding)
        score_holding = scorer_holding.score(intent_place, "place")
        assert score_holding.feasibility == 1.0
        assert score_holding.combined_score >= 0.85

    def test_obstructed_object_penalizes_collision_subscore(self) -> None:
        world = WorldState.with_obstructed_object("water_glass")
        scorer = AffordanceScorer(world_state=world)
        intent = Intent.from_dict({
            "raw_text": "pick up the water glass",
            "action": "pick",
            "target_object": "water_glass",
            "confidence": 0.95,
        })

        score = scorer.score(intent, "pick")
        assert score.breakdown["collision_free"] == 0.20
        assert score.feasibility == pytest.approx(0.20)
        assert score.combined_score < 0.60


class TestAffordanceWorkflow:
    """Test end-to-end execution of AffordanceWorkflow."""

    def test_commonsense_thirsty_workflow(self) -> None:
        workflow = AffordanceWorkflow()
        result = workflow.run("I am thirsty")

        assert result.success is True
        assert result.executed_skill == "pick"
        assert len(result.plan) > 0
        assert result.plan[0].skill_name == "pick"
        assert result.final_world_state.robot.gripper_state == "holding"
        assert result.final_world_state.robot.held_object == "water"

    def test_pick_and_then_place_workflow_sequence(self) -> None:
        workflow = AffordanceWorkflow()

        # Step 1: Pick up water glass
        res_pick = workflow.run("pick up the water glass")
        assert res_pick.success is True
        assert res_pick.executed_skill == "pick"
        assert workflow.world_state.robot.held_object == "water_glass"

        # Step 2: Now place on table
        res_place = workflow.run("place the water glass on the table")
        assert res_place.success is True
        assert res_place.executed_skill == "place"
        assert workflow.world_state.robot.held_object is None
        assert workflow.world_state.robot.gripper_state == "open"

    def test_unreachable_command_rejected_by_planner(self) -> None:
        workflow = AffordanceWorkflow()
        unreachable_world = WorldState.with_unreachable_object("water_glass")

        result = workflow.run(
            "pick up the water glass",
            world_state_override=unreachable_world,
        )

        assert result.success is False
        assert result.executed_skill is None
        assert "No viable skill passed affordance threshold" in result.message

    def test_metrics_logger_saves_valid_csv(self) -> None:
        logger = AffordanceMetricsLogger()
        workflow = AffordanceWorkflow(metrics_logger=logger)

        workflow.run("pick up the water glass")
        assert len(logger.records) > 0

        with tempfile.TemporaryDirectory() as tmp_dir:
            csv_path = Path(tmp_dir) / "metrics.csv"
            logger.save_csv(csv_path)
            assert csv_path.exists()
            content = csv_path.read_text(encoding="utf-8")
            assert "skill_name" in content
            assert "combined_score" in content
            assert "pick" in content

    def test_workflow_result_to_dict_format(self) -> None:
        workflow = AffordanceWorkflow()
        result = workflow.run("open the gripper")

        res_dict = result.to_dict()
        assert res_dict["utterance"] == "open the gripper"
        assert res_dict["executed_skill"] == "open_gripper"
        assert res_dict["success"] is True
        assert "robot_state_after" in res_dict
        assert len(res_dict["scores"]) == 6
