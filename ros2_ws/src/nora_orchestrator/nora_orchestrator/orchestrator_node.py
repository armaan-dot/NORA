"""nora_orchestrator.orchestrator_node
========================================
Top-level NORA task orchestrator ROS 2 node.

Responsibilities
----------------
1. Subscribe to ``/nora/intent`` (nora_interfaces/Intent from the NLU node).
2. Call the ``ScoreAffordances`` service to rank applicable skills.
3. Build an ordered skill plan.
4. Send the plan to the behavior-tree executor (``/nora/execute_plan``).
5. Publish orchestrator state to ``/nora/orchestrator/state``.
6. On a recoverable failure, replan from the executor's structured failure
   report and the world model, and execute the revised plan
   (:meth:`_handle_skill_failure`). Critical failures end in a safe stop.
7. Answer "where is ..." questions from the world model on ``/nora/response``.
"""

from __future__ import annotations

import json
import re
import threading
from typing import Any, Optional

import rclpy
from rclpy.action import ActionClient
from rclpy.node import Node
from rclpy.callback_groups import ReentrantCallbackGroup, MutuallyExclusiveCallbackGroup
from rclpy.qos import DurabilityPolicy, QoSProfile
from std_msgs.msg import String

from nora_interfaces.action import ExecuteIntent as ExecuteIntentAction
from nora_interfaces.action import ExecutePlan
from nora_interfaces.msg import Intent, SkillCall, WorldState
from nora_interfaces.srv import QueryWorld, ScoreAffordances, UpdateWorld
from nora_orchestrator.replanner import find_object, replan
from nora_orchestrator.state_machine import OrchestratorState, OrchestratorStateMachine

_QUERY_WORDS = {
    "where", "what", "which", "is", "are", "was", "did", "do", "does", "i", "you", "the", "my",
    "a", "an", "it", "leave", "left", "put", "last", "see", "seen", "location", "of", "robot",
    "now", "currently", "right",
}


class OrchestratorNode(Node):
    """NORA task orchestrator.

    Parameters
    ----------
    All configuration is loaded from ``config/orchestrator.yaml`` via ROS 2
    parameter server.

    ROS Interfaces
    --------------
    Subscriptions:
        /nora/intent             (nora_interfaces/Intent)
        /nora/world_model/state  (nora_interfaces/WorldState)

    Publishers:
        /nora/orchestrator/state (std_msgs/String)  — current FSM state string
        /nora/response           (std_msgs/String)  — answers and task outcomes

    Service clients:
        /nora/score_affordances  (ScoreAffordances) — ranks skills for intent
        /nora/world_model/query  (QueryWorld)
        /nora/world_model/update (UpdateWorld)

    Action clients:
        /nora/execute_plan       (ExecutePlan)      — behavior-tree executor
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
        self._plan_timeout = self.declare_parameter("plan_timeout_sec", 600.0).value

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
        self._response_pub = self.create_publisher(String, "/nora/response", 10)

        self._intent_sub = self.create_subscription(
            Intent,
            "/nora/intent",
            self._intent_callback,
            10,
            callback_group=self._reentrant_group,
        )
        # Latest world-model snapshot as plain dicts.
        self._world: list[dict] = []
        self._world_sub = self.create_subscription(
            WorldState,
            "/nora/world_model/state",
            lambda msg: setattr(self, "_world", [self._object_dict(o) for o in msg.objects]),
            QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL),
        )

        # ---- Service clients ---------------------------------------------
        self._score_client = self.create_client(ScoreAffordances, "/nora/score_affordances")
        self._query_client = self.create_client(QueryWorld, "/nora/world_model/query")
        self._update_client = self.create_client(UpdateWorld, "/nora/world_model/update")

        # ---- Behavior-tree executor --------------------------------------
        self._plan_client = ActionClient(self, ExecutePlan, "/nora/execute_plan")

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

    def _intent_callback(self, msg: Intent) -> None:
        """Handle an incoming intent from the NLU pipeline.

        The task runs on a worker thread so this node keeps spinning and can
        deliver the service and action responses the task waits for.
        """
        try:
            parameters = json.loads(msg.parameters_json or "{}")
        except json.JSONDecodeError as exc:
            self.get_logger().error(f"[Orchestrator] Bad intent parameters: {exc}")
            return
        intent = {
            "command_id": msg.command_id,
            "raw_text": msg.raw_text,
            "action": msg.action,
            "target_object": msg.target_object,
            "target_location": msg.target_location,
            "confidence": msg.confidence,
            "parameters": parameters,
        }
        self.get_logger().info(f"[Orchestrator] Received intent: {intent}")

        if re.match(r"\s*(where|what|which)\b", msg.raw_text, re.IGNORECASE):
            threading.Thread(target=self._answer_query, args=(intent,), daemon=True).start()
            return
        if self._sm.current_state != OrchestratorState.IDLE:
            self.get_logger().warn("[Orchestrator] Busy with another task; intent ignored.")
            return

        self._replanning_attempts = 0
        self._sm.transition(OrchestratorState.PARSING)
        threading.Thread(target=self._run_task_guarded, args=(intent,), daemon=True).start()

    @staticmethod
    def _wait(future, timeout: float):
        """Block a worker thread until *future* resolves; None on timeout."""
        done = threading.Event()
        future.add_done_callback(lambda _: done.set())
        return future.result() if done.wait(timeout) else None

    @staticmethod
    def _object_dict(obj) -> dict:
        p = obj.pose.pose.position
        return {
            "id": obj.id, "label": obj.label, "state": obj.state, "location": obj.location,
            "visible": obj.visible, "confidence": obj.confidence,
            "frame": obj.pose.header.frame_id, "position": [p.x, p.y, p.z],
        }

    def _respond(self, text: str) -> None:
        self.get_logger().info(f"[Orchestrator] {text}")
        self._response_pub.publish(String(data=text))

    # ------------------------------------------------------------------
    # World-model questions
    # ------------------------------------------------------------------

    def _answer_query(self, intent: dict) -> None:
        """Answer "where is X", "what do you see", "what are you holding"."""
        text = intent["raw_text"].lower()
        request = QueryWorld.Request()
        if "hold" in text:
            request.query = "holding"
        elif re.search(r"\b(see|visible|in view)\b", text) and not text.lstrip().startswith("where"):
            request.query = "visible"
        else:
            request.query = "object"
            request.object_id = intent["target_object"] or "_".join(
                w for w in re.findall(r"[a-z0-9]+", text) if w not in _QUERY_WORDS
            )
        if not self._query_client.wait_for_service(timeout_sec=2.0):
            self._respond("The world model is not running, so I have no record of the scene.")
            return
        response = self._wait(self._query_client.call_async(request), 5.0)
        self._respond(response.answer if response else "The world model did not answer.")

    # ------------------------------------------------------------------
    # Main task pipeline
    # ------------------------------------------------------------------

    def _run_task_guarded(self, intent: dict) -> None:
        try:
            self._run_task(intent)
        except Exception as exc:  # keep the node usable after an unexpected error
            self.get_logger().error(f"[Orchestrator] Task aborted: {exc!r}")
            self._sm.reset()
            self._publish_state()

    def _run_task(self, intent: dict) -> None:
        """Orchestrate a full task from intent to execution.

        Steps
        -----
        1. Score affordances.
        2. Build skill plan.
        3. Execute it on the behavior-tree executor, replanning on failure.
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

        # Step 3: Execute, feeding failures back into planning
        self._sm.transition(OrchestratorState.EXECUTING)
        last_failure: Optional[dict] = None
        while True:
            result = self._execute_plan(plan, intent)
            if result is not None and result.success:
                self._sm.transition(OrchestratorState.DONE)
                self._respond("Task completed.")
                self._sm.transition(OrchestratorState.IDLE)
                return
            if result is None:
                self._respond(
                    "Task failed: the behavior-tree executor is unavailable, rejected the "
                    "plan (emergency stop engaged?) or timed out."
                )
                self._sm.transition(OrchestratorState.FAILED)
                self._sm.transition(OrchestratorState.IDLE)
                return

            failure = {
                "index": result.failed_index,
                "skill": result.failed_skill,
                "code": result.failure_code,
                "reason": result.failure_reason,
                "recoverable": result.recoverable,
            }
            world = [self._object_dict(o) for o in result.world_state]
            plan = self._handle_skill_failure(plan, failure, world, last_failure)
            if plan is None:
                self._respond(f"Task failed: {failure['code']}: {failure['reason']}")
                self._sm.transition(OrchestratorState.FAILED)
                self._sm.transition(OrchestratorState.IDLE)
                return
            last_failure = failure
            self._sm.transition(OrchestratorState.PLANNING)
            self._sm.transition(OrchestratorState.EXECUTING)

    # ------------------------------------------------------------------
    # Affordance scoring
    # ------------------------------------------------------------------

    def _call_score_affordances(self, intent: dict) -> dict[str, float]:
        """Call the ScoreAffordances service and return skill→score mapping."""
        if self._score_client.service_is_ready():
            try:
                request = ScoreAffordances.Request()
                request.intent.raw_text = intent.get("raw_text", "")
                request.intent.action = intent.get("action", "")
                request.intent.target_object = intent.get("target_object") or ""
                request.intent.target_location = intent.get("target_location") or ""
                request.intent.confidence = float(intent.get("confidence", 1.0))
                response = self._wait(self._score_client.call_async(request), 5.0)
                if response is not None and response.scores:
                    return {
                        s.skill_name: float(s.combined_score)
                        for s in response.scores
                        if float(s.combined_score) >= self._score_threshold
                    }
            except Exception as exc:
                self.get_logger().warn(f"[Orchestrator] ScoreAffordances service call error: {exc}")

        # Graceful fallback heuristic when service is offline
        self.get_logger().info("[Orchestrator] Using calculated heuristic affordance scores.")
        action = intent.get("action", "pick")
        if action in ("explicit_blocked", "impossible"):
            self.get_logger().warn(
                f"[Orchestrator] Safety Interlock: action '{action}' is blocked. Affordance score: 0.00."
            )
            return {}

        is_loop = bool(
            intent.get("parameters", {}).get("is_loop")
            or action in ("clean_table", "rerack_table", "loop_task")
        )
        # Check target object presence if target is specified
        target_obj = (intent.get("target_object") or "").strip().lower()
        if target_obj and target_obj not in ("none", "null", "item", ""):
            # If detected objects are known and target is missing, return empty scores (SayCan guardrail rejection)
            if self._world:
                if find_object(self._world, target_obj) is None:
                    self.get_logger().warn(
                        f"[Orchestrator] SayCan Guardrail: target object '{target_obj}' is NOT present in detected objects. Affordance score: 0.00."
                    )
                    return {}

        base_scores = {
            "pick": 0.95 if (is_loop or action in ("pick", "deliver_to_user")) else 0.25,
            "place": 0.92 if (is_loop or action == "place") else 0.15,
            "move_to_pose": 0.85 if is_loop else 0.75,
            "open_gripper": 0.75 if (is_loop or "open" in action) else 0.20,
            "close_gripper": 0.60 if "close" in action else 0.20,
            "go_home": 0.95 if (is_loop or action == "go_home") else 0.30,
        }
        return {k: v for k, v in base_scores.items() if v >= self._score_threshold}

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
        action = intent.get("action", "pick")
        target_obj = intent.get("target_object") or "item"
        target_loc = intent.get("target_location") or "target"
        params = intent.get("parameters", {})
        is_loop = bool(params.get("is_loop") or action in ("clean_table", "rerack_table", "loop_task"))

        if is_loop:
            targets = params.get("loop_targets") or params.get("objects") or ["red_cube", "blue_cylinder", "green_sphere"]
            count = params.get("loop_count", len(targets))
            source = params.get("source", "tray" if action == "rerack_table" else "table")
            destination = params.get("destination", "table" if action == "rerack_table" else "tray")

            execution_items = [targets[i % len(targets)] for i in range(count)]
            plan = []
            for item in execution_items:
                if source == "tray":
                    plan.extend([
                        {"skill": "move_to_pose", "params": {"pose_name": "approach_target", "target": "tray"}},
                        {"skill": "open_gripper", "params": {"stroke_mm": 80}},
                        {"skill": "pick", "params": {"target_object": item, "from_tray": True}},
                        {"skill": "move_to_pose", "params": {"pose_name": "pre_grasp", "target": item}},
                        {"skill": "place", "params": {"target_location": "table", "target_object": item}},
                        {"skill": "open_gripper", "params": {"stroke_mm": 80}},
                    ])
                else:
                    plan.extend([
                        {"skill": "move_to_pose", "params": {"pose_name": "pre_grasp", "target": item}},
                        {"skill": "open_gripper", "params": {"stroke_mm": 80}},
                        {"skill": "pick", "params": {"target_object": item}},
                        {"skill": "move_to_pose", "params": {"pose_name": "handover" if destination == "user" else "approach_target", "target": destination}},
                        {"skill": "place", "params": {"target_location": destination, "target_object": item}},
                        {"skill": "open_gripper", "params": {"stroke_mm": 80}},
                    ])
            plan.append({"skill": "go_home", "params": {}})
            return plan
        elif action in ("pick", "deliver_to_user"):
            is_user = target_loc == "user" or action == "deliver_to_user"
            plan = [
                {"skill": "move_to_pose", "params": {"pose_name": "pre_grasp", "target": target_obj}},
                {"skill": "open_gripper", "params": {"stroke_mm": 80}},
                {"skill": "pick", "params": {"target_object": target_obj}},
                {"skill": "move_to_pose", "params": {"pose_name": "handover" if is_user else "lift"}},
            ]
            if is_user:
                plan.extend([
                    {"skill": "open_gripper", "params": {"stroke_mm": 80}},
                    {"skill": "go_home", "params": {}},
                ])
            return plan
        elif action == "place":
            return [
                {"skill": "move_to_pose", "params": {"pose_name": "approach_target", "target": target_loc}},
                {"skill": "place", "params": {"target_location": target_loc}},
                {"skill": "go_home", "params": {}},
            ]
        elif action == "go_home":
            return [{"skill": "go_home", "params": {}}]
        elif action == "open_gripper":
            return [{"skill": "open_gripper", "params": {}}]
        elif action == "close_gripper":
            return [{"skill": "close_gripper", "params": intent.get("parameters", {})}]
        else:
            return [
                {"skill": "move_to_pose", "params": {"pose_name": "pre_grasp"}},
                {"skill": action, "params": intent.get("parameters", {})},
            ]

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def _execute_plan(self, plan: list[dict], intent: dict):
        """Run *plan* on the behavior-tree executor.

        Returns the ``ExecutePlan`` result, or None if the executor could not
        be reached, rejected the plan, or did not finish in time.
        """
        if not self._plan_client.wait_for_server(timeout_sec=5.0):
            self.get_logger().error("[Orchestrator] /nora/execute_plan is not available.")
            return None
        goal = ExecutePlan.Goal()
        for step in plan:
            call = SkillCall()
            call.skill_name = step["skill"]
            call.intent_id = intent.get("command_id", "")
            call.params_json = json.dumps(step.get("params", {}))
            call.timestamp = self.get_clock().now().to_msg()
            goal.plan.append(call)
        self.get_logger().info(
            f"[Orchestrator] Executing plan: {[step['skill'] for step in plan]}"
        )

        handle = self._wait(self._plan_client.send_goal_async(goal), 5.0)
        if handle is None or not handle.accepted:
            return None
        wrapped = self._wait(handle.get_result_async(), self._plan_timeout)
        if wrapped is None:
            handle.cancel_goal_async()
            return None
        return wrapped.result

    # ------------------------------------------------------------------
    # Replanning
    # ------------------------------------------------------------------

    def _handle_skill_failure(
        self,
        plan: list[dict],
        failure: dict,
        world: list[dict],
        last_failure: Optional[dict],
    ) -> Optional[list[dict]]:
        """Turn an execution failure into a revised plan.

        Parameters
        ----------
        plan:
            The plan that failed.
        failure:
            The executor's report: ``index``, ``skill``, ``code``, ``reason``,
            ``recoverable``.
        world:
            World-model objects at the time of the failure.
        last_failure:
            The previous failure of this task, if any.

        Returns
        -------
        The revised plan, or None when the task must stop: the failure is
        critical, the replanning budget is spent, or a precondition failed
        twice in the same way (replanning made no progress).
        """
        self._sm.transition(OrchestratorState.RECOVERING)
        self.get_logger().warn(
            f"[Orchestrator] Step {failure['index']} ('{failure['skill']}') failed: "
            f"{failure['code']}: {failure['reason']}"
        )

        if not failure["recoverable"]:
            self.get_logger().error("[Orchestrator] Critical failure: safe stop, no replanning.")
            return None
        if self._replanning_attempts >= self._max_replanning:
            self.get_logger().error("[Orchestrator] Max replanning attempts reached. Giving up.")
            return None
        if (
            failure["code"] == "PRECONDITION"
            and last_failure is not None
            and (last_failure["code"], last_failure["reason"])
            == (failure["code"], failure["reason"])
        ):
            self.get_logger().error("[Orchestrator] Same precondition failed again. Giving up.")
            return None
        self._replanning_attempts += 1

        # A failed grasp on an object the camera no longer sees: stop trusting
        # the remembered pose until perception finds the object again.
        if failure["skill"] == "pick" and failure["code"] in ("SKILL_ABORTED", "TIMEOUT"):
            target = plan[failure["index"]].get("params", {}).get("target_object")
            obj = find_object(world, target)
            if obj is not None and not obj["visible"] and self._update_client.service_is_ready():
                self._update_client.call_async(
                    UpdateWorld.Request(object_id=obj["id"], state="missing")
                )

        new_plan = replan(plan, failure, world)
        if new_plan is not None:
            self.get_logger().info(
                f"[Orchestrator] Replan {self._replanning_attempts}/{self._max_replanning}: "
                f"{[step['skill'] for step in new_plan]}"
            )
        return new_plan

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
