"""
gazebo.launch.py — Launch Gazebo Classic with the NORA tabletop world
and spawn the NORA arm URDF.

Steps:
  1. Set GAZEBO_MODEL_PATH so Gazebo finds local models.
  2. Start gzserver + gzclient with tabletop.world.
  3. Load the NORA arm URDF via xacro.
  4. Start robot_state_publisher.
  5. Spawn the NORA arm into Gazebo using spawn_entity.py.
"""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import (
    AppendEnvironmentVariable,
    DeclareLaunchArgument,
    IncludeLaunchDescription,
)
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import Command, LaunchConfiguration
from launch_ros.actions import Node


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
        "robot_description": Command(["xacro ", xacro_file])
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

    return LaunchDescription(
        [
            use_sim_time_arg,
            world_arg,
            set_model_path,
            gazebo,
            rsp_node,
            spawn_node,
        ]
    )
