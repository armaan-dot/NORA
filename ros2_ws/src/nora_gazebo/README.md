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
| objects | mesh + collision primitives from the web physics | see below | `GAZEBO_SCENE` in `frontend/src/sim/objectLibrary.ts` |
| `overhead_camera` | depth camera | 640×480, 55° below horizontal, aimed at the table centre | (0.981, −0.05, 1.351), rpy (0, 0.9599, 3.1416) |

The objects come from one library shared with the web simulator, `frontend/src/sim/objectLibrary.ts`. `npm run export:gazebo` (in `frontend/`) turns every library entry into `models/<id>` using the web meshes and physics (`objectMeshes.ts`, `objectPhysics.ts`), writes the `GAZEBO_SCENE` objects into `worlds/tabletop.world` (between the `BEGIN objects` / `END objects` markers), and writes the arm commander's catalogue in `nora_bringup/config/gazebo_scene.json`. Do not edit those generated parts by hand: change the library and run the export. Each model's origin is its body centre; friction is 1.0 for every model, not the web value, because Gazebo Classic lets objects slip out of position-controlled fingers.

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
