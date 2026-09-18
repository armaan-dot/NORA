"""nora_skills.base_skill
========================
Abstract base class for all NORA primitive skill action servers.

Every concrete skill inherits from :class:`BaseSkillServer` and only needs
to override :meth:`_execute`.  The base class handles:

- Creating the ROS 2 action server.
- Routing ``execute_callback`` through the template-method pattern.
- Structured logging helpers (``log_info``, ``log_warn``, ``log_error``).
"""

from __future__ import annotations

import traceback
from abc import ABC, abstractmethod
from typing import Any

import rclpy
from rclpy.action import ActionServer, GoalResponse, CancelResponse
from rclpy.node import Node
from rclpy.callback_groups import ReentrantCallbackGroup


class BaseSkillServer(Node, ABC):
    """Template-method base for NORA skill action servers.

    Parameters
    ----------
    node_name:
        ROS 2 node name (e.g. ``'nora_pick_skill'``).
    skill_name:
        Human-readable skill label used in log messages.
    action_type:
        The ROS 2 action type class (e.g. ``nora_interfaces.action.Pick``).
    action_server_name:
        Full action server topic name (e.g. ``'/nora/skills/pick'``).
    """

    def __init__(
        self,
        node_name: str,
        skill_name: str,
        action_type: Any,
        action_server_name: str,
    ) -> None:
        super().__init__(node_name)
        self._skill_name = skill_name
        self._cb_group = ReentrantCallbackGroup()

        self._action_server = ActionServer(
            self,
            action_type,
            action_server_name,
            execute_callback=self.execute_callback,
            goal_callback=self._goal_callback,
            cancel_callback=self._cancel_callback,
            callback_group=self._cb_group,
        )
        self.log_info(f"Skill server ready on '{action_server_name}'")

    # ------------------------------------------------------------------
    # Public template method
    # ------------------------------------------------------------------

    async def execute_callback(self, goal_handle: Any) -> Any:
        """Called by the action server when a goal is accepted.

        Delegates to :meth:`_execute` and catches any unexpected exceptions
        so the goal is always concluded gracefully.
        """
        self.log_info(f"Executing skill '{self._skill_name}'")
        try:
            result = await self._execute(goal_handle)
            return result
        except Exception:  # noqa: BLE001
            self.log_error(
                f"Unhandled exception in skill '{self._skill_name}':\n"
                + traceback.format_exc()
            )
            goal_handle.abort()
            # Return a default-constructed result to avoid hang.
            return goal_handle.get_goal()  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # Abstract hook — concrete skills implement this
    # ------------------------------------------------------------------

    @abstractmethod
    async def _execute(self, goal_handle: Any) -> Any:
        """Implement skill logic here.

        Parameters
        ----------
        goal_handle:
            The rclpy action ``ServerGoalHandle``.  Call
            ``goal_handle.succeed()``, ``goal_handle.abort()``, or
            ``goal_handle.canceled()`` before returning the result.

        Returns
        -------
        The action result message.
        """

    # ------------------------------------------------------------------
    # Goal / cancel callbacks (override in subclass if needed)
    # ------------------------------------------------------------------

    def _goal_callback(self, goal_request: Any) -> GoalResponse:  # noqa: ARG002
        """Accept all incoming goals by default."""
        self.log_info(f"Received goal for skill '{self._skill_name}'")
        return GoalResponse.ACCEPT

    def _cancel_callback(self, goal_handle: Any) -> CancelResponse:  # noqa: ARG002
        """Accept cancel requests by default."""
        self.log_warn(f"Cancel requested for skill '{self._skill_name}'")
        return CancelResponse.ACCEPT

    # ------------------------------------------------------------------
    # Logging helpers
    # ------------------------------------------------------------------

    def log_info(self, msg: str) -> None:
        """Log at INFO level, prefixed with skill name."""
        self.get_logger().info(f"[{self._skill_name}] {msg}")

    def log_warn(self, msg: str) -> None:
        """Log at WARN level, prefixed with skill name."""
        self.get_logger().warn(f"[{self._skill_name}] {msg}")

    def log_error(self, msg: str) -> None:
        """Log at ERROR level, prefixed with skill name."""
        self.get_logger().error(f"[{self._skill_name}] {msg}")
