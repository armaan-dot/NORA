#!/usr/bin/env bash
set -e

# shellcheck disable=SC1090,SC1091
source "/opt/ros/${ROS_DISTRO}/setup.bash"
# shellcheck disable=SC1091
source /opt/nora/ws/install/setup.bash

exec "$@"
