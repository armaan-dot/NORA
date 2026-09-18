"""nora_skills.skills.close_gripper
====================================
Skill: **CloseGripper** — fully close the end-effector gripper.

Mock behaviour: sleeps 0.5 s, always returns success.
"""

from __future__ import annotations

import asyncio

import rclpy

from nora_skills.base_skill import BaseSkillServer

# TODO(nora): replace with real action type once nora_interfaces is defined.
try:
    from nora_interfaces.action import CloseGripper as CloseGripperAction
except ImportError:
    CloseGripperAction = None  # type: ignore[assignment,misc]

_ACTION_NAME = "/nora/skills/close_gripper"
_MOCK_DELAY_S = 0.5


class CloseGripperSkill(BaseSkillServer):
    """Action server that closes the gripper.

    Goal fields (expected from nora_interfaces/action/CloseGripper.action):
        float32 force  -- grasping force in Newtons (0 = use default)

    Result fields:
        bool   success
        string message
        bool   object_grasped  -- True if tactile sensors detect an object
    """

    def __init__(self) -> None:
        super().__init__(
            node_name="nora_close_gripper_skill",
            skill_name="close_gripper",
            action_type=CloseGripperAction,
            action_server_name=_ACTION_NAME,
        )

    async def _execute(self, goal_handle):
        """Execute the close_gripper skill.

        Stub logic
        ----------
        1. Send position/force command to gripper controller.
        2. Wait for contact detection or position convergence.
        3. Report whether an object was grasped.

        Current implementation is a **mock**: sleeps 0.5 s then succeeds.
        """
        goal = goal_handle.request
        force = getattr(goal, "force", 0.0)

        # TODO(nora): publish gripper command to the gripper controller action.
        # TODO(nora): read tactile sensor topic and set object_grasped flag.
        self.log_info(f"Closing gripper with force={force:.1f} N")

        # --- MOCK ---
        self.log_info("MOCK: simulating close_gripper…")
        await asyncio.sleep(_MOCK_DELAY_S)

        goal_handle.succeed()

        result = CloseGripperAction.Result()
        result.success = True
        result.message = "MOCK: close_gripper succeeded"
        result.object_grasped = True  # optimistic mock
        self.log_info(result.message)
        return result


def main(args=None):
    """Spin the CloseGripperSkill node."""
    rclpy.init(args=args)
    node = CloseGripperSkill()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
