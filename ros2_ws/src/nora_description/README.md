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

| Joint | Type | Parent → Child | Axis | Motion Limits |
|---|---|---|---|---|
| `joint1` | revolute | `base_link` → `link1` | Z (shoulder yaw) | [-180°, +180°] |
| `joint2` | revolute | `link1` → `link2` | Y (shoulder pitch) | [-180°, +180°] |
| `joint3` | revolute | `link2` → `link3` | Y (elbow pitch) | [-180°, +180°] |
| `joint4` | revolute | `link3` → `link4` | Z (forearm roll) | [-180°, +180°] |
| `joint5` | revolute | `link4` → `link5` | Y (wrist pitch) | [-180°, +180°] |
| `joint6` | revolute | `link5` → `link6` | Z (wrist roll) | [-180°, +180°] |
| `gripper_joint` | revolute | `link6` → `gripper_link` | X (gripper stroke) | [0 mm, 80 mm] |

## Arm Physical Dimensions & Link Specifications

| Link | Geometry Primitive | Dimensions (mm) | Joint Origin Z-Offset (mm) | Mass (kg) | Material Color |
|---|---|---|---|---|---|
| `base_link` | Cylinder | Ø 160 mm × H 100 mm ($r=0.08\,\text{m}, l=0.10\,\text{m}$) | $z = 0\,\text{mm}$ (origin) | 2.0 kg | Dark Grey |
| `link1` (Shoulder) | Rectangular Box | $70 \times 70 \times 150\,\text{mm}$ | $z = 100\,\text{mm}$ from base | 1.0 kg | Silver |
| `link2` (Upper Arm) | Cylinder | Ø 80 mm × H 200 mm ($r=0.04\,\text{m}, l=0.20\,\text{m}$) | $z = 150\,\text{mm}$ from link1 | 1.0 kg | Silver |
| `link3` (Elbow) | Cylinder | Ø 70 mm × H 180 mm ($r=0.035\,\text{m}, l=0.18\,\text{m}$) | $z = 200\,\text{mm}$ from link2 | 1.0 kg | Silver |
| `link4` (Forearm) | Rectangular Box | $60 \times 60 \times 140\,\text{mm}$ | $z = 180\,\text{mm}$ from link3 | 0.8 kg | Dark Grey |
| `link5` (Wrist 1) | Cylinder | Ø 60 mm × H 100 mm ($r=0.03\,\text{m}, l=0.10\,\text{m}$) | $z = 140\,\text{mm}$ from link4 | 0.5 kg | Silver |
| `link6` (Wrist 2) | Cylinder | Ø 50 mm × H 60 mm ($r=0.025\,\text{m}, l=0.06\,\text{m}$) | $z = 100\,\text{mm}$ from link5 | 0.3 kg | Dark Grey |
| `gripper_link` | Rectangular End-Effector | $50 \times 100 \times 80\,\text{mm}$ (stroke: 0–80 mm) | $z = 60\,\text{mm}$ from link6 | 0.2 kg | Orange |

### Overall Workspace & Kinematic Envelope
- **Total Robot Mass:** ~5.8 kg
- **Maximum Vertical Reach:** ~1,010 mm (1.01 m fully extended from base)
- **Nominal Horizontal Reach Radius:** $150\,\text{mm} \le r \le 850\,\text{mm}$
- **Payload Capacity:** 0.5 kg – 1.0 kg
- **Gripper Opening Stroke:** 0.0 mm to 80.0 mm (0.08 m)

## TODOs

- [ ] `# TODO(nora)`: Replace box/cylinder primitives with real DAE/STL meshes in `meshes/`
- [ ] `# TODO(nora)`: Swap `mock_components/GenericSystem` for actual hardware driver in `ros2_control.xacro`
- [ ] `# TODO(nora)`: Add collision groups and MoveIt2 SRDF
- [ ] `# TODO(nora)`: Add camera / sensor links (wrist camera, depth sensor)
- [ ] `# TODO(nora)`: Tune inertia tensors once CAD/STEP files are available
