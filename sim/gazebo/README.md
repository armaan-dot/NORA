# Gazebo Simulation Assets

This directory contains Gazebo-specific assets that live **outside** the ROS 2 workspace (`ros2_ws/`).

## Directory Structure

```
sim/gazebo/
├── worlds/         # .world files for Gazebo Classic (XML/SDF)
├── models/         # Custom SDF models (objects, tables, bins)
└── README.md       # This file
```

## Why Outside the ROS Workspace?

The ROS 2 workspace (`ros2_ws/`) is built with `colcon` and contains ROS 2 packages. Gazebo world files and raw SDF models are not ROS 2 packages and do not need to be built — they are loaded directly by Gazebo at launch time via the `GAZEBO_MODEL_PATH` and `GAZEBO_RESOURCE_PATH` environment variables.

Keeping them here avoids polluting the colcon build graph and allows artists/simulation engineers to iterate on models without triggering a full workspace rebuild.

## Environment Variable Setup

Add these to your shell session (or `~/.bashrc`) before launching Gazebo:

```bash
export GAZEBO_MODEL_PATH=$GAZEBO_MODEL_PATH:$(realpath sim/gazebo/models)
export GAZEBO_RESOURCE_PATH=$GAZEBO_RESOURCE_PATH:$(realpath sim/gazebo/worlds)
```

The NORA launch file (`ros2_ws/src/nora_bringup/launch/sim.launch.py`) sets these automatically via `SetEnvironmentVariable` actions.

## Worlds

| File | Description | Status |
|---|---|---|
| `worlds/nora_pick_place.world` | Table + objects scene for pick/place tasks | ⏳ Phase 2 |
| `worlds/nora_empty.world` | Empty world with ground plane | ⏳ Phase 2 |

## Models

| Directory | Description | Status |
|---|---|---|
| `models/red_cube/` | 5cm red cube with contact properties | ⏳ Phase 2 |
| `models/blue_cylinder/` | 5cm blue cylinder | ⏳ Phase 2 |
| `models/plate/` | Flat plate as placement target | ⏳ Phase 2 |
| `models/table/` | Standard 0.75m table | ⏳ Phase 2 |

## Adding a Custom Model

1. Create a directory `sim/gazebo/models/<model_name>/`.
2. Add `model.config` (name, version, description).
3. Add `model.sdf` (SDF format geometry, collision, visual, inertial).
4. Reference the model in a world file with `<include><uri>model://<model_name></uri></include>`.

## Gazebo Versions

NORA Phase 1–3 targets **Gazebo Classic 11** (installed via `ros-humble-gazebo-ros-pkgs`).  
Phase 4+ may migrate to **Gazebo Harmonic** (the new Ignition/Gz stack) via `ros_gz`.
