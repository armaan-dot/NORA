# ROS 2 Humble environment for the Foxglove setup (sim_foxglove.launch.py).
FROM ros:humble-ros-base

RUN apt-get update && apt-get install -y --no-install-recommends \
      ros-humble-rosbridge-server \
      ros-humble-foxglove-bridge \
      ros-humble-robot-state-publisher \
      ros-humble-moveit-ros-move-group \
      ros-humble-moveit-planners-ompl \
      ros-humble-moveit-kinematics \
      python3-colcon-common-extensions \
      git curl \
    && rm -rf /var/lib/apt/lists/*

RUN echo 'source /opt/ros/humble/setup.bash' >> /root/.bashrc \
 && echo '[ -f /workspaces/NORA/ros2_ws/install/setup.bash ] && source /workspaces/NORA/ros2_ws/install/setup.bash' >> /root/.bashrc
