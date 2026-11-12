# nora_gazebo

Gazebo Classic simulation environment for the **NORA 6-DOF arm**. Provides a tabletop manipulation world with graspable primitive objects and the ROS–Gazebo bridge configuration.

## Package Layout

```
nora_gazebo/
├── worlds/
│   └── tabletop.world     # Ground plane + sun + table + 6 graspable objects + camera
├── models/                # Object models (SDF + OBJ/MTL) exported from the web simulator
├── launch/
│   └── gazebo.launch.py   # Launch Gazebo + spawn NORA arm
├── config/
│   └── gz_bridge.yaml     # ros_gz_bridge topic mapping
```

## World Objects

The arm base sits on the table top at world (0, 0, 0.45), same placement as the web simulator.

| Name | Shape | Size | Pose (x, y, z) |
|------|-------|------|----------------|
| `table` | box top + 4 legs | 1.3 × 0.9 m, surface z=0.45 | (0.35, −0.05, 0) |
| `mug` | mesh; collision cylinder r=0.0372 m, h=0.085 m + handle box | Ø 0.076 m, 0.085 m tall, 0.33 kg | (0.63, −0.15, 0.4925) |
| `glass` | mesh; collision cylinder r=0.0317 m, h=0.11 m | Ø 0.070 m rim, 0.11 m tall, 0.34 kg | (0.47, −0.05, 0.505) |
| `tennis_ball` | mesh; collision sphere r=0.0335 m | Ø 0.067 m, 0.058 kg | (0.25, −0.19, 0.4835) |
| `apple` | mesh; collision cylinder r=0.0383 m, h=0.064 m | Ø 0.077 m, 0.18 kg | (0.40, 0.12, 0.4827) |
| `can` | mesh; collision cylinder r=0.035 m, h=0.09 m | Ø 0.071 m, 0.09 m tall, 0.37 kg | (0.58, 0.10, 0.495) |
| `notebook` | mesh; collision box 0.12 × 0.07 × 0.018 m | 0.11 kg | (0.32, −0.36, 0.459) |
| `overhead_camera` | depth camera | 640×480, 55° below horizontal, aimed at the table centre | (0.981, −0.05, 1.351), rpy (0, 0.9599, 3.1416) |

The object models in `models/` are generated from the web simulator's meshes and physics (`frontend/src/sim/objectMeshes.ts`, `objectPhysics.ts`) by `npm run export:gazebo` in `frontend/`. Each model's origin is its body centre; the glass, mug, tennis ball positions are the web default scene's, the others are free spots on the table.

## Build

```bash
colcon build --packages-select nora_gazebo nora_description
source install/setup.bash
```

## Launch

```bash
ros2 launch nora_gazebo gazebo.launch.py
```

Optionally specify a custom world file:

```bash
ros2 launch nora_gazebo gazebo.launch.py world:=/path/to/custom.world
```

## ROS–Gazebo Bridge

Start the bridge separately using the provided config:

```bash
ros2 run ros_gz_bridge parameter_bridge \
  --ros-args -p config_file:=$(ros2 pkg prefix nora_gazebo)/share/nora_gazebo/config/gz_bridge.yaml
```

## TODOs

- [ ] `# TODO(nora)`: Add real URDF plugins (gazebo_ros_control, IMU, force/torque sensors)
- [ ] `# TODO(nora)`: Integrate ros_gz_bridge launch into `gazebo.launch.py`
- [ ] `# TODO(nora)`: Tune object friction/mass for realistic grasping
- [ ] `# TODO(nora)`: Add camera and depth sensor models to the world
