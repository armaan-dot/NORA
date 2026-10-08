"""Unit tests for Google Research SayCan engine in NORA."""

from __future__ import annotations

import pytest

from nora_core.affordance.environment import WorldState
from nora_core.affordance.saycan import (
    SayCanOption,
    SayCanPlan,
    SayCanPlanner,
    SayCanScorer,
)


class TestSayCanScorer:
    """Tests for SayCan language probabilities and affordance values."""

    def setup_method(self) -> None:
        self.scorer = SayCanScorer()
        self.world = WorldState.default()

    def test_pick_language_probability_high_for_explicit_object(self) -> None:
        opt = SayCanOption(action_type="pick", target_object="water_glass")
        prob = self.scorer.score_language_probability("pick up the water glass", opt)
        assert prob >= 0.85

    def test_pick_affordance_zero_when_already_holding_object(self) -> None:
        world_holding = WorldState.with_held_object("water_glass")
        opt = SayCanOption(action_type="pick", target_object="apple")
        affordance = self.scorer.score_affordance_value(opt, world_holding)
        assert affordance == 0.0

    def test_place_affordance_zero_when_gripper_empty(self) -> None:
        opt = SayCanOption(action_type="place", target_object="water_glass", target_location="table")
        affordance = self.scorer.score_affordance_value(opt, self.world)
        assert affordance == 0.0

    def test_place_affordance_one_when_holding_object(self) -> None:
        world_holding = WorldState.with_held_object("water_glass")
        opt = SayCanOption(action_type="place", target_object="water_glass", target_location="table")
        affordance = self.scorer.score_affordance_value(opt, world_holding)
        assert affordance == 1.0

    def test_unreachable_object_affordance_zero(self) -> None:
        world_unreachable = WorldState.with_unreachable_object("water_glass")
        opt = SayCanOption(action_type="pick", target_object="water_glass")
        affordance = self.scorer.score_affordance_value(opt, world_unreachable)
        assert affordance == 0.0


class TestSayCanPlanner:
    """Tests for SayCan multi-step sequential planning."""

    def setup_method(self) -> None:
        self.planner = SayCanPlanner(max_steps=5)

    def test_thirsty_sequential_plan(self) -> None:
        plan = self.planner.plan("I am thirsty")
        assert len(plan.steps) >= 2
        first_step = plan.steps[0]
        assert first_step.option.action_type == "pick"
        assert first_step.option.target_object in {"water", "water_glass"}
        assert plan.completed is True

    def test_spill_sequential_plan(self) -> None:
        plan = self.planner.plan("I spilled my drink, can you help?")
        assert len(plan.steps) >= 2
        first_step = plan.steps[0]
        assert first_step.option.action_type == "pick"
        assert first_step.option.target_object == "sponge"

    def test_plan_summary_string_formatting(self) -> None:
        plan = self.planner.plan("bring me the coke")
        summary = plan.summary()
        assert "SayCan Plan for:" in summary
        assert "LLM P:" in summary
        assert "Affordance V:" in summary

