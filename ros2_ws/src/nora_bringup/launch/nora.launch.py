from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def _node(package, executable, config=None, name=None):
    params = [{"use_sim_time": LaunchConfiguration("use_sim_time")}]
    if config:
        params.insert(0, PathJoinSubstitution([FindPackageShare(package), "config", config]))
    kwargs = {"name": name} if name else {}
    return Node(
        package=package,
        executable=executable,
        output="screen",
        parameters=params,
        **kwargs,
    )


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument("use_sim_time", default_value="false"),
        _node("nora_nlu_node", "nora_nlu_node", "nlu.yaml"),
        _node("nora_affordance", "nora_affordance_node", "weights.yaml"),
        _node("nora_skills_cpp", "nora_skills_cpp_node", "skills_cpp_params.yaml", name="nora_skills_cpp_node"),
        _node("nora_world_model", "world_model_node", "world_model.yaml"),
        _node("nora_bt_executor", "bt_executor_node", "bt_executor.yaml"),
        _node("nora_orchestrator", "nora_orchestrator"),
    ])
