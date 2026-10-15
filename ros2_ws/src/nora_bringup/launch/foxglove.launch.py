"""
foxglove.launch.py — Top-level launch file for Foxglove Studio integration in NORA.

Starts:
  1. NORA arm robot description & robot_state_publisher.
  2. joint_state_publisher_gui (or headless joint_state_publisher).
  3. foxglove_bridge WebSocket server (default port: 8765).
  4. Optional RViz2 instance.

Usage:
  ros2 launch nora_bringup foxglove.launch.py
  ros2 launch nora_bringup foxglove.launch.py port:=8765 gui:=true
"""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.conditions import IfCondition, UnlessCondition
from launch.substitutions import Command, LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description() -> LaunchDescription:
    pkg_desc = get_package_share_directory("nora_description")

    # ------------------------------------------------------------------
    # Launch arguments
    # ------------------------------------------------------------------
    port_arg = DeclareLaunchArgument(
        "port",
        default_value="8765",
        description="WebSocket port for Foxglove Studio bridge",
    )
    port = LaunchConfiguration("port")

    address_arg = DeclareLaunchArgument(
        "address",
        default_value="0.0.0.0",
        description="IP address to bind Foxglove WebSocket server",
    )
    address = LaunchConfiguration("address")

    send_buffer_limit_arg = DeclareLaunchArgument(
        "send_buffer_limit",
        default_value="10000000",
        description="Send buffer limit for Foxglove WebSocket in bytes",
    )
    send_buffer_limit = LaunchConfiguration("send_buffer_limit")

    use_sim_time_arg = DeclareLaunchArgument(
        "use_sim_time",
        default_value="false",
        description="Use simulation clock if true",
    )
    use_sim_time = LaunchConfiguration("use_sim_time")

    gui_arg = DeclareLaunchArgument(
        "gui",
        default_value="true",
        description="Launch joint_state_publisher_gui sliders if true",
    )
    gui = LaunchConfiguration("gui")

    rviz_arg = DeclareLaunchArgument(
        "rviz",
        default_value="false",
        description="Launch RViz2 alongside Foxglove Studio if true",
    )
    rviz = LaunchConfiguration("rviz")

    # ------------------------------------------------------------------
    # Robot description via xacro
    # ------------------------------------------------------------------
    xacro_file = os.path.join(pkg_desc, "urdf", "nora_arm.urdf.xacro")
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
        condition=IfCondition(gui),
    )

    joint_state_publisher_node = Node(
        package="joint_state_publisher",
        executable="joint_state_publisher",
        name="joint_state_publisher",
        output="screen",
        parameters=[{"use_sim_time": use_sim_time}],
        condition=UnlessCondition(gui),
    )

    foxglove_bridge_node = Node(
        package="foxglove_bridge",
        executable="foxglove_bridge",
        name="foxglove_bridge",
        output="screen",
        parameters=[
            {
                "port": port,
                "address": address,
                "send_buffer_limit": send_buffer_limit,
                "use_sim_time": use_sim_time,
                "capabilities": [
                    "clientPublish",
                    "parameters",
                    "parametersSubscribe",
                    "services",
                    "connectionGraph",
                    "assets",
                ],
            }
        ],
    )

    rviz_config = os.path.join(pkg_desc, "rviz", "nora_arm.rviz")
    rviz2_node = Node(
        package="rviz2",
        executable="rviz2",
        name="rviz2",
        output="screen",
        arguments=["-d", rviz_config],
        parameters=[{"use_sim_time": use_sim_time}],
        condition=IfCondition(rviz),
    )

    return LaunchDescription(
        [
            port_arg,
            address_arg,
            send_buffer_limit_arg,
            use_sim_time_arg,
            gui_arg,
            rviz_arg,
            robot_state_publisher_node,
            joint_state_publisher_gui_node,
            joint_state_publisher_node,
            foxglove_bridge_node,
            rviz2_node,
        ]
    )

