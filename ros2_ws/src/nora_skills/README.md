# nora_skills

Primitive **skill action servers** for NORA.  Each skill wraps one atomic
robot capability behind a standardised ROS 2 action interface so the
orchestrator can compose them at runtime.

---

## Architecture

```
nora_orchestrator ──action client──► /nora/skills/<skill>  ◄── nora_skills
                                              │
                                       BaseSkillServer
                                              │
                               ┌─────────────┴────────────┐
                               │  execute_callback()       │
                               │  → _execute() [abstract]  │
                               └───────────────────────────┘
```

All skills share `BaseSkillServer` which provides:
- Automatic action server creation.
- Template-method pattern (`execute_callback` → `_execute`).
- Structured logging helpers (`log_info`, `log_warn`, `log_error`).

---

## Skill Servers

| Entry point           | Action topic                    | Description                        |
|-----------------------|---------------------------------|------------------------------------|
| `nora_pick`           | `/nora/skills/pick`             | Grasp a named object               |
| `nora_place`          | `/nora/skills/place`            | Place held object at location      |
| `nora_move_to_pose`   | `/nora/skills/move_to_pose`     | Move arm to named / explicit pose  |
| `nora_open_gripper`   | `/nora/skills/open_gripper`     | Open the end-effector gripper      |
| `nora_close_gripper`  | `/nora/skills/close_gripper`    | Close the end-effector gripper     |
| `nora_go_home`        | `/nora/skills/go_home`          | Return arm to all-zeros home pose  |

---

## Skill Registry

`config/skill_registry.yaml` is the single source of truth for skill
metadata consumed by the orchestrator.  Each entry specifies:

```yaml
skills:
  - name: pick
    action_server: /nora/skills/pick
    description: Pick up a target object
    preconditions: [object_detected, arm_not_holding_object]
    effects: [arm_holding_object]
    params:
      target_object: string
      grasp_pose: pose
```

| Field            | Description                                       |
|------------------|---------------------------------------------------|
| `name`           | Unique skill identifier                           |
| `action_server`  | Full ROS 2 action topic name                      |
| `preconditions`  | World-state predicates that must hold before exec |
| `effects`        | World-state changes after successful execution    |
| `params`         | Named parameters accepted by the goal message     |

---

## Running a Skill Manually

```bash
# Terminal 1 — launch the skill server
ros2 run nora_skills nora_pick

# Terminal 2 — send a goal
ros2 action send_goal /nora/skills/pick nora_interfaces/action/Pick \
  "{target_object: 'red_cube'}"
```

---

## Adding a New Skill

1. Create `nora_skills/skills/<skill_name>.py` inheriting from `BaseSkillServer`.
2. Implement `async def _execute(self, goal_handle)`.
3. Add an entry_point to `setup.py`.
4. Add an entry to `config/skill_registry.yaml`.
5. Define the action type in `nora_interfaces/action/<SkillName>.action`.

---

## Testing

```bash
colcon test --packages-select nora_skills
# or directly:
pytest src/nora_skills/test/
```
