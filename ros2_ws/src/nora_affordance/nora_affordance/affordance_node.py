"""
nora_affordance/affordance_node.py
───────────────────────────────────
ROS 2 node: AffordanceNode

Exposes:
  - Service ``/nora/score_affordances`` (nora_interfaces/srv/ScoreAffordances)
  - Topic ``/nora/affordance_score`` (std_msgs/Float32): combined score of the best skill from the
    most recent request, so Foxglove / rqt_plot can chart it.

The node scores each candidate skill using:
  - usefulness: relevance of the skill to the intent action, scaled by the parse confidence
  - feasibility: product of reachability (IK on the URDF chain), collision clearance and
    object state, all computed from ``/nora/world_model/state``
  - fusion: weighted geometric mean (usefulness^w_u * feasibility^w_f)

The scoring itself lives in :mod:`nora_affordance.scoring`.
"""

from __future__ import annotations

import json
import math
import os
from typing import Any, Optional

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile
from std_msgs.msg import Float32, String

from nora_affordance import scoring
from nora_core.affordance.fusion import WeightedProductFusion
from nora_interfaces.msg import AffordanceScore, Intent, WorldState
from nora_interfaces.srv import ScoreAffordances

_SERVICE_SCORE = "/nora/score_affordances"
_TOPIC_SCORE = "/nora/affordance_score"
_TOPIC_WORLD = "/nora/world_model/state"
_TOPIC_URDF = "/robot_description"


class AffordanceNode(Node):
    """Score candidate skills for an intent via a ROS 2 service."""

    def __init__(self) -> None:
        super().__init__("affordance_node")

        self.declare_parameter("usefulness_weight", 0.6)
        self.declare_parameter("feasibility_weight", 0.4)
        self.declare_parameter("base_link", "base_link")
        self.declare_parameter("tip_links", ["tcp", "gripper_link"])
        self.declare_parameter(
            "arm_joints", ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6"]
        )
        self.declare_parameter("tool_axis", [0.0, 0.0, 1.0])
        self.declare_parameter("approach_height", 0.02)
        self.declare_parameter("ik_position_tolerance", 0.01)
        self.declare_parameter("ik_angle_tolerance_deg", 10.0)
        self.declare_parameter("gripper_half_width", 0.085)
        self.declare_parameter("clearance_margin", 0.015)
        # WorldObject carries no size, so every object is assumed to be this wide.
        self.declare_parameter("assumed_object_radius", 0.03)

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

        self._params = scoring.Params(
            approach_height=float(self.get_parameter("approach_height").value),
            tool_axis=tuple(float(v) for v in self.get_parameter("tool_axis").value),
            ik_position_tolerance=float(self.get_parameter("ik_position_tolerance").value),
            ik_angle_tolerance=math.radians(
                float(self.get_parameter("ik_angle_tolerance_deg").value)
            ),
            gripper_clearance=float(self.get_parameter("gripper_half_width").value)
            + float(self.get_parameter("clearance_margin").value),
            object_radius=float(self.get_parameter("assumed_object_radius").value),
        )

        self._objects: Optional[list[dict]] = None  # None until a WorldState arrives
        self._chain: Optional[scoring.Chain] = None
        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.create_subscription(WorldState, _TOPIC_WORLD, self._on_world, latched)
        self.create_subscription(String, _TOPIC_URDF, self._on_robot_description, latched)
        self._load_urdf_from_xacro()

        self._score_pub = self.create_publisher(Float32, _TOPIC_SCORE, 10)
        self._score_srv = self.create_service(
            ScoreAffordances,
            _SERVICE_SCORE,
            self._handle_score_affordances,
        )
        self.get_logger().info(
            f"ScoreAffordances service ready at '{_SERVICE_SCORE}'"
        )

    # -- inputs ------------------------------------------------------------

    def _load_urdf_from_xacro(self) -> None:
        try:
            import xacro
            from ament_index_python.packages import get_package_share_directory

            path = os.path.join(
                get_package_share_directory("nora_description"), "urdf", "nora_arm.urdf.xacro"
            )
            self._set_chain(xacro.process_file(path).toxml(), path)
        except Exception as exc:  # noqa: BLE001
            self.get_logger().warn(
                f"Could not load the arm URDF from xacro ({exc}); waiting for '{_TOPIC_URDF}'"
            )

    def _on_robot_description(self, msg: String) -> None:
        if self._chain is None:
            try:
                self._set_chain(msg.data, _TOPIC_URDF)
            except Exception as exc:  # noqa: BLE001
                self.get_logger().error(f"Could not parse '{_TOPIC_URDF}': {exc}")

    def _set_chain(self, urdf_xml: str, source: str) -> None:
        chain = scoring.parse_chain(
            urdf_xml,
            str(self.get_parameter("base_link").value),
            list(self.get_parameter("tip_links").value),
            list(self.get_parameter("arm_joints").value),
        )
        self._chain = chain
        self.get_logger().info(
            f"Arm chain from {source}: {len(chain.names)} joints to '{chain.tip}', "
            f"max reach {chain.reach()[1]:.2f} m"
        )

    def _on_world(self, msg: WorldState) -> None:
        self._objects = [
            {
                "id": obj.id,
                "label": obj.label,
                "position": [
                    obj.pose.pose.position.x,
                    obj.pose.pose.position.y,
                    obj.pose.pose.position.z,
                ],
                "state": obj.state,
                "visible": bool(obj.visible),
                "confidence": float(obj.confidence),
            }
            for obj in msg.objects
        ]

    # -- service -----------------------------------------------------------

    def _handle_score_affordances(self, request, response):  # noqa: ANN001
        """Handle ``ScoreAffordances`` requests."""
        intent_dict = self._intent_to_dict(request.intent)
        scored: list[AffordanceScore] = []
        ik_cache: dict = {}

        for skill_name in request.skill_names:
            usefulness = scoring.usefulness_score(skill_name, intent_dict)
            try:
                parts, notes = scoring.feasibility_scores(
                    skill_name, intent_dict, self._objects, self._chain, self._params, ik_cache
                )
            except Exception as exc:  # noqa: BLE001
                self.get_logger().error(f"Scoring '{skill_name}' failed: {exc}")
                parts = dict.fromkeys(
                    ("reachability", "collision_free", "object_state"), scoring.UNAVAILABLE
                )
                notes = {"error": str(exc)}
            reachability = scoring.clamp01(parts["reachability"])
            collision_free = scoring.clamp01(parts["collision_free"])
            object_state = scoring.clamp01(parts["object_state"])
            feasibility = scoring.clamp01(reachability * collision_free * object_state)
            combined = scoring.clamp01(self._fusion.fuse(usefulness, feasibility))

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
                    "notes": notes,
                }
            )
            scored.append(score_msg)

        scored.sort(key=lambda score: score.combined_score, reverse=True)
        if scored:
            top = Float32()
            top.data = float(scored[0].combined_score)
            self._score_pub.publish(top)
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
