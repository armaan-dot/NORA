"""
gazebo.launch.py — Launch Gazebo Classic with the NORA tabletop world
and spawn the NORA arm URDF.

Steps:
  1. Set GAZEBO_MODEL_PATH so Gazebo finds local models.
  2. Start gzserver + gzclient with tabletop.world.
  3. Load the NORA arm URDF via xacro.
  4. Start robot_state_publisher.
  5. Spawn the NORA arm into Gazebo using spawn_entity.py.
  6. Once spawned, start joint_state_broadcaster, arm_controller and
     gripper_controller (gazebo_ros2_control).
"""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import (
    AppendEnvironmentVariable,
    DeclareLaunchArgument,
    IncludeLaunchDescription,
    RegisterEventHandler,
)
from launch.event_handlers import OnProcessExit
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import Command, LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description() -> LaunchDescription:
    pkg_gazebo   = get_package_share_directory("nora_gazebo")
    pkg_desc     = get_package_share_directory("nora_description")
    pkg_gazebo_ros = get_package_share_directory("gazebo_ros")

    # ------------------------------------------------------------------
    # Launch arguments
    # ------------------------------------------------------------------
    use_sim_time_arg = DeclareLaunchArgument(
        "use_sim_time",
        default_value="true",
        description="Use Gazebo simulation clock",
    )
    use_sim_time = LaunchConfiguration("use_sim_time")

    world_arg = DeclareLaunchArgument(
        "world",
        default_value=os.path.join(pkg_gazebo, "worlds", "tabletop.world"),
        description="Path to the Gazebo world file",
    )
    world = LaunchConfiguration("world")

    # ------------------------------------------------------------------
    # Environment — extend GAZEBO_MODEL_PATH
    # ------------------------------------------------------------------
    set_model_path = AppendEnvironmentVariable(
        "GAZEBO_MODEL_PATH",
        os.path.join(pkg_gazebo, "models"),
    )

    # ------------------------------------------------------------------
    # Gazebo server + client
    # ------------------------------------------------------------------
    gazebo = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(pkg_gazebo_ros, "launch", "gazebo.launch.py")
        ),
        launch_arguments={"world": world}.items(),
    )

    # ------------------------------------------------------------------
    # Robot description via xacro
    # ------------------------------------------------------------------
    xacro_file = os.path.join(pkg_desc, "urdf", "nora_arm.urdf.xacro")
    robot_description = {
        "robot_description": ParameterValue(
            Command(["xacro ", xacro_file, " use_gazebo:=true"]), value_type=str
        )
    }

    # ------------------------------------------------------------------
    # robot_state_publisher
    # ------------------------------------------------------------------
    rsp_node = Node(
        package="robot_state_publisher",
        executable="robot_state_publisher",
        name="robot_state_publisher",
        output="screen",
        parameters=[robot_description, {"use_sim_time": use_sim_time}],
    )

    # ------------------------------------------------------------------
    # Spawn NORA arm into Gazebo
    # ------------------------------------------------------------------
    spawn_node = Node(
        package="gazebo_ros",
        executable="spawn_entity.py",
        name="spawn_nora_arm",
        output="screen",
        arguments=[
            "-topic", "robot_description",
            "-entity", "nora_arm",
            "-x", "0.0",
            "-y", "0.0",
            "-z", "0.0",
        ],
    )

    # ------------------------------------------------------------------
    # Controllers (names from nora_control/config/ros2_controllers.yaml),
    # started once the entity exists and gazebo_ros2_control is loaded
    # ------------------------------------------------------------------
    controller_spawners = [
        Node(
            package="controller_manager",
            executable="spawner",
            arguments=[controller, "--controller-manager", "/controller_manager"],
            output="screen",
        )
        for controller in ("joint_state_broadcaster", "arm_controller", "gripper_controller")
    ]
    start_controllers = RegisterEventHandler(
        OnProcessExit(target_action=spawn_node, on_exit=controller_spawners)
    )

    world_to_camera = Node(
        package="tf2_ros",
        executable="static_transform_publisher",
        name="world_to_camera_link",
        arguments=[
            "--x", "0.35", "--y", "-0.05", "--z", "1.45",
            "--roll", "0", "--pitch", "1.5708", "--yaw", "0",
            "--frame-id", "world", "--child-frame-id", "camera_link",
        ],
        parameters=[{"use_sim_time": use_sim_time}],
    )

    camera_to_optical = Node(
        package="tf2_ros",
        executable="static_transform_publisher",
        name="camera_link_to_optical",
        arguments=[
            "--x", "0", "--y", "0", "--z", "0",
            "--roll", "-1.5708", "--pitch", "0", "--yaw", "-1.5708",
            "--frame-id", "camera_link",
            "--child-frame-id", "camera_color_optical_frame",
        ],
        parameters=[{"use_sim_time": use_sim_time}],
    )

    return LaunchDescription(
        [
            use_sim_time_arg,
            world_arg,
            set_model_path,
            gazebo,
            rsp_node,
            spawn_node,
            start_controllers,
            world_to_camera,
            camera_to_optical,
        ]
    )
