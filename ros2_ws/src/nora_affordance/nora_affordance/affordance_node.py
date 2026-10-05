"""
nora_affordance/affordance_node.py
───────────────────────────────────
ROS 2 node: AffordanceNode

Exposes:
  - Service ``/nora/score_affordances`` (nora_interfaces/srv/ScoreAffordances)

The node scores each candidate skill using:
  - usefulness: :class:`LLMUsefulnessScorer`
  - feasibility: product of reachability, collision, and object-state scorers
  - fusion: weighted geometric mean (usefulness^w_u * feasibility^w_f)
"""

from __future__ import annotations

import json
from typing import Any

import rclpy
from rclpy.node import Node

from nora_affordance.scorers.feasibility_collision import CollisionScorer
from nora_affordance.scorers.feasibility_reachability import ReachabilityScorer
from nora_affordance.scorers.llm_usefulness import LLMUsefulnessScorer
from nora_affordance.scorers.object_state import ObjectStateScorer
from nora_core.affordance.fusion import WeightedProductFusion
from nora_interfaces.msg import AffordanceScore, Intent
from nora_interfaces.srv import ScoreAffordances

_SERVICE_SCORE = "/nora/score_affordances"


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


class AffordanceNode(Node):
    """Score candidate skills for an intent via a ROS 2 service."""

    def __init__(self) -> None:
        super().__init__("affordance_node")

        self.declare_parameter("usefulness_weight", 0.6)
        self.declare_parameter("feasibility_weight", 0.4)
        self.declare_parameter("llm_model_name", "gpt-4")
        self.declare_parameter("llm_api_key", "")

        usefulness_weight = float(self.get_parameter("usefulness_weight").value)
        feasibility_weight = float(self.get_parameter("feasibility_weight").value)
        try:
            self._fusion = WeightedProductFusion(
                {
                    "usefulness": usefulness_weight,
                    "feasibility": feasibility_weight,
                }
            )
        except ValueError as exc:
            self.get_logger().error(
                f"Invalid affordance weights ({usefulness_weight}, {feasibility_weight}): {exc}. "
                "Falling back to defaults 0.6/0.4."
            )
            self._fusion = WeightedProductFusion({"usefulness": 0.6, "feasibility": 0.4})

        self._usefulness_scorer = LLMUsefulnessScorer(
            api_key=str(self.get_parameter("llm_api_key").value),
            model_name=str(self.get_parameter("llm_model_name").value),
        )
        self._reachability_scorer = ReachabilityScorer()
        self._collision_scorer = CollisionScorer()
        self._object_state_scorer = ObjectStateScorer()

        self._score_srv = self.create_service(
            ScoreAffordances,
            _SERVICE_SCORE,
            self._handle_score_affordances,
        )
        self.get_logger().info(
            f"ScoreAffordances service ready at '{_SERVICE_SCORE}'"
        )

    def _handle_score_affordances(self, request, response):  # noqa: ANN001
        """Handle ``ScoreAffordances`` requests."""
        intent_dict = self._intent_to_dict(request.intent)
        scored: list[AffordanceScore] = []

        for skill_name in request.skill_names:
            usefulness = _clamp01(
                self._usefulness_scorer.score(intent_dict, skill_name)
            )
            reachability = _clamp01(
                self._reachability_scorer.score(intent_dict, skill_name)
            )
            collision_free = _clamp01(
                self._collision_scorer.score(intent_dict, skill_name)
            )
            object_state = _clamp01(
                self._object_state_scorer.score(intent_dict, skill_name)
            )
            feasibility = _clamp01(reachability * collision_free * object_state)
            combined = _clamp01(self._fusion.fuse(usefulness, feasibility))

            score_msg = AffordanceScore()
            score_msg.skill_name = skill_name
            score_msg.usefulness = usefulness
            score_msg.feasibility = feasibility
            score_msg.combined_score = combined
            score_msg.breakdown_json = json.dumps(
                {
                    "reachability": reachability,
                    "collision_free": collision_free,
                    "object_state": object_state,
                    "fusion": "weighted_product",
                }
            )
            scored.append(score_msg)

        scored.sort(key=lambda score: score.combined_score, reverse=True)
        response.scores = scored
        return response

    @staticmethod
    def _intent_to_dict(intent_msg: Intent) -> dict[str, Any]:
        """Convert ROS ``Intent`` message to scorer-friendly dict."""
        return {
            "version": intent_msg.version,
            "command_id": intent_msg.command_id,
            "raw_text": intent_msg.raw_text,
            "action": intent_msg.action,
            "target_object": intent_msg.target_object,
            "target_location": intent_msg.target_location,
            "parameters_json": intent_msg.parameters_json,
            "confidence": float(intent_msg.confidence),
        }


def main(args=None) -> None:
    """Entry point registered in setup.py console_scripts."""
    rclpy.init(args=args)
    node = AffordanceNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
