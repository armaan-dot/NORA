# nora_gazebo

Gazebo Classic simulation environment for the **NORA 6-DOF arm**. Provides a tabletop manipulation world with graspable primitive objects and the ROS–Gazebo bridge configuration.

## Package Layout

```
nora_gazebo/
├── worlds/
│   └── tabletop.world     # Ground plane + sun + table + 3 graspable objects
├── models/                # Custom Gazebo model SDFs (empty — add as needed)
├── launch/
│   └── gazebo.launch.py   # Launch Gazebo + spawn NORA arm
├── config/
│   └── gz_bridge.yaml     # ros_gz_bridge topic mapping
```

## World Objects

| Name | Shape | Size | Pose (x, y, z) |
|------|-------|------|----------------|
| `table` | box | 0.8 × 1.4 × 0.75 m | (0.6, 0, 0.375) |
| `red_cube` | box | 0.05 m³ | (0.55, −0.15, 0.775) |
| `blue_cylinder` | cylinder | r=0.04 m, h=0.08 m | (0.60, 0.10, 0.79) |
| `green_sphere` | sphere | r=0.04 m | (0.70, −0.05, 0.79) |

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
- [ ] `# TODO(nora)`: Create SDF models for reusable objects under `models/`
- [ ] `# TODO(nora)`: Integrate ros_gz_bridge launch into `gazebo.launch.py`
- [ ] `# TODO(nora)`: Tune object friction/mass for realistic grasping
- [ ] `# TODO(nora)`: Add camera and depth sensor models to the world
