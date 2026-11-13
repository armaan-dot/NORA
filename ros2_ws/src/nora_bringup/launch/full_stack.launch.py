"""
full_stack.launch.py — End-to-end full stack bringup for NORA.

Launches:
  1. Gazebo simulation + controllers + Foxglove bridge (sim_gazebo.launch.py)
  2. MoveIt 2 move_group planning pipeline
  3. NLU node (ParseCommand srv)
  4. Affordance node (ScoreAffordances srv)
  5. Orchestrator node (ExecuteIntent action server & FSM)

Usage:
  ros2 launch nora_bringup full_stack.launch.py
  ros2 launch nora_bringup full_stack.launch.py foxglove:=true port:=8765
"""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description() -> LaunchDescription:
    pkg_bringup = get_package_share_directory("nora_bringup")
    pkg_moveit = get_package_share_directory("nora_moveit_config")

    use_sim_time_arg = DeclareLaunchArgument(
        "use_sim_time",
        default_value="true",
        description="Use simulation clock",
    )
    use_sim_time = LaunchConfiguration("use_sim_time")

    foxglove_arg = DeclareLaunchArgument(
        "foxglove",
        default_value="true",
        description="Enable Foxglove Studio WebSocket bridge",
    )
    foxglove = LaunchConfiguration("foxglove")

    port_arg = DeclareLaunchArgument(
        "port",
        default_value="8765",
        description="Foxglove WebSocket port",
    )
    port = LaunchConfiguration("port")

    # 1. Sim + Controllers + Foxglove
    sim_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(pkg_bringup, "launch", "sim_gazebo.launch.py")
        ),
        launch_arguments={
            "use_sim_time": use_sim_time,
            "foxglove": foxglove,
            "port": port,
        }.items(),
    )

    # 2. MoveIt 2 move_group
    moveit_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(pkg_moveit, "launch", "move_group.launch.py")
        ),
        launch_arguments={"use_sim_time": use_sim_time}.items(),
    )

    # 3. NLU Node
    nlu_node = Node(
        package="nora_nlu_node",
        executable="nlu_node",
        name="nora_nlu_node",
        output="screen",
        parameters=[{"use_sim_time": use_sim_time}],
    )

    # 4. Affordance Scorer Node
    affordance_node = Node(
        package="nora_affordance",
        executable="affordance_node",
        name="nora_affordance_node",
        output="screen",
        parameters=[{"use_sim_time": use_sim_time}],
    )

    # 5. Orchestrator Node
    orchestrator_node = Node(
        package="nora_orchestrator",
        executable="orchestrator_node",
        name="nora_orchestrator",
        output="screen",
        parameters=[{"use_sim_time": use_sim_time}],
    )

    return LaunchDescription(
        [
            use_sim_time_arg,
            foxglove_arg,
            port_arg,
            sim_launch,
            moveit_launch,
            nlu_node,
            affordance_node,
            orchestrator_node,
        ]
    )

