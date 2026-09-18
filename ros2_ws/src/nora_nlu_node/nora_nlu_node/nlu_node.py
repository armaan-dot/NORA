"""
nora_nlu_node/nlu_node.py
──────────────────────────
ROS 2 node: NLUNode

Subscribes to nothing by default.  Exposes:
  - Service  ``/nora/parse_command``  (nora_interfaces/srv/ParseCommand)
  - Publisher ``/nora/intent``         (nora_interfaces/msg/Intent)

On each service call the node runs the configured NLU backend, publishes the
resulting Intent, and returns it in the service response.

ROS Parameters
--------------
backend              : str  = "mock"   — "mock" | "local"
model_path           : str  = ""       — path to HF model dir (local backend)
confidence_threshold : float = 0.5     — intents below this are flagged low-confidence
"""

from __future__ import annotations

import rclpy
from rclpy.node import Node

from nora_nlu_node.intent_parser import IntentParser
from nora_nlu_node.mock_parser import MockRuleBasedParser
from nora_nlu_node.local_parser import LocalFineTunedParser

# TODO(nora): Replace these stubs with actual message/service imports once
#             nora_interfaces is built and installed:
#
#   from nora_interfaces.msg import Intent
#   from nora_interfaces.srv import ParseCommand
#
# Until then the node uses plain dicts internally and logs the intent.

_TOPIC_INTENT = "/nora/intent"
_SERVICE_PARSE = "/nora/parse_command"


class NLUNode(Node):
    """ROS 2 node that converts text commands into structured Intent messages.

    Backends
    --------
    mock  — :class:`~nora_nlu_node.mock_parser.MockRuleBasedParser`
    local — :class:`~nora_nlu_node.local_parser.LocalFineTunedParser`
    """

    def __init__(self) -> None:
        super().__init__("nlu_node")

        # ── Declare parameters ─────────────────────────────────────────────────
        self.declare_parameter("backend", "mock")
        self.declare_parameter("model_path", "")
        self.declare_parameter("confidence_threshold", 0.5)

        backend: str = self.get_parameter("backend").get_parameter_value().string_value
        model_path: str = self.get_parameter("model_path").get_parameter_value().string_value
        self._confidence_threshold: float = (
            self.get_parameter("confidence_threshold")
            .get_parameter_value()
            .double_value
        )

        # ── Instantiate parser backend ─────────────────────────────────────────
        self._parser: IntentParser = self._build_parser(backend, model_path)
        self.get_logger().info(f"NLUNode started with backend='{backend}'")

        # ── Publisher ──────────────────────────────────────────────────────────
        # TODO(nora): Replace std_msgs/String with nora_interfaces/msg/Intent
        #             once the interface package is available.
        from std_msgs.msg import String

        self._intent_pub = self.create_publisher(String, _TOPIC_INTENT, 10)

        # ── Service ────────────────────────────────────────────────────────────
        # TODO(nora): Swap out std_srvs for nora_interfaces/srv/ParseCommand.
        #   self._parse_srv = self.create_service(
        #       ParseCommand, _SERVICE_PARSE, self._handle_parse_command
        #   )
        #
        # Placeholder: expose a simple string service for now.
        from std_srvs.srv import Trigger

        self._parse_srv = self.create_service(
            Trigger, _SERVICE_PARSE, self._handle_parse_trigger
        )
        self.get_logger().info(
            f"ParseCommand service ready at '{_SERVICE_PARSE}' "
            f"(confidence_threshold={self._confidence_threshold})"
        )

    # ── Service handlers ───────────────────────────────────────────────────────

    def _handle_parse_trigger(self, request, response):  # noqa: ANN001
        """Placeholder handler — replace with ParseCommand once interfaces exist.

        TODO(nora): Replace Trigger with ParseCommand service type and read
                    request.text to get the command string.
        """
        sample_text = "pick up the red cube"  # TODO(nora): read from request.text
        intent_dict = self._run_parser(sample_text)
        response.success = intent_dict["action"] != "unknown"
        response.message = str(intent_dict)
        return response

    def _handle_parse_command(self, request, response):  # noqa: ANN001
        """Full handler for nora_interfaces/srv/ParseCommand.

        TODO(nora): Uncomment and adapt once ParseCommand is defined.
        """
        intent_dict = self._run_parser(request.text)

        # Build Intent message
        # intent_msg = Intent()
        # intent_msg.action = intent_dict["action"]
        # intent_msg.target_object = intent_dict["target_object"]
        # intent_msg.confidence = intent_dict["confidence"]
        # intent_msg.raw_text = intent_dict["raw_text"]

        # self._intent_pub.publish(intent_msg)
        # response.intent = intent_msg
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

        # Publish as string until Intent msg is available
        from std_msgs.msg import String

        msg = String()
        msg.data = str(intent_dict)
        self._intent_pub.publish(msg)
        return intent_dict

    @staticmethod
    def _build_parser(backend: str, model_path: str) -> IntentParser:
        """Factory: return the appropriate parser for *backend*."""
        if backend == "mock":
            return MockRuleBasedParser()
        if backend == "local":
            return LocalFineTunedParser(model_path=model_path)
        raise ValueError(
            f"Unknown NLU backend '{backend}'. Valid options: 'mock', 'local'."
        )


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
