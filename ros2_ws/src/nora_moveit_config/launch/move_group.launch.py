"""
launch/move_group.launch.py
────────────────────────────
Launches the MoveIt 2 move_group node with all NORA arm configurations.

Usage
-----
  ros2 launch nora_moveit_config move_group.launch.py

Optional arguments
------------------
  robot_description_file  Path to the URDF/xacro file (default: nora_arm.urdf.xacro).
  use_sim_time            true/false (default: false).
"""

from pathlib import Path

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
import yaml


def load_yaml(package_name: str, relative_path: str) -> dict:
    """Helper: load a YAML file from a package's share directory."""
    pkg_share = get_package_share_directory(package_name)
    abs_path = Path(pkg_share) / relative_path
    with open(abs_path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def generate_launch_description() -> LaunchDescription:
    pkg = "nora_moveit_config"

    # ── Launch arguments ───────────────────────────────────────────────────────
    use_sim_time_arg = DeclareLaunchArgument(
        "use_sim_time",
        default_value="false",
        description="Use simulation (Gazebo) clock if true",
    )
    use_sim_time = LaunchConfiguration("use_sim_time")

    # ── Load configuration files ───────────────────────────────────────────────
    # TODO(nora): Load robot_description from nora_description package or
    #             accept it as a launch argument once the URDF is finalised.
    robot_description = {"robot_description": ""}  # placeholder

    robot_description_semantic = {
        "robot_description_semantic": open(
            Path(get_package_share_directory(pkg)) / "config" / "nora_arm.srdf",
            encoding="utf-8",
        ).read()
    }

    kinematics_yaml = load_yaml(pkg, "config/kinematics.yaml")
    ompl_planning_yaml = load_yaml(pkg, "config/ompl_planning.yaml")
    moveit_controllers_yaml = load_yaml(pkg, "config/moveit_controllers.yaml")
    joint_limits_yaml = load_yaml(pkg, "config/joint_limits.yaml")

    # ── move_group node ────────────────────────────────────────────────────────
    move_group_node = Node(
        package="moveit_ros_move_group",
        executable="move_group",
        output="screen",
        parameters=[
            robot_description,
            robot_description_semantic,
            kinematics_yaml,
            ompl_planning_yaml,
            moveit_controllers_yaml,
            joint_limits_yaml,
            {"use_sim_time": use_sim_time},
            # Capabilities
            {
                "move_group/enable_capabilities": (
                    "move_group/MoveGroupCartesianPathService,"
                    "move_group/MoveGroupExecuteTrajectoryAction,"
                    "move_group/MoveGroupGetPlanningSceneService,"
                    "move_group/MoveGroupKinematicsService,"
                    "move_group/MoveGroupMoveAction,"
                    "move_group/MoveGroupPlanService,"
                    "move_group/MoveGroupQueryPlannersService,"
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
