"""Tests for :mod:`nora_core.planner`."""

from __future__ import annotations

import pytest

from nora_core.affordance.scoring import AffordanceScore
from nora_core.intent import Intent
from nora_core.planner import Planner, SkillPlan


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_intent() -> Intent:
    return Intent.from_dict(
        {
            "raw_text": "pick up the blue block",
            "action": "pick",
            "target_object": "blue_block",
            "confidence": 0.9,
        }
    )


def _make_score(name: str, combined: float) -> AffordanceScore:
    return AffordanceScore(
        skill_name=name,
        usefulness=combined,
        feasibility=combined,
        combined_score=combined,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestPlannerRanking:
    """Planner.rank_skills returns skills sorted by combined_score descending."""

    def setup_method(self) -> None:
        self.planner = Planner(top_k=5)
        self.intent = _make_intent()

    def test_skills_sorted_descending_by_score(self) -> None:
        scores = [
            _make_score("go_home", 0.2),
            _make_score("pick_object", 0.9),
            _make_score("place_object", 0.6),
        ]
        plans = self.planner.rank_skills(self.intent, scores)

        assert len(plans) == 3
        assert plans[0].skill_name == "pick_object"
        assert plans[1].skill_name == "place_object"
        assert plans[2].skill_name == "go_home"

    def test_scores_carried_through_to_plan(self) -> None:
        scores = [_make_score("pick_object", 0.85)]
        plans = self.planner.rank_skills(self.intent, scores)

        assert plans[0].score == pytest.approx(0.85)

    def test_top_k_limits_returned_plans(self) -> None:
        planner = Planner(top_k=2)
        scores = [
            _make_score("skill_a", 0.9),
            _make_score("skill_b", 0.7),
            _make_score("skill_c", 0.5),
        ]
        plans = planner.rank_skills(self.intent, scores)

        assert len(plans) == 2
        assert plans[0].skill_name == "skill_a"
        assert plans[1].skill_name == "skill_b"

    def test_all_equal_scores_returns_stable_result(self) -> None:
        scores = [_make_score(f"skill_{i}", 0.5) for i in range(4)]
        plans = self.planner.rank_skills(self.intent, scores)
        assert len(plans) == 4
        for p in plans:
            assert p.score == pytest.approx(0.5)

    def test_plan_items_are_skill_plan_instances(self) -> None:
        scores = [_make_score("pick_object", 0.7)]
        plans = self.planner.rank_skills(self.intent, scores)
        assert all(isinstance(p, SkillPlan) for p in plans)


class TestPlannerEdgeCases:
    """Edge-case behaviour of Planner."""

    def setup_method(self) -> None:
        self.planner = Planner()
        self.intent = _make_intent()

    def test_empty_scores_returns_empty_plan(self) -> None:
        plans = self.planner.rank_skills(self.intent, [])
        assert plans == []

    def test_invalid_top_k_raises_value_error(self) -> None:
        with pytest.raises(ValueError):
            Planner(top_k=0)

    def test_single_score_returns_single_plan(self) -> None:
        scores = [_make_score("go_home", 1.0)]
        plans = self.planner.rank_skills(self.intent, scores)
        assert len(plans) == 1
        assert plans[0].skill_name == "go_home"
