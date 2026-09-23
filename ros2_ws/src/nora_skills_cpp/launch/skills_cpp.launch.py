import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    pkg_share = get_package_share_directory("nora_skills_cpp")
    default_params_file = os.path.join(pkg_share, "config", "skills_cpp_params.yaml")

    declare_use_sim_time = DeclareLaunchArgument(
        "use_sim_time",
        default_value="false",
        description="Use simulation (Gazebo) clock if true",
    )

    declare_params_file = DeclareLaunchArgument(
        "params_file",
        default_value=default_params_file,
        description="Path to ROS parameters YAML file",
    )

    skills_node = Node(
        package="nora_skills_cpp",
        executable="nora_skills_cpp_node",
        name="nora_skills_cpp_node",
        output="screen",
        parameters=[
            LaunchConfiguration("params_file"),
            {"use_sim_time": LaunchConfiguration("use_sim_time")},
        ],
    )

    return LaunchDescription(
        [
            declare_use_sim_time,
            declare_params_file,
            skills_node,
        ]
    )

