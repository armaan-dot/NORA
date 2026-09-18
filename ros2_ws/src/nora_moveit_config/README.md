# nora_moveit_config

MoveIt 2 configuration package for the **NORA** robotic arm.

## Package Contents

| Path | Purpose |
|---|---|
| `config/nora_arm.srdf` | Semantic robot description — planning groups, named states, collision pairs |
| `config/kinematics.yaml` | IK solver settings (KDL, tip link = `gripper_link`) |
| `config/ompl_planning.yaml` | OMPL planner plugin + planner catalogue (default: RRTConnect) |
| `config/moveit_controllers.yaml` | Maps MoveIt to `ros2_control` controllers |
| `config/joint_limits.yaml` | Velocity & acceleration limits used by trajectory adapters |
| `launch/move_group.launch.py` | Main launch entry-point |

## Prerequisites

```bash
sudo apt install ros-humble-moveit
```

## Building

```bash
cd ~/ros2_ws
colcon build --packages-select nora_moveit_config
source install/setup.bash
```

## Running

```bash
ros2 launch nora_moveit_config move_group.launch.py
```

Optional args:

| Argument | Default | Description |
|---|---|---|
| `use_sim_time` | `false` | Set `true` when running with Gazebo |

## Customising the IK Solver

To switch from KDL to **bio_ik** (recommended for 6-DOF arms):

1. `sudo apt install ros-humble-bio-ik`
2. Edit `config/kinematics.yaml`:

```yaml
arm:
  kinematics_solver: bio_ik/BioIKKinematicsPlugin
```

## TODOs

- [ ] **TODO(nora):** Load `robot_description` from `nora_description` package once URDF is ready.
- [ ] **TODO(nora):** Add RViz configuration file (`rviz/nora.rviz`) and wire into launch.
- [ ] **TODO(nora):** Tune joint limits in `config/joint_limits.yaml` to match real motor specs.
- [ ] **TODO(nora):** Run `moveit_setup_assistant` to auto-generate full self-collision matrix in SRDF.
- [ ] **TODO(nora):** Add `pilz_industrial_motion_planner` as an alternative planner for Cartesian moves.
