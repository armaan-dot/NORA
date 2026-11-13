# nora_description

URDF/Xacro robot description for the **NORA 6-DOF arm**, using primitive box/cylinder geometries. Provides everything needed to visualise the arm in RViz2 and to load it into simulation or hardware.

## Package Layout

```
nora_description/
├── urdf/
│   ├── nora_arm.urdf.xacro   # Main arm description (world→base→link1..6→gripper)
│   ├── materials.xacro        # Arm/gripper colours (same as the web URDF)
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

Same kinematics, limits and geometry as the web simulator (`frontend/public/nora_arm.urdf`), UR5e-style.

| Joint | Type | Parent → Child | Axis | Origin (m) | Limits |
|---|---|---|---|---|---|
| `world_to_base` | fixed | `world` → `base_link` | — | (0, 0, 0.45) table top | — |
| `joint1` | revolute | `base_link` → `link1` | Z (shoulder pan) | (0, 0, 0.086) | ±2π, 150 N·m |
| `joint2` | revolute | `link1` → `link2` | Y (shoulder lift) | (0, 0, 0.0765) | ±2π, 150 N·m |
| `joint3` | revolute | `link2` → `link3` | Y (elbow) | (0, 0, 0.425) | ±π, 150 N·m |
| `joint4` | revolute | `link3` → `link4` | Y (wrist 1) | (0, 0, 0.3922) | ±2π, 28 N·m |
| `joint5` | revolute | `link4` → `link5` | Z (wrist 2) | (0, 0.1333, 0.0997) | ±2π, 28 N·m |
| `joint6` | revolute | `link5` → `link6` | Z (wrist 3) | (0, 0.0596, 0), roll −π/2 | ±2π, 28 N·m |
| `gripper_mount_joint` | fixed | `link6` → `gripper_link` | — | (0, 0, 0.039) | — |
| `tcp_joint` | fixed | `gripper_link` → `tcp` | — | (0, 0, 0.115) between the pads | — |
| `gripper_joint` | prismatic | `gripper_link` → `gripper_driver_link` | X | (0, 0, 0.08) | 0 to 0.085 m pad gap |
| `left_/right_finger_joint` | prismatic, mimic ∓0.5 | `gripper_link` → finger links | X | (∓0.0055, 0, 0.082) | — |

All joint velocity limits are 3.14 rad/s (gripper 0.15 m/s). Every joint at 0 points the arm straight up.
Top-down tool pose: joint2 + joint3 + joint4 = π/2 and joint5 = −π/2.
Home (web simulator): joint1..6 = (−0.37, −0.35, 1.9, 0.02, −π/2, 0), gripper 0.03 m; tcp at (0.371, −0.001, 0.356) in `base_link`, pointing down.

Link masses follow the UR5e (3.761, 8.058, 2.846, 1.37, 1.3, 0.365 kg) plus a 0.925 kg gripper; inertia tensors are primitive approximations.

## TODOs

- [ ] `# TODO(nora)`: Replace box/cylinder primitives with real DAE/STL meshes in `meshes/`
- [ ] `# TODO(nora)`: Swap `mock_components/GenericSystem` for actual hardware driver in `ros2_control.xacro`
- [ ] `# TODO(nora)`: Add collision groups and MoveIt2 SRDF
- [ ] `# TODO(nora)`: Add camera / sensor links (wrist camera, depth sensor)
- [ ] `# TODO(nora)`: Tune inertia tensors once CAD/STEP files are available
