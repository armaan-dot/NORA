"""
launch/controllers.launch.py
─────────────────────────────
Starts the controller_manager and spawns:
  1. joint_state_broadcaster  — publishes /joint_states
  2. arm_controller           — JointTrajectoryController for joints 1-6

Usage
-----
  ros2 launch nora_control controllers.launch.py

The hardware interface (real or simulated) must already be running and
publishing /robot_description before this launch file is called.
"""

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, TimerAction
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description() -> LaunchDescription:
    pkg = "nora_control"
    pkg_share = get_package_share_directory(pkg)
    controllers_yaml = pkg_share + "/config/ros2_controllers.yaml"

    # ── Launch arguments ───────────────────────────────────────────────────────
    use_sim_time_arg = DeclareLaunchArgument(
        "use_sim_time",
        default_value="false",
        description="Use simulation clock",
    )
    use_sim_time = LaunchConfiguration("use_sim_time")

    # ── controller_manager ─────────────────────────────────────────────────────
    # TODO(nora): If not using a combined launch with a hardware interface node,
    #             ensure controller_manager is started by the robot bringup launch.
    controller_manager_node = Node(
        package="controller_manager",
        executable="ros2_control_node",
        parameters=[controllers_yaml, {"use_sim_time": use_sim_time}],
        output="screen",
    )

    # ── Spawners (delayed to allow controller_manager to initialise) ───────────
    spawn_jsb = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["joint_state_broadcaster", "--controller-manager", "/controller_manager"],
        output="screen",
    )

    # arm_controller spawned after joint_state_broadcaster is active
    spawn_arm = TimerAction(
        period=2.0,
        actions=[
            Node(
                package="controller_manager",
                executable="spawner",
                arguments=["arm_controller", "--controller-manager", "/controller_manager"],
                output="screen",
            )
        ],
    )

    # TODO(nora): Add gripper_controller spawner once gripper hardware is ready.

    return LaunchDescription(
        [
            use_sim_time_arg,
            controller_manager_node,
            spawn_jsb,
            spawn_arm,
        ]
    )
