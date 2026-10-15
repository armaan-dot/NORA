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

| Joint | Type | Parent → Child | Axis | Motion Limits | Max Speed |
|---|---|---|---|---|---|
| `shoulder_pan_joint` | revolute | `base_link` → `shoulder_link` | Z (base yaw) | [-360°, +360°] | 180 °/s |
| `shoulder_lift_joint` | revolute | `shoulder_link` → `upper_arm_link` | Y (shoulder pitch) | [-360°, +360°] | 180 °/s |
| `elbow_joint` | revolute | `upper_arm_link` → `forearm_link` | Y (elbow pitch) | [-180°, +180°] | 180 °/s |
| `wrist_1_joint` | revolute | `forearm_link` → `wrist_1_link` | Y (wrist pitch) | [-360°, +360°] | 360 °/s |
| `wrist_2_joint` | revolute | `wrist_1_link` → `wrist_2_link` | Z (wrist yaw) | [-360°, +360°] | 360 °/s |
| `wrist_3_joint` | revolute | `wrist_2_link` → `wrist_3_link` | Y (wrist pitch) | [-360°, +360°] | 360 °/s |
| `gripper_joint` | prismatic | `tool0` → `gripper_link` | Y (parallel stroke) | [0 mm, 80 mm] | 0.5 m/s |

## Arm Physical Dimensions & Link Specifications (UR5e Official Specs)

| Link | Geometry Primitive | Dimensions (mm) | Joint Origin Offset (mm) | Mass (kg) | Material Color |
|---|---|---|---|---|---|
| `base_link` | Cylinder | Ø 150 mm × H 162.5 mm | $z = 0\,\text{mm}$ (origin) | 4.0 kg | Dark Grey |
| `shoulder_link` | Cylinder & Collar | Ø 130 mm × H 160 mm | $z = 162.5\,\text{mm}$ ($d_1$) | 3.7 kg | UR Blue / Grey |
| `upper_arm_link` | Tube & Cap | Ø 110 mm × L 425 mm | $y = 133.3\,\text{mm}$ ($d_4$) | 8.39 kg | UR Grey / Blue |
| `forearm_link` | Tube & Cap | Ø 90 mm × L 392.2 mm | $z = 425\,\text{mm}$ ($a_2$) | 2.275 kg | UR Grey / Blue |
| `wrist_1_link` | Cylinder | Ø 80 mm × L 99.7 mm | $z = 392.2\,\text{mm}$ ($a_3$) | 1.219 kg | UR Blue |
| `wrist_2_link` | Cylinder | Ø 76 mm × L 99.7 mm | $y = 99.7\,\text{mm}$ ($d_5$) | 1.219 kg | UR Grey |
| `wrist_3_link` | Cylinder & Flange | Ø 70 mm × L 99.6 mm | $z = 99.7\,\text{mm}$ ($d_5$) | 0.188 kg | UR Blue / Dark |
| `gripper_link` | Parallel End-Effector | $50 \times 80 \times 80\,\text{mm}$ | $z = 50\,\text{mm}$ from `tool0` | 0.3 kg | Dark / Orange |

### Overall Workspace & Kinematic Envelope
- **Total Robot Mass:** ~21.3 kg
- **Maximum Nominal Reach:** 850 mm (0.85 m radius from base)
- **Rated Payload:** 5.0 kg
- **Gripper Opening Stroke:** 0.0 mm to 80.0 mm (0.08 m)

## TODOs

- [ ] `# TODO(nora)`: Replace box/cylinder primitives with real DAE/STL meshes in `meshes/`
- [ ] `# TODO(nora)`: Swap `mock_components/GenericSystem` for actual hardware driver in `ros2_control.xacro`
- [ ] `# TODO(nora)`: Add collision groups and MoveIt2 SRDF
- [ ] `# TODO(nora)`: Add camera / sensor links (wrist camera, depth sensor)
- [ ] `# TODO(nora)`: Tune inertia tensors once CAD/STEP files are available
