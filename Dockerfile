# syntax=docker/dockerfile:1
#
# NORA ROS 2 stack.
#   build:  docker build -t nora .
#   no MoveIt (skills run in mock mode): docker build --build-arg WITH_MOVEIT=0 -t nora .
#
# Dependencies come from the package.xml files via rosdep, so new packages in
# ros2_ws/src are picked up without editing this file.

ARG ROS_DISTRO=humble

# ---------------------------------------------------------------------------
# manifests: package.xml files only, so the rosdep layers below stay cached
# until a manifest changes, plus the list of rosdep keys to skip.
# ---------------------------------------------------------------------------
FROM ros:${ROS_DISTRO}-ros-base AS manifests

# 1 = install MoveIt (default). 0 = skip it; nora_skills_cpp then builds in mock mode.
ARG WITH_MOVEIT=1
# Extra rosdep keys to skip, space separated (e.g. "gazebo_ros gazebo_ros_pkgs rviz2").
ARG EXTRA_SKIP_KEYS=""
# rosdep keys skipped when WITH_MOVEIT=0.
ARG MOVEIT_KEYS="moveit_ros_planning_interface moveit_msgs moveit_ros_move_group moveit_planners_ompl moveit_ros_visualization moveit_configs_utils"

COPY ros2_ws/src /src
# nora_core is a plain Python package (core/), not a rosdep key; it is added to the runtime image below.
RUN mkdir -p /manifests/src \
 && cd /src && find . -name package.xml -exec cp --parents {} /manifests/src/ \; \
 && skip="nora_core ${EXTRA_SKIP_KEYS}" \
 && if [ "${WITH_MOVEIT}" != "1" ]; then skip="${skip} ${MOVEIT_KEYS}"; fi \
 && echo "${skip}" > /manifests/skip-keys

# ---------------------------------------------------------------------------
# build: build dependencies + colcon build (Release, no symlink-install)
# ---------------------------------------------------------------------------
FROM ros:${ROS_DISTRO}-ros-base AS build
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

COPY --from=manifests /manifests /tmp/manifests
RUN apt-get update \
 && rosdep update --rosdistro "${ROS_DISTRO}" \
 && rosdep install -y --rosdistro "${ROS_DISTRO}" \
      --from-paths /tmp/manifests/src --ignore-src \
      -t buildtool -t buildtool_export -t build -t build_export \
      --skip-keys "$(cat /tmp/manifests/skip-keys)" \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/nora/ws
COPY ros2_ws/src ./src
RUN source "/opt/ros/${ROS_DISTRO}/setup.bash" \
 && colcon build \
      --cmake-args -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF

# ---------------------------------------------------------------------------
# runtime: exec dependencies + install tree only
# ---------------------------------------------------------------------------
FROM ros:${ROS_DISTRO}-ros-base AS runtime
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

COPY --from=manifests /manifests /tmp/manifests
# pydantic>=2 is needed by nora_core; Ubuntu 22.04 only packages pydantic 1.x.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3-pip \
 && rosdep update --rosdistro "${ROS_DISTRO}" \
 && rosdep install -y --rosdistro "${ROS_DISTRO}" \
      --from-paths /tmp/manifests/src --ignore-src \
      -t exec \
      --skip-keys "$(cat /tmp/manifests/skip-keys)" \
 && pip3 install --no-cache-dir "pydantic>=2,<3" \
 && rm -rf /var/lib/apt/lists/* /tmp/manifests /root/.ros

# Install tree at the same path it was built in.
COPY --from=build /opt/nora/ws/install /opt/nora/ws/install
# nora_core (imported by nora_affordance), found through PYTHONPATH.
COPY core/nora_core /opt/nora/core/nora_core
# NLU weights. local_parser.py searches the parents of its install location
# for ml/models/nora_nlu_model.json, so /opt/nora/ml/models is found.
COPY ml/models/nora_nlu_model.json /opt/nora/ml/models/nora_nlu_model.json

COPY docker/entrypoint.sh /usr/local/bin/nora-entrypoint
# Strip CR in case the file was checked out with CRLF line endings.
RUN sed -i 's/\r$//' /usr/local/bin/nora-entrypoint \
 && chmod 755 /usr/local/bin/nora-entrypoint \
 && useradd --create-home --uid 1000 --groups dialout nora \
 && mkdir -p /data \
 && chown nora:nora /data

ENV PYTHONPATH=/opt/nora/core \
    ROS_DOMAIN_ID=0 \
    ROS_LOCALHOST_ONLY=0 \
    RMW_IMPLEMENTATION=rmw_fastrtps_cpp \
    NORA_WORLD_MODEL_PATH=/data/world_model.json

VOLUME ["/data"]
USER nora
WORKDIR /opt/nora

ENTRYPOINT ["/usr/local/bin/nora-entrypoint"]
CMD ["ros2", "launch", "nora_bringup", "nora.launch.py"]
