"""Tests for :mod:`nora_core.affordance.fusion`."""

from __future__ import annotations

import math

import pytest

from nora_core.affordance.fusion import WeightedProductFusion


class TestEqualWeights:
    """WeightedProductFusion with 0.5 / 0.5 weights (geometric mean)."""

    def setup_method(self) -> None:
        self.fusion = WeightedProductFusion({"usefulness": 0.5, "feasibility": 0.5})

    def test_equal_inputs_return_same_value(self) -> None:
        result = self.fusion.fuse(0.8, 0.8)
        # sqrt(0.8 * 0.8) == 0.8
        assert result == pytest.approx(0.8, rel=1e-6)

    def test_mixed_inputs_geometric_mean(self) -> None:
        result = self.fusion.fuse(0.4, 0.9)
        expected = math.sqrt(0.4 * 0.9)
        assert result == pytest.approx(expected, rel=1e-6)

    def test_zero_usefulness_returns_zero(self) -> None:
        assert self.fusion.fuse(0.0, 0.9) == pytest.approx(0.0)

    def test_zero_feasibility_returns_zero(self) -> None:
        assert self.fusion.fuse(0.9, 0.0) == pytest.approx(0.0)

    def test_perfect_scores_return_one(self) -> None:
        assert self.fusion.fuse(1.0, 1.0) == pytest.approx(1.0)


class TestCustomWeights:
    """WeightedProductFusion with asymmetric weights."""

    def test_usefulness_heavy_weights(self) -> None:
        fusion = WeightedProductFusion({"usefulness": 0.8, "feasibility": 0.2})
        result = fusion.fuse(0.5, 0.9)
        expected = (0.5 ** 0.8) * (0.9 ** 0.2)
        assert result == pytest.approx(expected, rel=1e-6)

    def test_feasibility_heavy_weights(self) -> None:
        fusion = WeightedProductFusion({"usefulness": 0.3, "feasibility": 0.7})
        result = fusion.fuse(0.6, 0.7)
        expected = (0.6 ** 0.3) * (0.7 ** 0.7)
        assert result == pytest.approx(expected, rel=1e-6)

    def test_result_is_always_between_zero_and_one(self) -> None:
        fusion = WeightedProductFusion({"usefulness": 0.6, "feasibility": 0.4})
        for u in [0.1, 0.5, 0.99]:
            for f in [0.1, 0.5, 0.99]:
                score = fusion.fuse(u, f)
                assert 0.0 <= score <= 1.0, f"Out of range for u={u}, f={f}: {score}"


class TestWeightValidation:
    """WeightedProductFusion rejects invalid weight configurations."""

    def test_weights_not_summing_to_one_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="sum"):
            WeightedProductFusion({"usefulness": 0.3, "feasibility": 0.3})

    def test_weights_summing_to_more_than_one_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="sum"):
            WeightedProductFusion({"usefulness": 0.7, "feasibility": 0.7})

    def test_missing_usefulness_key_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="usefulness"):
            WeightedProductFusion({"feasibility": 1.0})

    def test_missing_feasibility_key_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="feasibility"):
            WeightedProductFusion({"usefulness": 1.0})

    def test_negative_weight_raises_value_error(self) -> None:
        with pytest.raises(ValueError):
            WeightedProductFusion({"usefulness": -0.1, "feasibility": 1.1})
