# NORA Ubuntu 22.04 Setup Guide

**Target OS:** Ubuntu 22.04 LTS (Jammy Jellyfish)  
**ROS 2 Distribution:** Humble Hawksbill  
**Status:** Verified (clean VM)

---

> [!IMPORTANT]
> This guide assumes a **clean Ubuntu 22.04** installation with `sudo` access and an internet connection. All commands are run as a regular user (not root) unless otherwise stated.

---

## Table of Contents

1. [System Prerequisites](#1-system-prerequisites)
2. [Install ROS 2 Humble](#2-install-ros-2-humble)
3. [Install Gazebo (Classic)](#3-install-gazebo-classic)
4. [Install MoveIt2](#4-install-moveit2)
5. [Install Additional ROS 2 Packages](#5-install-additional-ros-2-packages)
6. [Python Environment Setup](#6-python-environment-setup)
7. [Build the NORA Workspace](#7-build-the-nora-workspace)
8. [Run the Mock Demo](#8-run-the-mock-demo)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. System Prerequisites

### 1.1 Update the system

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y \
    curl wget git build-essential \
    python3.10 python3.10-dev python3-pip python3-venv \
    software-properties-common gnupg lsb-release
```

### 1.2 Set the locale

ROS 2 requires UTF-8 locale:

```bash
sudo apt install -y locales
sudo locale-gen en_US en_US.UTF-8
sudo update-locale LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
export LANG=en_US.UTF-8
```

Verify:
```bash
locale   # should show UTF-8 in all fields
```

---

## 2. Install ROS 2 Humble

### 2.1 Add the ROS 2 apt repository

```bash
# Add the ROS 2 GPG key
sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.asc \
    | sudo gpg --dearmor -o /usr/share/keyrings/ros-archive-keyring.gpg

# Add the repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] \
    https://packages.ros.org/ros2/ubuntu \
    $(lsb_release -cs) main" \
    | sudo tee /etc/apt/sources.list.d/ros2.list > /dev/null

sudo apt update
```

### 2.2 Install ROS 2 Humble Desktop

```bash
sudo apt install -y ros-humble-desktop
```

> [!TIP]
> `ros-humble-desktop` includes RViz2, rqt, demo packages, and all communication libraries. For a minimal installation (headless servers), use `ros-humble-ros-base` instead.

### 2.3 Install ROS 2 development tools

```bash
sudo apt install -y python3-rosdep python3-colcon-common-extensions python3-argcomplete
```

### 2.4 Initialize rosdep

```bash
sudo rosdep init
rosdep update
```

### 2.5 Source ROS 2 and add to `.bashrc`

```bash
source /opt/ros/humble/setup.bash
echo "source /opt/ros/humble/setup.bash" >> ~/.bashrc
```

Verify:
```bash
ros2 --version   # should print "ros2 cli version X.X.X"
```

---

## 3. Install Gazebo (Classic)

NORA Phase 1–2 targets **Gazebo 11 (Classic)** via the `gazebo_ros2_control` bridge.

```bash
sudo apt install -y ros-humble-gazebo-ros-pkgs
```

This installs Gazebo 11 and all ROS 2 bridge packages (`gazebo_ros`, `gazebo_plugins`, `gazebo_ros2_control`).

Verify:
```bash
gazebo --version   # should print "Gazebo multi-robot simulator, version 11.x.x"
```

---

## 4. Install MoveIt2

```bash
sudo apt install -y ros-humble-moveit
```

> [!NOTE]
> `ros-humble-moveit` is the meta-package that installs the full MoveIt2 suite: `moveit_core`, `moveit_ros_planning`, `moveit_ros_move_group`, `moveit_kinematics`, `moveit_planners_ompl`, and RViz2 plugins.

Verify by launching the MoveIt2 setup assistant (GUI):
```bash
source /opt/ros/humble/setup.bash
ros2 launch moveit_setup_assistant setup_assistant.launch.py
# Close the window when confirmed it opens
```

---

## 5. Install Additional ROS 2 Packages

```bash
sudo apt install -y \
    ros-humble-ros2-control \
    ros-humble-ros2-controllers \
    ros-humble-joint-state-publisher-gui \
    ros-humble-xacro \
    ros-humble-rviz2 \
    ros-humble-tf2-tools \
    ros-humble-rqt-graph
```

---

## 6. Python Environment Setup

NORA's Python packages (`nora_core`, `nora_ml`) are managed in a virtual environment separate from the system Python to avoid dependency conflicts with ROS 2.

### 6.1 Clone the repository

```bash
cd ~
git clone https://github.com/your-org/NORA.git
cd NORA
```

### 6.2 Create and activate the virtual environment

```bash
python3.10 -m venv .venv
source .venv/bin/activate
```

### 6.3 Install core Python dependencies

```bash
pip install --upgrade pip
pip install -r core/requirements.txt
```

### 6.4 (Optional) Install ML dependencies

> [!WARNING]
> ML dependencies require ~4 GB of disk space and may take several minutes to install.

```bash
pip install -r ml/requirements.txt
```

### 6.5 Install NORA core in editable mode

```bash
pip install -e core/
```

Verify:
```bash
python3 -c "from nora_core.affordance.fusion import WeightedProductFusion; print('OK')"
```

---

## 7. Build the NORA ROS 2 Workspace

### 7.1 Install ROS 2 package dependencies

```bash
source /opt/ros/humble/setup.bash
cd ~/NORA
rosdep install --from-paths ros2_ws/src --ignore-src -r -y
```

### 7.2 Build with colcon

```bash
cd ~/NORA
bash scripts/build.sh
```

This runs:
```bash
source /opt/ros/humble/setup.bash
cd ros2_ws
colcon build --symlink-install
```

> [!TIP]
> `--symlink-install` means Python files in `ros2_ws/src/` are symlinked rather than copied, so edits take effect immediately without rebuilding.

### 7.3 Source the workspace overlay

```bash
source ros2_ws/install/setup.bash
echo "source ~/NORA/ros2_ws/install/setup.bash" >> ~/.bashrc
```

Verify:
```bash
ros2 pkg list | grep nora   # should list nora_nlu_node, nora_skills, etc.
```

---

## 8. Run the Mock Demo

The mock demo runs the full NORA pipeline (NLU → Affordance Scoring → Planner) without any hardware or ROS 2 nodes, using only the Python `core/` layer.

```bash
cd ~/NORA
source .venv/bin/activate
bash scripts/run_demo.sh --mock
```

Expected output:
```
[NORA Demo] Starting mock demo...
[NORA Demo] Using mock parser and mock perception

=== NORA Mock Demo ===
Command: pick up the red cube
Intent: {'action': 'pick', 'target_object': 'red_cube', ...}
  Affordance [pick]: usefulness=0.85 feasibility=0.90 combined=0.836
  Affordance [place]: usefulness=0.20 feasibility=0.90 combined=...
  Affordance [go_home]: usefulness=0.20 feasibility=0.90 combined=...
  Affordance [open_gripper]: usefulness=0.20 feasibility=0.90 combined=...
Skill Plan: ['pick', ...]
=== Demo Complete ===
```

### Run the benchmark suite

```bash
cd ~/NORA
source .venv/bin/activate
python3 sim/benchmarks/run_benchmark.py
```

### Run unit and integration tests

```bash
cd ~/NORA
source .venv/bin/activate
python3 -m pytest tests/ core/tests/ -v
```

---

## 9. Troubleshooting

### `ros2: command not found` after opening a new terminal

```bash
source /opt/ros/humble/setup.bash
# Or verify ~/.bashrc contains the source line
grep "ros/humble" ~/.bashrc
```

### `rosdep init` fails with "already been initialized"

```bash
# This is safe to ignore. Run rosdep update instead:
rosdep update
```

### `colcon build` fails with missing package

```bash
rosdep install --from-paths ros2_ws/src --ignore-src -r -y
# Then retry the build
```

### `ImportError: No module named 'nora_core'`

The virtual environment is not activated, or `pip install -e core/` was not run:

```bash
source ~/NORA/.venv/bin/activate
pip install -e ~/NORA/core/
```

### Gazebo crashes on launch (headless server / VM)

Run with software rendering:
```bash
LIBGL_ALWAYS_SOFTWARE=1 gazebo
```

Or install Mesa software renderer:
```bash
sudo apt install -y mesa-utils libgl1-mesa-glx
```
