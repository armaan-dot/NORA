"""nora_orchestrator.orchestrator_node
========================================
Top-level NORA task orchestrator ROS 2 node.

Responsibilities
----------------
1. Subscribe to ``/nora/intent`` (std_msgs/String — JSON-encoded intent).
2. Call the ``ScoreAffordances`` service to rank applicable skills.
3. Use :mod:`nora_core.planner` to build an ordered skill plan.
4. Dispatch skill action clients in sequence.
5. Publish orchestrator state to ``/nora/orchestrator/state``.
6. Expose an ``ExecuteIntent`` action server for clients that want
   end-to-end confirmation.
7. Replan on skill failure via :meth:`_handle_skill_failure`.
"""

from __future__ import annotations

import json
import time
from typing import Any, Optional

import rclpy
from rclpy.action import ActionClient, ActionServer
from rclpy.node import Node
from rclpy.callback_groups import ReentrantCallbackGroup, MutuallyExclusiveCallbackGroup
from std_msgs.msg import String

from nora_orchestrator.state_machine import OrchestratorState, OrchestratorStateMachine

# TODO(nora): import real interface types once nora_interfaces is built.
try:
    from nora_interfaces.action import ExecuteIntent as ExecuteIntentAction
    from nora_interfaces.srv import ScoreAffordances
except ImportError:
    ExecuteIntentAction = None  # type: ignore[assignment,misc]
    ScoreAffordances = None     # type: ignore[assignment,misc]


class OrchestratorNode(Node):
    """NORA task orchestrator.

    Parameters
    ----------
    All configuration is loaded from ``config/orchestrator.yaml`` via ROS 2
    parameter server.

    ROS Interfaces
    --------------
    Subscriptions:
        /nora/intent             (std_msgs/String)  — JSON-encoded intent

    Publishers:
        /nora/orchestrator/state (std_msgs/String)  — current FSM state string

    Service clients:
        /nora/score_affordances  (ScoreAffordances) — ranks skills for intent

    Action servers:
        /nora/execute_intent     (ExecuteIntent)    — end-to-end task execution

    Action clients (one per skill):
        /nora/skills/pick
        /nora/skills/place
        /nora/skills/move_to_pose
        /nora/skills/open_gripper
        /nora/skills/close_gripper
        /nora/skills/go_home
    """

    def __init__(self) -> None:
        super().__init__("nora_orchestrator")

        # ---- Parameters --------------------------------------------------
        self.declare_parameter("max_replanning_attempts", 3)
        self.declare_parameter("skill_timeout_sec", 30.0)
        self.declare_parameter("score_threshold", 0.3)

        self._max_replanning = self.get_parameter("max_replanning_attempts").value
        self._skill_timeout = self.get_parameter("skill_timeout_sec").value
        self._score_threshold = self.get_parameter("score_threshold").value

        # ---- State machine -----------------------------------------------
        self._sm = OrchestratorStateMachine(
            on_transition=self._on_state_transition
        )
        self._replanning_attempts: int = 0

        # ---- Callback groups ---------------------------------------------
        self._reentrant_group = ReentrantCallbackGroup()
        self._exclusive_group = MutuallyExclusiveCallbackGroup()

        # ---- Publishers --------------------------------------------------
        self._state_pub = self.create_publisher(
            String, "/nora/orchestrator/state", 10
        )

        # ---- Subscriptions -----------------------------------------------
        self._intent_sub = self.create_subscription(
            String,
            "/nora/intent",
            self._intent_callback,
            10,
            callback_group=self._reentrant_group,
        )

        # ---- Service clients ---------------------------------------------
        # TODO(nora): create ScoreAffordances service client when the interface exists.
        #   self._score_client = self.create_client(
        #       ScoreAffordances, "/nora/score_affordances"
        #   )

        # ---- Action clients (one per skill) ------------------------------
        self._skill_clients: dict[str, ActionClient] = {}
        _skill_topics = [
            "pick", "place", "move_to_pose",
            "open_gripper", "close_gripper", "go_home",
        ]
        for skill in _skill_topics:
            # TODO(nora): replace None with the concrete action type from nora_interfaces.
            #   self._skill_clients[skill] = ActionClient(
            #       self, SkillActionType, f"/nora/skills/{skill}"
            #   )
            self.get_logger().info(
                f"[Orchestrator] Would create action client for /nora/skills/{skill}"
            )

        # ---- ExecuteIntent action server ---------------------------------
        # TODO(nora): uncomment once nora_interfaces is available.
        # self._execute_intent_server = ActionServer(
        #     self,
        #     ExecuteIntentAction,
        #     "/nora/execute_intent",
        #     execute_callback=self._execute_intent_callback,
        #     callback_group=self._exclusive_group,
        # )

        self.get_logger().info("OrchestratorNode ready.")
        self._publish_state()

    # ------------------------------------------------------------------
    # Intent subscription callback
    # ------------------------------------------------------------------

    def _intent_callback(self, msg: String) -> None:
        """Handle an incoming intent from the NLU pipeline.

        Parameters
        ----------
        msg:
            std_msgs/String whose ``data`` field is a JSON-encoded intent dict,
            e.g. ``{"action": "pick", "object": "red_cube"}``.
        """
        self.get_logger().info(f"[Orchestrator] Received intent: {msg.data}")
        try:
            intent = json.loads(msg.data)
        except json.JSONDecodeError as exc:
            self.get_logger().error(f"[Orchestrator] Bad intent JSON: {exc}")
            return

        self._replanning_attempts = 0
        self._sm.transition(OrchestratorState.PARSING)

        # TODO(nora): validate intent schema (required fields: 'action').
        self._run_task(intent)

    # ------------------------------------------------------------------
    # Main task pipeline
    # ------------------------------------------------------------------

    def _run_task(self, intent: dict) -> None:
        """Orchestrate a full task from intent to execution.

        Steps
        -----
        1. Score affordances.
        2. Build skill plan.
        3. Execute skills in order.
        """
        # Step 1: Score affordances
        self._sm.transition(OrchestratorState.SCORING)
        scores = self._call_score_affordances(intent)

        if not scores:
            self.get_logger().error("[Orchestrator] No affordances scored above threshold.")
            self._sm.transition(OrchestratorState.FAILED)
            self._sm.transition(OrchestratorState.IDLE)
            return

        # Step 2: Plan
        self._sm.transition(OrchestratorState.PLANNING)
        plan = self._build_plan(intent, scores)

        if not plan:
            self.get_logger().error("[Orchestrator] Planner returned empty plan.")
            self._sm.transition(OrchestratorState.FAILED)
            self._sm.transition(OrchestratorState.IDLE)
            return

        # Step 3: Execute
        self._sm.transition(OrchestratorState.EXECUTING)
        self._execute_plan(plan, intent)

    # ------------------------------------------------------------------
    # Affordance scoring
    # ------------------------------------------------------------------

    def _call_score_affordances(self, intent: dict) -> dict[str, float]:
        """Call the ScoreAffordances service and return skill→score mapping.

        Returns
        -------
        dict mapping skill name → affordance score.  Empty dict on failure.
        """
        # TODO(nora): implement real service call.
        #   request = ScoreAffordances.Request()
        #   request.intent_json = json.dumps(intent)
        #   future = self._score_client.call_async(request)
        #   rclpy.spin_until_future_complete(self, future, timeout_sec=5.0)
        #   response = future.result()
        #   return {s.name: s.score for s in response.scored_skills
        #           if s.score >= self._score_threshold}

        self.get_logger().warn(
            "[Orchestrator] MOCK: returning dummy affordance scores."
        )
        return {"pick": 0.9, "move_to_pose": 0.6}

    # ------------------------------------------------------------------
    # Planning
    # ------------------------------------------------------------------

    def _build_plan(
        self, intent: dict, scores: dict[str, float]
    ) -> list[dict]:
        """Build an ordered list of skill invocations.

        Parameters
        ----------
        intent:
            The parsed intent dict from NLU.
        scores:
            Affordance scores from :meth:`_call_score_affordances`.

        Returns
        -------
        List of dicts with keys ``skill`` and ``params``.
        """
        # TODO(nora): use nora_core.planner to build the actual plan using
        #   the skill registry, affordance scores, and world state.
        #   from nora_core.planner import Planner
        #   planner = Planner(skill_registry=..., world_state=...)
        #   return planner.plan(intent, scores)

        self.get_logger().warn(
            "[Orchestrator] MOCK: returning dummy plan [move_to_pose → pick]."
        )
        return [
            {"skill": "move_to_pose", "params": {"pose_name": "pre_grasp"}},
            {"skill": "pick", "params": {"target_object": intent.get("object", "unknown")}},
        ]

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def _execute_plan(self, plan: list[dict], intent: dict) -> None:
        """Execute the skill plan sequentially.

        On failure, calls :meth:`_handle_skill_failure` to attempt replanning.
        """
        for step in plan:
            skill_name: str = step["skill"]
            params: dict = step.get("params", {})

            self.get_logger().info(
                f"[Orchestrator] Executing skill '{skill_name}' with params {params}"
            )

            success = self._dispatch_skill(skill_name, params)

            if not success:
                error_msg = f"Skill '{skill_name}' failed."
                self.get_logger().error(f"[Orchestrator] {error_msg}")
                recovered = self._handle_skill_failure(skill_name, error_msg, intent)
                if not recovered:
                    self._sm.transition(OrchestratorState.FAILED)
                    self._sm.transition(OrchestratorState.IDLE)
                    return

        self._sm.transition(OrchestratorState.DONE)
        self.get_logger().info("[Orchestrator] Task completed successfully.")
        self._sm.transition(OrchestratorState.IDLE)

    def _dispatch_skill(self, skill_name: str, params: dict) -> bool:
        """Send goal to a skill action server and wait for result.

        Parameters
        ----------
        skill_name:
            Key in ``self._skill_clients``.
        params:
            Goal parameters to populate the action goal message.

        Returns
        -------
        True if the skill reported success, False otherwise.
        """
        # TODO(nora): implement real action client dispatch.
        #   client = self._skill_clients.get(skill_name)
        #   if client is None or not client.wait_for_server(timeout_sec=5.0):
        #       self.get_logger().error(f"Skill server '{skill_name}' unavailable.")
        #       return False
        #   goal_msg = build_goal_msg(skill_name, params)
        #   future = client.send_goal_async(goal_msg)
        #   ...wait and check result...

        self.get_logger().warn(
            f"[Orchestrator] MOCK: pretending skill '{skill_name}' succeeded."
        )
        time.sleep(0.1)   # simulate network round-trip
        return True

    # ------------------------------------------------------------------
    # Replanning hook
    # ------------------------------------------------------------------

    def _handle_skill_failure(
        self, skill_name: str, error: str, intent: dict
    ) -> bool:
        """Handle a skill failure, potentially triggering a replan.

        Parameters
        ----------
        skill_name:
            The name of the skill that failed.
        error:
            Human-readable error description.
        intent:
            The original intent, used to replan from scratch.

        Returns
        -------
        True if recovery was successful, False if max attempts exhausted.
        """
        self._sm.transition(OrchestratorState.RECOVERING)
        self._replanning_attempts += 1

        self.get_logger().warn(
            f"[Orchestrator] Skill failure: '{skill_name}' — attempt "
            f"{self._replanning_attempts}/{self._max_replanning}. Error: {error}"
        )

        if self._replanning_attempts >= self._max_replanning:
            self.get_logger().error(
                "[Orchestrator] Max replanning attempts reached. Giving up."
            )
            return False

        # TODO(nora): implement real replanning strategy:
        #   1. Update world state to reflect the failure.
        #   2. Query the skill registry for alternative skills.
        #   3. Re-score with ScoreAffordances using updated context.
        #   4. Build a new plan that avoids the failed skill or uses recovery.
        #   e.g.:
        #     new_scores = self._call_score_affordances(intent)
        #     new_plan = self._build_plan(intent, new_scores)
        #     self._sm.transition(OrchestratorState.PLANNING)
        #     self._execute_plan(new_plan, intent)

        self.get_logger().warn(
            "[Orchestrator] STUB: replanning not yet implemented — returning False."
        )
        return False

    # ------------------------------------------------------------------
    # ExecuteIntent action server callback (stub)
    # ------------------------------------------------------------------

    async def _execute_intent_callback(self, goal_handle: Any) -> Any:
        """End-to-end ExecuteIntent action server callback.

        Clients send a natural-language command; this node handles NLU,
        scoring, planning, and execution, then reports success or failure.
        """
        # TODO(nora): implement full pipeline inside this callback.
        goal = goal_handle.request
        self.get_logger().info(
            f"[Orchestrator] ExecuteIntent goal: '{getattr(goal, 'command', '')}'"
        )
        goal_handle.abort()
        result = ExecuteIntentAction.Result()
        result.success = False
        result.message = "ExecuteIntent not yet implemented"
        return result

    # ------------------------------------------------------------------
    # State machine callback
    # ------------------------------------------------------------------

    def _on_state_transition(
        self,
        old: OrchestratorState,
        new: OrchestratorState,
    ) -> None:
        """Called after every FSM transition — publishes state to topic."""
        self.get_logger().info(
            f"[Orchestrator] State: {old.value} → {new.value}"
        )
        self._publish_state()

    def _publish_state(self) -> None:
        """Publish the current FSM state to ``/nora/orchestrator/state``."""
        msg = String()
        msg.data = self._sm.current_state.value
        self._state_pub.publish(msg)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(args=None):
    """Spin the OrchestratorNode."""
    rclpy.init(args=args)
    node = OrchestratorNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
