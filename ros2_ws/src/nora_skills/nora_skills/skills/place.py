"""nora_skills.skills.place
===========================
Skill: **Place** — place the currently held object at a target location.

Mock behaviour: sleeps 0.5 s, always returns success.
"""

from __future__ import annotations

import asyncio

import rclpy

from nora_skills.base_skill import BaseSkillServer

# TODO(nora): replace with real action type once nora_interfaces is defined.
try:
    from nora_interfaces.action import Place as PlaceAction
except ImportError:
    PlaceAction = None  # type: ignore[assignment,misc]

_ACTION_NAME = "/nora/skills/place"
_MOCK_DELAY_S = 0.5


class PlaceSkill(BaseSkillServer):
    """Action server that places the held object at a target location.

    Goal fields (expected from nora_interfaces/action/Place.action):
        string target_location  -- named location (e.g. "table_top")

    Result fields:
        bool   success
        string message
    """

    def __init__(self) -> None:
        super().__init__(
            node_name="nora_place_skill",
            skill_name="place",
            action_type=PlaceAction,
            action_server_name=_ACTION_NAME,
        )

    async def _execute(self, goal_handle):
        """Execute the place skill.

        Stub logic
        ----------
        1. Resolve target_location to a 3-D pose via scene graph / TF.
        2. Move arm to place pose.
        3. Open gripper, retract.

        Current implementation is a **mock**: sleeps 0.5 s then succeeds.
        """
        goal = goal_handle.request

        # TODO(nora): resolve target_location to a geometry_msgs/Pose.
        # TODO(nora): call MoveIt2:
        #   1. move_to_place_pose()
        #   2. open_gripper()
        #   3. retract()
        self.log_info(
            f"Placing at location: '{getattr(goal, 'target_location', '<unknown>')}'"
        )

        # --- MOCK ---
        self.log_info("MOCK: simulating place execution…")
        await asyncio.sleep(_MOCK_DELAY_S)

        goal_handle.succeed()

        result = PlaceAction.Result()
        result.success = True
        result.message = "MOCK: place succeeded"
        self.log_info(result.message)
        return result


def main(args=None):
    """Spin the PlaceSkill node."""
    rclpy.init(args=args)
    node = PlaceSkill()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
