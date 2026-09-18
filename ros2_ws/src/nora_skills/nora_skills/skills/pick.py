"""nora_skills.skills.pick
==========================
Skill: **Pick** — plan and execute a grasp on a target object.

Mock behaviour: sleeps 0.5 s, always returns success.
"""

from __future__ import annotations

import asyncio

import rclpy

from nora_skills.base_skill import BaseSkillServer

# TODO(nora): replace with real action type once nora_interfaces is defined.
try:
    from nora_interfaces.action import Pick as PickAction
except ImportError:
    PickAction = None  # type: ignore[assignment,misc]

_ACTION_NAME = "/nora/skills/pick"
_MOCK_DELAY_S = 0.5


class PickSkill(BaseSkillServer):
    """Action server that picks a target object.

    Goal fields (expected from nora_interfaces/action/Pick.action):
        string target_object   -- object label from perception
        geometry_msgs/Pose grasp_pose  -- optional override grasp pose

    Result fields:
        bool   success
        string message
    """

    def __init__(self) -> None:
        super().__init__(
            node_name="nora_pick_skill",
            skill_name="pick",
            action_type=PickAction,
            action_server_name=_ACTION_NAME,
        )

    async def _execute(self, goal_handle):
        """Execute the pick skill.

        Stub logic
        ----------
        1. Query perception for target object pose.
        2. Compute grasp pose (or use override from goal).
        3. Move to pre-grasp, close gripper, lift.

        Current implementation is a **mock**: sleeps 0.5 s then succeeds.
        """
        goal = goal_handle.request

        # TODO(nora): query PerceptionNode service to get object pose.
        # TODO(nora): compute grasp pose using grasp planner.
        # TODO(nora): call MoveIt2:
        #   1. move_to_pregrasp()
        #   2. close_gripper()
        #   3. lift()
        self.log_info(f"Picking object: '{getattr(goal, 'target_object', '<unknown>')}'")

        # --- MOCK ---
        self.log_info("MOCK: simulating pick execution…")
        await asyncio.sleep(_MOCK_DELAY_S)

        goal_handle.succeed()

        result = PickAction.Result()
        result.success = True
        result.message = "MOCK: pick succeeded"
        self.log_info(result.message)
        return result


def main(args=None):
    """Spin the PickSkill node."""
    rclpy.init(args=args)
    node = PickSkill()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
