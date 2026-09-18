"""
display.launch.py — Launch the NORA arm in RViz2 for visual inspection.

Starts:
  1. xacro → robot_description param
  2. robot_state_publisher
  3. joint_state_publisher_gui  (interactive sliders)
  4. RViz2 with nora_arm.rviz config
"""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import Command, LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description() -> LaunchDescription:
    pkg_share = get_package_share_directory("nora_description")

    # ------------------------------------------------------------------
    # Launch arguments
    # ------------------------------------------------------------------
    use_sim_time_arg = DeclareLaunchArgument(
        "use_sim_time",
        default_value="false",
        description="Use simulation (Gazebo) clock",
    )
    use_sim_time = LaunchConfiguration("use_sim_time")

    # ------------------------------------------------------------------
    # Robot description via xacro
    # ------------------------------------------------------------------
    xacro_file = os.path.join(pkg_share, "urdf", "nora_arm.urdf.xacro")
    robot_description = {"robot_description": Command(["xacro ", xacro_file])}

    # ------------------------------------------------------------------
    # Nodes
    # ------------------------------------------------------------------
    robot_state_publisher_node = Node(
        package="robot_state_publisher",
        executable="robot_state_publisher",
        name="robot_state_publisher",
        output="screen",
        parameters=[robot_description, {"use_sim_time": use_sim_time}],
    )

    joint_state_publisher_gui_node = Node(
        package="joint_state_publisher_gui",
        executable="joint_state_publisher_gui",
        name="joint_state_publisher_gui",
        output="screen",
        parameters=[{"use_sim_time": use_sim_time}],
    )

    rviz_config = os.path.join(pkg_share, "rviz", "nora_arm.rviz")
    rviz2_node = Node(
        package="rviz2",
        executable="rviz2",
        name="rviz2",
        output="screen",
        arguments=["-d", rviz_config],
        parameters=[{"use_sim_time": use_sim_time}],
    )

    return LaunchDescription(
        [
            use_sim_time_arg,
            robot_state_publisher_node,
            joint_state_publisher_gui_node,
            rviz2_node,
        ]
    )
