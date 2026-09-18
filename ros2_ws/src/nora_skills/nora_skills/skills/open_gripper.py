"""nora_skills.skills.open_gripper
===================================
Skill: **OpenGripper** — fully open the end-effector gripper.

Mock behaviour: sleeps 0.5 s, always returns success.
"""

from __future__ import annotations

import asyncio

import rclpy

from nora_skills.base_skill import BaseSkillServer

# TODO(nora): replace with real action type once nora_interfaces is defined.
try:
    from nora_interfaces.action import OpenGripper as OpenGripperAction
except ImportError:
    OpenGripperAction = None  # type: ignore[assignment,misc]

_ACTION_NAME = "/nora/skills/open_gripper"
_MOCK_DELAY_S = 0.5


class OpenGripperSkill(BaseSkillServer):
    """Action server that opens the gripper.

    Goal fields (expected from nora_interfaces/action/OpenGripper.action):
        float32 opening_width  -- 0.0–1.0 normalised (1.0 = fully open)

    Result fields:
        bool   success
        string message
    """

    def __init__(self) -> None:
        super().__init__(
            node_name="nora_open_gripper_skill",
            skill_name="open_gripper",
            action_type=OpenGripperAction,
            action_server_name=_ACTION_NAME,
        )

    async def _execute(self, goal_handle):
        """Execute the open_gripper skill.

        Stub logic
        ----------
        1. Send position command to gripper controller.
        2. Wait until gripper reaches target opening width.

        Current implementation is a **mock**: sleeps 0.5 s then succeeds.
        """
        goal = goal_handle.request
        width = getattr(goal, "opening_width", 1.0)

        # TODO(nora): publish gripper command to the gripper controller action.
        #   E.g. ros2 control / Franka gripper action.
        self.log_info(f"Opening gripper to width={width:.2f}")

        # --- MOCK ---
        self.log_info("MOCK: simulating open_gripper…")
        await asyncio.sleep(_MOCK_DELAY_S)

        goal_handle.succeed()

        result = OpenGripperAction.Result()
        result.success = True
        result.message = "MOCK: open_gripper succeeded"
        self.log_info(result.message)
        return result


def main(args=None):
    """Spin the OpenGripperSkill node."""
    rclpy.init(args=args)
    node = OpenGripperSkill()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
