"""
sim_foxglove.launch.py: ROS 2 side of the NORA simulator for Foxglove.

Starts robot_state_publisher (the web simulator's URDF), rosbridge (port 9090, the simulator connects to it),
foxglove_bridge (port 8765, Foxglove connects to it), MoveIt move_group (OMPL RRTConnect) and the scene JSON loader.
The simulator itself (physics, camera, vision, NLU) is the frontend app, started separately.

  ros2 launch nora_bringup sim_foxglove.launch.py
  ros2 launch nora_bringup sim_foxglove.launch.py scene:=/path/to/my_scene.json
"""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

ARM_JOINTS = ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6"]


def generate_launch_description() -> LaunchDescription:
    share = get_package_share_directory("nora_bringup")
    with open(os.path.join(share, "urdf", "nora_arm.urdf"), encoding="utf-8") as f:
        description = {"robot_description": f.read()}
    with open(os.path.join(share, "config", "nora_web_arm.srdf"), encoding="utf-8") as f:
        semantic = {"robot_description_semantic": f.read()}

    moveit = {
        "robot_description_kinematics": {
            "arm": {
                "kinematics_solver": "kdl_kinematics_plugin/KDLKinematicsPlugin",
                "kinematics_solver_search_resolution": 0.005,
                "kinematics_solver_timeout": 0.05,
            }
        },
        "robot_description_planning": {
            "joint_limits": {
                j: {"has_velocity_limits": True, "max_velocity": 3.14, "has_acceleration_limits": True, "max_acceleration": 6.0}
                for j in ARM_JOINTS
            }
        },
        "planning_pipelines": ["ompl"],
        "default_planning_pipeline": "ompl",
        "ompl": {
            "planning_plugin": "ompl_interface/OMPLPlanner",
            "request_adapters": " ".join(
                "default_planner_request_adapters/" + a
                for a in [
                    "AddTimeOptimalParameterization",
                    "FixWorkspaceBounds",
                    "FixStartStateBounds",
                    "FixStartStateCollision",
                    "FixStartStatePathConstraints",
                ]
            ),
            "start_state_max_bounds_error": 0.1,
            "planner_configs": {"RRTConnect": {"type": "geometric::RRTConnect"}},
            "arm": {"planner_configs": ["RRTConnect"]},
        },
    }

    return LaunchDescription(
        [
            DeclareLaunchArgument(
                "scene",
                default_value=os.path.join(share, "config", "scene.json"),
                description="Scene JSON file (objects on the table)",
            ),
            Node(package="robot_state_publisher", executable="robot_state_publisher", parameters=[description]),
            Node(package="rosbridge_server", executable="rosbridge_websocket", parameters=[{"port": 9090}]),
            Node(package="foxglove_bridge", executable="foxglove_bridge", parameters=[{"port": 8765}]),
            Node(
                package="moveit_ros_move_group",
                executable="move_group",
                output="screen",
                parameters=[description, semantic, moveit],
            ),
            Node(
                package="nora_bringup",
                executable="scene_loader.py",
                output="screen",
                parameters=[{"scene_file": LaunchConfiguration("scene")}],
            ),
        ]
    )
