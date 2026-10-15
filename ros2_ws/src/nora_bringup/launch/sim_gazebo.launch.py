"""
sim_gazebo.launch.py — Top-level simulation bringup for NORA in Gazebo Classic.

Starts:
  1. Gazebo tabletop world + NORA arm URDF spawn + robot_state_publisher.
  2. ros2_control controller_manager + joint_state_broadcaster + arm_controller.
  3. Optional foxglove_bridge (default: true) for Foxglove Studio live visualization.

Usage:
  ros2 launch nora_bringup sim_gazebo.launch.py
  ros2 launch nora_bringup sim_gazebo.launch.py foxglove:=true port:=8765
"""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.conditions import IfCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description() -> LaunchDescription:
    pkg_gazebo = get_package_share_directory("nora_gazebo")
    pkg_control = get_package_share_directory("nora_control")

    # ------------------------------------------------------------------
    # Launch arguments
    # ------------------------------------------------------------------
    use_sim_time_arg = DeclareLaunchArgument(
        "use_sim_time",
        default_value="true",
        description="Use Gazebo simulation clock",
    )
    use_sim_time = LaunchConfiguration("use_sim_time")

    foxglove_arg = DeclareLaunchArgument(
        "foxglove",
        default_value="true",
        description="Launch Foxglove Studio WebSocket bridge",
    )
    foxglove = LaunchConfiguration("foxglove")

    port_arg = DeclareLaunchArgument(
        "port",
        default_value="8765",
        description="Foxglove WebSocket port",
    )
    port = LaunchConfiguration("port")

    # ------------------------------------------------------------------
    # Include Gazebo simulation
    # ------------------------------------------------------------------
    gazebo_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(pkg_gazebo, "launch", "gazebo.launch.py")
        ),
        launch_arguments={"use_sim_time": use_sim_time}.items(),
    )

    # ------------------------------------------------------------------
    # Include ros2_control controllers
    # ------------------------------------------------------------------
    controllers_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(pkg_control, "launch", "controllers.launch.py")
        ),
        launch_arguments={"use_sim_time": use_sim_time}.items(),
    )

    # ------------------------------------------------------------------
    # Foxglove WebSocket Bridge
    # ------------------------------------------------------------------
    foxglove_bridge_node = Node(
        package="foxglove_bridge",
        executable="foxglove_bridge",
        name="foxglove_bridge",
        output="screen",
        parameters=[
            {
                "port": port,
                "address": "0.0.0.0",
                "use_sim_time": use_sim_time,
                "send_buffer_limit": 10000000,
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
        condition=IfCondition(foxglove),
    )

    return LaunchDescription(
        [
            use_sim_time_arg,
            foxglove_arg,
            port_arg,
            gazebo_launch,
            controllers_launch,
            foxglove_bridge_node,
        ]
    )

