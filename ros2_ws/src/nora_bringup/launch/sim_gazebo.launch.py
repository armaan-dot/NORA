"""
sim_gazebo.launch.py: the NORA arm simulated in Gazebo Classic, driven only by ROS 2, viewed in Foxglove.

Starts:
  1. Gazebo (physics) with the tabletop world, and the arm spawned from the URDF.
  2. ros2_control inside Gazebo: joint_state_broadcaster, arm_controller (FollowJointTrajectory),
     gripper_controller (GripperCommand).
  3. MoveIt move_group (OMPL + Cartesian paths), which sends trajectories to arm_controller.
  4. nora_perception: finds the objects on the table from the overhead RGB-D camera of the world.
  5. arm_commander: takes /nora/command (English), moves the arm, publishes markers for Foxglove.
  6. NLU node (English -> intent) and foxglove_bridge (port 8765).

  ros2 launch nora_bringup sim_gazebo.launch.py
  ros2 launch nora_bringup sim_gazebo.launch.py gui:=true          # also open the Gazebo window
  ros2 launch nora_bringup sim_gazebo.launch.py perception:=ground_truth   # object poses from Gazebo, not the camera (test only)
  ros2 launch nora_bringup sim_gazebo.launch.py scene:=/path/to/scene.json

For a real arm: replace the hardware plugin in nora_description/urdf/ros2_control.xacro with the arm's
ros2_control driver and start ros2_control_node instead of Gazebo. Controllers, MoveIt and the commander stay.
"""

import os
import re

import xacro
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import AppendEnvironmentVariable, DeclareLaunchArgument, IncludeLaunchDescription, RegisterEventHandler
from launch.conditions import IfCondition, LaunchConfigurationEquals
from launch.event_handlers import OnProcessExit
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

ARM_JOINTS = ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6"]


def generate_launch_description() -> LaunchDescription:
    bringup = get_package_share_directory("nora_bringup")
    description_pkg = get_package_share_directory("nora_description")
    gazebo_pkg = get_package_share_directory("nora_gazebo")
    moveit_pkg = get_package_share_directory("nora_moveit_config")

    urdf = xacro.process_file(os.path.join(description_pkg, "urdf", "nora_arm.urdf.xacro"), mappings={"use_gazebo": "true"}).toxml()
    # gazebo_ros2_control on Humble passes the URDF as a command-line parameter; XML comments can break that.
    urdf = re.sub(r"<!--.*?-->", "", urdf, flags=re.DOTALL)
    description = {"robot_description": urdf}
    with open(os.path.join(moveit_pkg, "config", "nora_arm.srdf"), encoding="utf-8") as f:
        semantic = {"robot_description_semantic": f.read()}
    sim_time = {"use_sim_time": True}

    moveit = {
        "robot_description_kinematics": {
            "arm": {
                "kinematics_solver": "kdl_kinematics_plugin/KDLKinematicsPlugin",
                "kinematics_solver_search_resolution": 0.005,
                "kinematics_solver_timeout": 0.05,
            }
        },
        # Deliberately slow: these limits set the speed of every planned motion.
        "robot_description_planning": {
            "joint_limits": {
                j: {"has_velocity_limits": True, "max_velocity": 1.0, "has_acceleration_limits": True, "max_acceleration": 2.0}
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
        # MoveIt executes plans by calling the ros2_control trajectory controller.
        "moveit_controller_manager": "moveit_simple_controller_manager/MoveItSimpleControllerManager",
        "moveit_simple_controller_manager": {
            "controller_names": ["arm_controller"],
            "arm_controller": {
                "type": "FollowJointTrajectory",
                "action_ns": "follow_joint_trajectory",
                "default": True,
                "joints": ARM_JOINTS,
            },
        },
        "moveit_manage_controllers": False,
        "trajectory_execution": {
            "allowed_execution_duration_scaling": 2.0,
            "allowed_goal_duration_margin": 2.0,
            "allowed_start_tolerance": 0.05,
        },
        "publish_planning_scene": True,
        "publish_geometry_updates": True,
        "publish_state_updates": True,
        "publish_transforms_updates": True,
    }

    gazebo = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(get_package_share_directory("gazebo_ros"), "launch", "gazebo.launch.py")
        ),
        launch_arguments={
            "world": os.path.join(gazebo_pkg, "worlds", "tabletop.world"),
            "gui": LaunchConfiguration("gui"),
        }.items(),
    )
    spawn_arm = Node(
        package="gazebo_ros",
        executable="spawn_entity.py",
        arguments=["-topic", "robot_description", "-entity", "nora_arm"],
        output="screen",
    )

    def spawner(controller):
        return Node(
            package="controller_manager",
            executable="spawner",
            arguments=[controller, "--controller-manager", "/controller_manager", "--controller-manager-timeout", "60"],
            output="screen",
        )

    def static_tf(parent, child, xyz, rpy):
        return Node(
            package="tf2_ros",
            executable="static_transform_publisher",
            arguments=["--x", xyz[0], "--y", xyz[1], "--z", xyz[2], "--roll", rpy[0], "--pitch", rpy[1], "--yaw", rpy[2],
                       "--frame-id", parent, "--child-frame-id", child],
            parameters=[sim_time],
        )

    joint_states = spawner("joint_state_broadcaster")
    # The controller manager lives inside Gazebo, so it only exists once the arm has been spawned.
    after_spawn = RegisterEventHandler(OnProcessExit(target_action=spawn_arm, on_exit=[joint_states]))
    after_joint_states = RegisterEventHandler(
        OnProcessExit(target_action=joint_states, on_exit=[spawner("arm_controller"), spawner("gripper_controller")])
    )

    return LaunchDescription(
        [
            DeclareLaunchArgument("gui", default_value="false", description="Open the Gazebo window"),
            DeclareLaunchArgument(
                "perception",
                default_value="camera",
                description="camera (YOLOX on the overhead camera, needs OpenGL), or ground_truth (test only: object poses from Gazebo)",
            ),
            DeclareLaunchArgument("nlu", default_value="true", description="Start the NLU node for English commands"),
            DeclareLaunchArgument(
                "nlu_model",
                default_value="",
                description="Path to ml/models/nora_nlu_model.json (found automatically with --symlink-install)",
            ),
            DeclareLaunchArgument("port", default_value="8765", description="Foxglove WebSocket port"),
            DeclareLaunchArgument(
                "scene",
                default_value=os.path.join(bringup, "config", "gazebo_scene.json"),
                description="Scene JSON: what the commander knows about each object class, and the named place locations",
            ),
            # tabletop.world includes the object models of nora_gazebo/models
            AppendEnvironmentVariable("GAZEBO_MODEL_PATH", os.path.join(gazebo_pkg, "models")),
            gazebo,
            # Pose of overhead_camera in tabletop.world (same values as nora_gazebo/launch/gazebo.launch.py)
            static_tf("world", "camera_link", ("0.981", "-0.05", "1.351"), ("0", "0.9599", "3.1416")),
            static_tf("camera_link", "camera_color_optical_frame", ("0", "0", "0"), ("-1.5708", "0", "-1.5708")),
            Node(
                package="robot_state_publisher",
                executable="robot_state_publisher",
                parameters=[description, sim_time],
                output="screen",
            ),
            spawn_arm,
            after_spawn,
            after_joint_states,
            Node(
                package="moveit_ros_move_group",
                executable="move_group",
                output="screen",
                parameters=[description, semantic, moveit, sim_time],
            ),
            Node(
                package="nora_bringup",
                executable="arm_commander.py",
                output="screen",
                parameters=[{"scene_file": LaunchConfiguration("scene")}, sim_time],
            ),
            Node(
                package="nora_perception",
                executable="nora_perception",
                output="screen",
                parameters=[os.path.join(get_package_share_directory("nora_perception"), "config", "perception.yaml"), sim_time],
                condition=LaunchConfigurationEquals("perception", "camera"),
            ),
            Node(
                package="nora_bringup",
                executable="ground_truth_perception.py",
                output="screen",
                parameters=[{"scene_file": LaunchConfiguration("scene")}, sim_time],
                condition=LaunchConfigurationEquals("perception", "ground_truth"),
            ),
            Node(
                package="nora_nlu_node",
                executable="nora_nlu_node",
                output="screen",
                parameters=[{"model_path": LaunchConfiguration("nlu_model")}, sim_time],
                condition=IfCondition(LaunchConfiguration("nlu")),
            ),
            Node(
                package="foxglove_bridge",
                executable="foxglove_bridge",
                output="screen",
                parameters=[{"port": LaunchConfiguration("port"), "address": "0.0.0.0"}, sim_time],
            ),
        ]
    )
