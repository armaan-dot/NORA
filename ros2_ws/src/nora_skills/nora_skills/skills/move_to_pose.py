"""nora_skills.skills.move_to_pose
==================================
Skill: **MoveToPose** — move the arm to a named or explicit target pose.

Mock behaviour: sleeps 0.5 s, always returns success.
"""

from __future__ import annotations

import asyncio

import rclpy
from rclpy.node import Node

from nora_skills.base_skill import BaseSkillServer

# TODO(nora): replace placeholder import with the real action type once
#             nora_interfaces/action/MoveToPose.action is defined.
try:
    from nora_interfaces.action import MoveToPose as MoveToPoseAction
except ImportError:  # pragma: no cover — tolerated during scaffolding
    MoveToPoseAction = None  # type: ignore[assignment,misc]

_ACTION_NAME = "/nora/skills/move_to_pose"
_MOCK_DELAY_S = 0.5


class MoveToPoseSkill(BaseSkillServer):
    """Action server that moves the arm to a target pose.

    Parameters
    ----------
    None — all configuration via ROS 2 parameters (future).
    """

    def __init__(self) -> None:
        super().__init__(
            node_name="nora_move_to_pose_skill",
            skill_name="move_to_pose",
            action_type=MoveToPoseAction,
            action_server_name=_ACTION_NAME,
        )

    # ------------------------------------------------------------------
    # Skill implementation
    # ------------------------------------------------------------------

    async def _execute(self, goal_handle):
        """Execute the move_to_pose skill.

        Stub logic
        ----------
        1. Parse the target pose from *goal_handle.request*.
        2. Call MoveIt 2 to plan and execute the trajectory.
        3. Return success/failure with a message.

        Current implementation is a **mock**: sleeps 0.5 s then succeeds.
        """
        goal = goal_handle.request

        # TODO(nora): extract pose_name / geometry_msgs/Pose from `goal`.
        self.log_info(f"Goal received: {goal}")

        # TODO(nora): call MoveIt2 to plan motion to target pose.
        #   Example (pseudo):
        #     move_group = MoveGroupInterface(self, 'arm')
        #     move_group.set_pose_target(goal.target_pose)
        #     plan_result = move_group.plan()
        #     if plan_result.error_code.val != MoveItErrorCodes.SUCCESS:
        #         goal_handle.abort()
        #         return result_msg(success=False, message="Planning failed")
        #     move_group.execute(plan_result.trajectory, wait=True)

        # --- MOCK ---
        self.log_info("MOCK: simulating move_to_pose execution…")
        await asyncio.sleep(_MOCK_DELAY_S)

        goal_handle.succeed()

        result = MoveToPoseAction.Result()
        result.success = True
        result.message = "MOCK: move_to_pose succeeded"
        self.log_info(result.message)
        return result


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(args=None):
    """Spin the MoveToPoseSkill node."""
    rclpy.init(args=args)
    node = MoveToPoseSkill()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
