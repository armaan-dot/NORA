# nora_interfaces

Single source of truth for all ROS 2 **message**, **service**, and **action** interfaces used across the NORA robotic system.

## Purpose

This `ament_cmake` package uses `rosidl_generate_interfaces` to compile `.msg`, `.srv`, and `.action` files into language-specific bindings (C++, Python). All other NORA packages depend on this package rather than defining their own interface types.

## Interface Inventory

### Messages (`msg/`)

| Type | Description |
|------|-------------|
| `Intent` | Parsed semantic intent from a natural-language command (action, target object, location, confidence) |
| `SkillCall` | Single skill invocation record — name, parameters, and dispatch timestamp |
| `AffordanceScore` | Affordance score for one skill: usefulness, feasibility, combined score |

### Services (`srv/`)

| Type | Request → Response |
|------|-------------------|
| `ParseCommand` | `raw_text` → `Intent`, `success`, `error_msg` |
| `ScoreAffordances` | `Intent` + `skill_names[]` → `AffordanceScore[]` |

### Actions (`action/`)

| Type | Goal → Result → Feedback |
|------|--------------------------|
| `ExecuteIntent` | `Intent` → `success`, `message`, `executed_skills[]` → `current_skill`, `progress` |
| `ExecuteSkill` | `SkillCall` → `success`, `message` → `status` |

## Build

```bash
cd ~/ros2_ws
colcon build --packages-select nora_interfaces
source install/setup.bash
```

## Test

```bash
colcon test --packages-select nora_interfaces
colcon test-result --verbose
```

## TODOs

- [ ] `# TODO(nora)`: Add field-level validation tests in `test/test_interfaces.py`
- [ ] `# TODO(nora)`: Add `geometry_msgs` fields to `Intent` once pose-target support lands
- [ ] `# TODO(nora)`: Version the schema — bump `Intent.version` on breaking changes
- [ ] `# TODO(nora)`: Consider adding a `Header` to `SkillCall` for full TF timestamping
