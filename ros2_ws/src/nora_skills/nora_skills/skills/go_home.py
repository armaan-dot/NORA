"""nora_skills.skills.go_home
==============================
Skill: **GoHome** — return the arm to its home configuration (all joints → 0).

Mock behaviour: sleeps 0.5 s, always returns success.
"""

from __future__ import annotations

import asyncio

import rclpy

from nora_skills.base_skill import BaseSkillServer

# TODO(nora): replace with real action type once nora_interfaces is defined.
try:
    from nora_interfaces.action import GoHome as GoHomeAction
except ImportError:
    GoHomeAction = None  # type: ignore[assignment,misc]

_ACTION_NAME = "/nora/skills/go_home"
_MOCK_DELAY_S = 0.5

# Home configuration: all joints set to 0 rad.
_HOME_JOINT_VALUES: list[float] = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]


class GoHomeSkill(BaseSkillServer):
    """Action server that returns the arm to the home position.

    The home position is defined as all joint values equal to 0.0 radians.
    This can be overridden by loading named joint targets from the MoveIt
    SRDF (e.g. the ``home`` state defined in the robot's SRDF).

    Goal fields (expected from nora_interfaces/action/GoHome.action):
        (empty goal — no parameters required)

    Result fields:
        bool   success
        string message
    """

    def __init__(self) -> None:
        super().__init__(
            node_name="nora_go_home_skill",
            skill_name="go_home",
            action_type=GoHomeAction,
            action_server_name=_ACTION_NAME,
        )

    async def _execute(self, goal_handle):
        """Execute the go_home skill.

        Stub logic
        ----------
        1. Set MoveIt 2 joint target to the 'home' named state (SRDF) or
           all-zeros joint configuration.
        2. Plan and execute the trajectory.
        3. Return success/failure.

        Current implementation is a **mock**: sleeps 0.5 s then succeeds.
        """
        # TODO(nora): use MoveIt2 named target:
        #   move_group = MoveGroupInterface(self, 'arm')
        #   move_group.set_named_target('home')          # from SRDF
        #   # OR: move_group.set_joint_value_target(_HOME_JOINT_VALUES)
        #   plan_result = move_group.plan()
        #   if plan_result.error_code.val != MoveItErrorCodes.SUCCESS:
        #       goal_handle.abort()
        #       return result(success=False, message="Planning failed")
        #   move_group.execute(plan_result.trajectory, wait=True)

        self.log_info(
            f"Moving to home: joint targets = {_HOME_JOINT_VALUES}"
        )

        # --- MOCK ---
        self.log_info("MOCK: simulating go_home…")
        await asyncio.sleep(_MOCK_DELAY_S)

        goal_handle.succeed()

        result = GoHomeAction.Result()
        result.success = True
        result.message = "MOCK: go_home succeeded (all joints → 0)"
        self.log_info(result.message)
        return result


def main(args=None):
    """Spin the GoHomeSkill node."""
    rclpy.init(args=args)
    node = GoHomeSkill()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
