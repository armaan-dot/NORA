"""
nora_nlu_node/nlu_node.py
──────────────────────────
ROS 2 node: NLUNode

Subscribes to nothing by default. Exposes:
  - Service  ``/nora/parse_command``  (nora_interfaces/srv/ParseCommand)
  - Publisher ``/nora/intent``         (nora_interfaces/msg/Intent)

On each service call the node runs the local NLU model, publishes the resulting
Intent, and returns it in the service response.

ROS Parameters
--------------
model_path           : str             — path to the local Hugging Face model
confidence_threshold : float = 0.5     — intents below this are flagged low-confidence
"""

from __future__ import annotations

import rclpy
from rclpy.node import Node
from nora_interfaces.msg import Intent
from nora_interfaces.srv import ParseCommand

from nora_nlu_node.intent_parser import IntentParser
from nora_nlu_node.local_parser import LocalFineTunedParser

_TOPIC_INTENT = "/nora/intent"
_SERVICE_PARSE = "/nora/parse_command"


class NLUNode(Node):
    """ROS 2 node that converts text commands into structured Intent messages.

    The model-backed parser is loaded during node startup.
    """

    def __init__(self) -> None:
        super().__init__("nlu_node")

        # ── Declare parameters ─────────────────────────────────────────────────
        self.declare_parameter("model_path", "")
        self.declare_parameter("confidence_threshold", 0.5)

        model_path: str = self.get_parameter("model_path").get_parameter_value().string_value
        self._confidence_threshold: float = (
            self.get_parameter("confidence_threshold")
            .get_parameter_value()
            .double_value
        )

        # ── Load the model before advertising the service ─────────────────────
        self._parser: IntentParser = LocalFineTunedParser(model_path=model_path)
        self.get_logger().info(f"NLUNode loaded model from '{model_path}'")

        # ── Publisher ──────────────────────────────────────────────────────────
        self._intent_pub = self.create_publisher(Intent, _TOPIC_INTENT, 10)

        # ── Service ────────────────────────────────────────────────────────────
        self._parse_srv = self.create_service(
            ParseCommand, _SERVICE_PARSE, self._handle_parse_command
        )
        self.get_logger().info(
            f"ParseCommand service ready at '{_SERVICE_PARSE}' "
            f"(confidence_threshold={self._confidence_threshold})"
        )

    # ── Service handlers ───────────────────────────────────────────────────────

    def _handle_parse_command(self, request, response):  # noqa: ANN001
        """Parse a command, publish the intent, and return it to the caller."""
        try:
            if not request.raw_text.strip():
                raise ValueError("raw_text must not be empty")
            intent_dict = self._run_parser(request.raw_text)
            intent_msg = self._to_ros_intent(intent_dict)
            response.intent = intent_msg
            response.success = intent_msg.action != "unknown"
            response.error_msg = "" if response.success else "Unable to identify a supported action"
        except Exception as exc:
            response.success = False
            response.error_msg = str(exc)
            self.get_logger().error(f"Could not parse command: {exc}")
        return response

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _run_parser(self, text: str) -> dict:
        """Run the parser and publish the result; return the intent dict."""
        intent_dict = self._parser.parse(text)
        self.get_logger().info(
            f"Parsed intent: action={intent_dict['action']!r} "
            f"object={intent_dict['target_object']!r} "
            f"confidence={intent_dict['confidence']:.2f}"
        )
        if intent_dict["confidence"] < self._confidence_threshold:
            self.get_logger().warn(
                f"Low-confidence parse ({intent_dict['confidence']:.2f} < "
                f"{self._confidence_threshold}) — intent may be unreliable."
            )

        msg = self._to_ros_intent(intent_dict)
        self._intent_pub.publish(msg)
        return intent_dict

    @staticmethod
    def _to_ros_intent(intent_dict: dict) -> Intent:
        msg = Intent()
        msg.version = intent_dict["version"]
        msg.command_id = intent_dict["command_id"]
        msg.raw_text = intent_dict["raw_text"]
        msg.action = intent_dict["action"]
        msg.target_object = intent_dict.get("target_object") or ""
        msg.target_location = intent_dict.get("target_location") or ""
        import json
        msg.parameters_json = json.dumps(intent_dict.get("parameters", {}))
        msg.confidence = float(intent_dict["confidence"])
        return msg


# ── Entry point ────────────────────────────────────────────────────────────────

def main(args=None) -> None:
    """Entry point registered in setup.py console_scripts."""
    rclpy.init(args=args)
    node = NLUNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
