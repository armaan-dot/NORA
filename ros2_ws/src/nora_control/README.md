# nora_control

ros2_control configuration and controller launch package for the **NORA** arm.

## Overview

This package configures:

| Controller | Type | Purpose |
|---|---|---|
| `joint_state_broadcaster` | `joint_state_broadcaster/JointStateBroadcaster` | Publishes `/joint_states` |
| `arm_controller` | `joint_trajectory_controller/JointTrajectoryController` | Executes joint-space trajectories |
| `gripper_controller` | `position_controllers/GripperActionController` | Commands gripper open/close |

The `controller_manager` runs at **100 Hz** to match expected hardware update rates.

## File Layout

```
nora_control/
├── config/
│   └── ros2_controllers.yaml   ← All controller parameters
└── launch/
    └── controllers.launch.py   ← Spawn controllers
```

## Building

```bash
colcon build --packages-select nora_control
source install/setup.bash
```

## Running

Ensure your hardware interface (or Gazebo) is already running, then:

```bash
ros2 launch nora_control controllers.launch.py
```

## Verifying Controllers

```bash
# List all controllers and their state
ros2 control list_controllers

# Check joint states are being published
ros2 topic echo /joint_states --once
```

## Sending a Test Goal

```bash
ros2 action send_goal /arm_controller/follow_joint_trajectory \
  control_msgs/action/FollowJointTrajectory \
  '{trajectory: {joint_names: [joint1, joint2, joint3, joint4, joint5, joint6],
    points: [{positions: [0,0,0,0,0,0], time_from_start: {sec: 2}}]}}'
```

## TODOs

- [ ] **TODO(nora):** Add gripper_controller spawner once gripper hardware interface is integrated.
- [ ] **TODO(nora):** Tune `update_rate` and velocity limits once motor specs are confirmed.
- [ ] **TODO(nora):** Add Gazebo ros2_control plugin config for simulation bringup.
- [ ] **TODO(nora):** Integrate hardware interface plugin from `nora_hardware` package.
