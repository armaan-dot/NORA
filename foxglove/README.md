# Foxglove Studio Integration for NORA

This directory contains layout configurations and documentation for visualizing and interacting with the NORA 6-DOF robotic manipulator using [Foxglove Studio](https://foxglove.dev/).

---

## Features

- **3D Robot Visualization**: Displays the full 6-DOF NORA arm URDF (`/robot_description`), TF transform tree (`/tf`, `/tf_static`), fixed world frame, and tabletop markers.
- **Joint State Telemetry**: Real-time multi-series plot of joint positions (`/joint_states.position[0..5]`) for all six arm joints.
- **NORA Intent Publisher**: Interactive publisher panel to test and dispatch JSON intents (`{"action": "pick", "target_object": "red_cube", ...}`) directly to `/nora/intent`.
- **State Machine & Execution Monitor**: Real-time message inspect panels displaying current orchestrator state (`/nora/orchestrator/state`) and intent topics.
- **ROS 2 Logs**: Integrated `/rosout` viewer filtering logs across all NORA nodes.

---

## Prerequisites

1. Install `foxglove_bridge` in your ROS 2 environment:
   ```bash
   sudo apt-get install ros-humble-foxglove-bridge
   ```
2. Download and install [Foxglove Studio Desktop](https://foxglove.dev/download) or use the web app at [app.foxglove.dev](https://app.foxglove.dev/).

---

## Quick Start

### 1. Launch Foxglove Bridge & Robot Description

To launch the NORA arm description and the Foxglove WebSocket bridge:

```bash
# Launch using nora_bringup
ros2 launch nora_bringup foxglove.launch.py

# Or launch directly from nora_description
ros2 launch nora_description foxglove.launch.py
```

Optional launch arguments:
- `port:=8765` — WebSocket port (default: `8765`)
- `address:=0.0.0.0` — Bind address (default: `0.0.0.0`)
- `gui:=true` — Launch joint_state_publisher_gui for manual joint sliders
- `use_sim_time:=true` — Synchronize with Gazebo simulation clock

### 2. Launch with Gazebo Simulation

```bash
ros2 launch nora_bringup sim_gazebo.launch.py foxglove:=true
```

### 3. Connect Foxglove Studio

1. Open Foxglove Studio.
2. Select **Open connection** -> **Foxglove WebSocket**.
3. Enter URL: `ws://localhost:8765` and click **Open**.
4. Import the layout:
   - Click the layout selector (top-left) -> **Import from file...**.
   - Select `foxglove/nora_foxglove_layout.json`.
5. You will see the 3D NORA arm, live joint graphs, and intent dispatch panel ready to interact!

