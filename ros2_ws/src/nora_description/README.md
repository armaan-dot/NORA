# nora_description

URDF/Xacro robot description for the **NORA 6-DOF arm**, using primitive box/cylinder geometries. Provides everything needed to visualise the arm in RViz2 and to load it into simulation or hardware.

## Package Layout

```
nora_description/
├── urdf/
│   ├── nora_arm.urdf.xacro   # Main arm description (world→base→link1..6→gripper)
│   ├── materials.xacro        # Silver, dark_grey, orange material defs
│   └── ros2_control.xacro     # ros2_control hardware interface stub
├── config/
│   └── joint_limits.yaml      # Position / velocity / effort limits
├── launch/
│   └── display.launch.py      # Visualise arm in RViz2 with JSP GUI
├── rviz/
│   └── nora_arm.rviz          # Minimal RViz config (Grid + TF + RobotModel)
├── meshes/
│   ├── visual/                # Placeholder — add DAE/STL visual meshes here
│   └── collision/             # Placeholder — add simplified collision meshes here
```

## Build

```bash
cd ~/ros2_ws
colcon build --packages-select nora_description
source install/setup.bash
```

## Launch — Display in RViz2

```bash
ros2 launch nora_description display.launch.py
```

Use the **Joint State Publisher GUI** sliders to pose the arm interactively.

## Joint Summary

| Joint | Type | Parent → Child | Axis |
|-------|------|----------------|------|
| `joint1` | revolute | `base_link` → `link1` | Z (shoulder yaw) |
| `joint2` | revolute | `link1` → `link2` | Y (shoulder pitch) |
| `joint3` | revolute | `link2` → `link3` | Y (elbow pitch) |
| `joint4` | revolute | `link3` → `link4` | Z (forearm roll) |
| `joint5` | revolute | `link4` → `link5` | Y (wrist pitch) |
| `joint6` | revolute | `link5` → `link6` | Z (wrist roll) |
| `gripper_joint` | revolute | `link6` → `gripper_link` | X |

## TODOs

- [ ] `# TODO(nora)`: Replace box/cylinder primitives with real DAE/STL meshes in `meshes/`
- [ ] `# TODO(nora)`: Swap `mock_components/GenericSystem` for actual hardware driver in `ros2_control.xacro`
- [ ] `# TODO(nora)`: Add collision groups and MoveIt2 SRDF
- [ ] `# TODO(nora)`: Add camera / sensor links (wrist camera, depth sensor)
- [ ] `# TODO(nora)`: Tune inertia tensors once CAD/STEP files are available
