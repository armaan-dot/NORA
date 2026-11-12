"""
launch/move_group.launch.py
────────────────────────────
Launches the MoveIt 2 move_group node with all NORA arm configurations.

Usage
-----
  ros2 launch nora_moveit_config move_group.launch.py

Optional arguments
------------------
  use_sim_time            true/false (default: false).
"""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from moveit_configs_utils import MoveItConfigsBuilder


def generate_launch_description() -> LaunchDescription:
    # ── Launch arguments ───────────────────────────────────────────────────────
    use_sim_time_arg = DeclareLaunchArgument(
        "use_sim_time",
        default_value="false",
        description="Use simulation (Gazebo) clock if true",
    )
    use_sim_time = LaunchConfiguration("use_sim_time")

    # ── Configuration: URDF from nora_description, the rest from config/ ───────
    xacro_file = os.path.join(
        get_package_share_directory("nora_description"), "urdf", "nora_arm.urdf.xacro"
    )
    moveit_config = (
        MoveItConfigsBuilder("nora_arm", package_name="nora_moveit_config")
        .robot_description(file_path=xacro_file)
        .robot_description_semantic(file_path="config/nora_arm.srdf")
        .robot_description_kinematics(file_path="config/kinematics.yaml")
        .joint_limits(file_path="config/joint_limits.yaml")
        .planning_pipelines(pipelines=["ompl"])
        .trajectory_execution(file_path="config/moveit_controllers.yaml")
        .to_moveit_configs()
    )

    # ── move_group node ────────────────────────────────────────────────────────
    move_group_node = Node(
        package="moveit_ros_move_group",
        executable="move_group",
        output="screen",
        parameters=[
            moveit_config.to_dict(),
            {"use_sim_time": use_sim_time},
            # Capabilities
            {
                "capabilities": (
                    "move_group/MoveGroupCartesianPathService "
                    "move_group/MoveGroupExecuteTrajectoryAction "
                    "move_group/MoveGroupGetPlanningSceneService "
                    "move_group/MoveGroupKinematicsService "
                    "move_group/MoveGroupMoveAction "
                    "move_group/MoveGroupPlanService "
                    "move_group/MoveGroupQueryPlannersService "
                    "move_group/MoveGroupStateValidationService"
                )
            },
        ],
    )

    # ── RViz (optional — comment out if running headless) ─────────────────────
    # TODO(nora): Add RViz config once nora_moveit_config/rviz/nora.rviz exists.
    # rviz_node = Node(package="rviz2", executable="rviz2", ...)

    return LaunchDescription(
        [
            use_sim_time_arg,
            move_group_node,
        ]
    )
