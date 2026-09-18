# NORA Intent JSON Schema

**Version:** 0.1.0  
**Status:** Draft

---

## Table of Contents

1. [Overview](#overview)
2. [Canonical Schema](#canonical-schema)
3. [Field Reference](#field-reference)
4. [Pydantic Model](#pydantic-model)
5. [ROS 2 Message Mapping](#ros-2-message-mapping)
6. [Examples by Action Type](#examples-by-action-type)
7. [Validation Rules](#validation-rules)
8. [Versioning](#versioning)

---

## Overview

The **Intent** is the central data contract in NORA. It is the output of the NLU layer and the input to the Affordance Scoring Engine and Orchestrator. Every component downstream of the NLU layer depends exclusively on the Intent; no component has access to the raw utterance for decision-making.

The schema is defined in two canonical forms that are always kept in sync:

| Form | Location | Authority |
|---|---|---|
| Pydantic v2 model | `core/nora_core/intent/schema.py` | **Source of truth** |
| ROS 2 msg file | `ros2_ws/src/nora_msgs/msg/Intent.msg` | Derived (serialization) |
| JSON Schema (generated) | `docs/intent_schema.json` | Derived (validation) |

---

## Canonical Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://nora.local/schemas/intent/v1",
  "title": "Intent",
  "type": "object",
  "required": ["action", "raw_utterance", "confidence"],
  "additionalProperties": false,
  "properties": {
    "action": {
      "type": "string",
      "enum": ["pick", "place", "go_home", "open_gripper", "close_gripper", "move_to_pose", "stop", "unknown"],
      "description": "The primary robot action to perform."
    },
    "target_object": {
      "type": ["string", "null"],
      "default": null,
      "maxLength": 128,
      "description": "Semantic label of the object to interact with."
    },
    "target_location": {
      "type": ["string", "null"],
      "default": null,
      "maxLength": 128,
      "description": "Semantic label of the target location or surface."
    },
    "pose_hint": {
      "type": ["object", "null"],
      "default": null,
      "description": "Optional 6-DOF pose hint from the parser (world frame).",
      "properties": {
        "position": {
          "type": "object",
          "properties": {
            "x": { "type": "number" },
            "y": { "type": "number" },
            "z": { "type": "number" }
          },
          "required": ["x", "y", "z"]
        },
        "orientation": {
          "type": "object",
          "properties": {
            "x": { "type": "number" },
            "y": { "type": "number" },
            "z": { "type": "number" },
            "w": { "type": "number" }
          },
          "required": ["x", "y", "z", "w"]
        }
      }
    },
    "parameters": {
      "type": "object",
      "default": {},
      "description": "Action-specific parameters. Schema varies by action type (see below).",
      "additionalProperties": true
    },
    "confidence": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 1.0,
      "description": "Parser confidence in this intent, from 0 (no confidence) to 1 (certain)."
    },
    "raw_utterance": {
      "type": "string",
      "maxLength": 1024,
      "description": "The original operator utterance, stored verbatim for logging and debugging."
    },
    "schema_version": {
      "type": "string",
      "default": "1.0",
      "description": "Schema version string. Increment when breaking changes are introduced."
    }
  }
}
```

---

## Field Reference

### `action` *(required, string)*

The primary action the robot should perform. Must be one of the registered action tokens.

| Token | Description | Required Fields |
|---|---|---|
| `pick` | Pick up an object | `target_object` |
| `place` | Place a held object at a location | `target_object`, `target_location` |
| `go_home` | Move arm to home configuration | None |
| `open_gripper` | Open gripper fully | None |
| `close_gripper` | Close gripper to contact | None |
| `move_to_pose` | Move end-effector to a pose | `pose_hint` or `target_location` |
| `stop` | Halt all motion immediately | None |
| `unknown` | Parser could not resolve action | — (trigger clarification) |

---

### `target_object` *(optional, string | null)*

Semantic label for the object of manipulation. The label must match an object class known to the perception module (or the mock world state dictionary in simulation).

**Constraints:**
- Max 128 characters.
- Snake_case preferred (e.g., `red_cube`, `blue_cylinder`).
- `null` when no specific object is targeted.

**Examples:** `"red_cube"`, `"blue_cylinder"`, `"green_sphere"`, `"plate"`, `null`

---

### `target_location` *(optional, string | null)*

Semantic label for the target location, surface, or container. Resolved to a world-frame pose by the Perception module at execution time.

**Constraints:**
- Max 128 characters.
- `null` when no specific location is targeted.

**Examples:** `"plate"`, `"tray"`, `"bin_a"`, `"shelf_top"`, `null`

---

### `pose_hint` *(optional, object | null)*

An optional 6-DOF pose hint. Populated when the parser can extract or infer a spatial reference from the utterance (e.g., "move the arm 10 cm to the left"). The Orchestrator uses this as a priority-1 pose over perception-resolved poses.

Structure:
```json
{
  "position":    { "x": 0.3, "y": 0.0, "z": 0.4 },
  "orientation": { "x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0 }
}
```

Units: **metres** for position, **quaternion (normalized)** for orientation.

---

### `parameters` *(optional, object)*

A free-form dictionary for action-specific extras. Each action type defines its own parameter sub-schema (documented below in the examples section).

---

### `confidence` *(required, float)*

A scalar in `[0.0, 1.0]` representing the parser's confidence. The Orchestrator may reject intents below the configured `nlu.confidence_threshold` (default `0.7`) and request clarification.

---

### `raw_utterance` *(required, string)*

The verbatim input string from the operator. Never modified by the NLU layer. Stored for logging, debugging, and offline dataset construction.

---

### `schema_version` *(optional, string)*

Allows downstream consumers to handle multiple schema versions gracefully during migrations. Defaults to `"1.0"`.

---

## Pydantic Model

```python
# core/nora_core/intent/schema.py
from __future__ import annotations
from typing import Optional, Any
from pydantic import BaseModel, Field, model_validator

class PoseHintPosition(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0

class PoseHintOrientation(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    w: float = 1.0

class PoseHint(BaseModel):
    position: PoseHintPosition = Field(default_factory=PoseHintPosition)
    orientation: PoseHintOrientation = Field(default_factory=PoseHintOrientation)

class Intent(BaseModel):
    action: str
    target_object: Optional[str] = None
    target_location: Optional[str] = None
    pose_hint: Optional[PoseHint] = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(ge=0.0, le=1.0)
    raw_utterance: str
    schema_version: str = "1.0"

    @model_validator(mode="after")
    def validate_action_requirements(self) -> "Intent":
        if self.action == "pick" and not self.target_object:
            raise ValueError("'pick' action requires 'target_object'")
        if self.action == "place" and not self.target_object:
            raise ValueError("'place' action requires 'target_object'")
        if self.action == "move_to_pose" and not self.pose_hint and not self.target_location:
            raise ValueError("'move_to_pose' requires 'pose_hint' or 'target_location'")
        return self
```

---

## ROS 2 Message Mapping

File: `ros2_ws/src/nora_msgs/msg/Intent.msg`

```
# nora_msgs/Intent
std_msgs/Header header
string action
string target_object          # empty string means null
string target_location        # empty string means null
geometry_msgs/PoseStamped pose_hint
bool has_pose_hint
string parameters_json        # parameters dict serialized as JSON string
float32 confidence
string raw_utterance
string schema_version
```

> **Note:** ROS 2 message types do not support nullable fields natively. The convention is:
> - String fields: empty string `""` represents `null`.
> - Pose hints: `has_pose_hint` bool guards whether `pose_hint` should be read.
> - Complex parameters: serialized as a JSON string in `parameters_json`.

**Python helper** (`core/nora_core/intent/ros_bridge.py`):
```python
def intent_to_ros_msg(intent: Intent) -> IntentMsg:
    """Convert a NORA Intent Pydantic model to a ROS 2 Intent message."""
    ...

def ros_msg_to_intent(msg: IntentMsg) -> Intent:
    """Convert a ROS 2 Intent message to a NORA Intent Pydantic model."""
    ...
```

---

## Examples by Action Type

### `pick`

```json
{
  "action": "pick",
  "target_object": "red_cube",
  "target_location": null,
  "pose_hint": null,
  "parameters": {
    "grasp_type": "top_down",
    "approach_distance_m": 0.1
  },
  "confidence": 0.95,
  "raw_utterance": "pick up the red cube",
  "schema_version": "1.0"
}
```

---

### `place`

```json
{
  "action": "place",
  "target_object": "red_cube",
  "target_location": "plate",
  "pose_hint": null,
  "parameters": {
    "release_height_m": 0.02
  },
  "confidence": 0.91,
  "raw_utterance": "put the cube on the plate",
  "schema_version": "1.0"
}
```

---

### `go_home`

```json
{
  "action": "go_home",
  "target_object": null,
  "target_location": null,
  "pose_hint": null,
  "parameters": {},
  "confidence": 0.99,
  "raw_utterance": "go to home position",
  "schema_version": "1.0"
}
```

---

### `open_gripper`

```json
{
  "action": "open_gripper",
  "target_object": null,
  "target_location": null,
  "pose_hint": null,
  "parameters": {
    "aperture_m": 0.08
  },
  "confidence": 0.99,
  "raw_utterance": "open the gripper",
  "schema_version": "1.0"
}
```

---

### `close_gripper`

```json
{
  "action": "close_gripper",
  "target_object": null,
  "target_location": null,
  "pose_hint": null,
  "parameters": {
    "max_force_n": 30.0
  },
  "confidence": 0.98,
  "raw_utterance": "close the gripper",
  "schema_version": "1.0"
}
```

---

### `move_to_pose`

```json
{
  "action": "move_to_pose",
  "target_object": null,
  "target_location": null,
  "pose_hint": {
    "position": { "x": 0.35, "y": -0.1, "z": 0.45 },
    "orientation": { "x": 0.0, "y": 0.707, "z": 0.0, "w": 0.707 }
  },
  "parameters": {
    "velocity_scaling": 0.5,
    "acceleration_scaling": 0.5
  },
  "confidence": 0.88,
  "raw_utterance": "move the arm to the left side",
  "schema_version": "1.0"
}
```

---

### `stop`

```json
{
  "action": "stop",
  "target_object": null,
  "target_location": null,
  "pose_hint": null,
  "parameters": {},
  "confidence": 1.0,
  "raw_utterance": "stop",
  "schema_version": "1.0"
}
```

---

### `unknown`

```json
{
  "action": "unknown",
  "target_object": null,
  "target_location": null,
  "pose_hint": null,
  "parameters": {
    "reason": "utterance_too_ambiguous"
  },
  "confidence": 0.12,
  "raw_utterance": "do the thing with the stuff",
  "schema_version": "1.0"
}
```

---

## Validation Rules

| Rule | Description |
|---|---|
| `action` is required | Must be present and non-empty |
| `action` is in enum | Must be one of the registered action tokens |
| `confidence` in [0,1] | Enforced by Pydantic `ge=0.0, le=1.0` |
| `pick` requires `target_object` | Enforced by `@model_validator` |
| `place` requires `target_object` | Enforced by `@model_validator` |
| `move_to_pose` requires pose or location | Enforced by `@model_validator` |
| `raw_utterance` is required | Must be present; empty string is allowed (programmatic calls) |
| `schema_version` is present | Defaults to `"1.0"` if omitted |

---

## Versioning

The Intent schema follows [Semantic Versioning](https://semver.org/) at the field level:

- **Patch** (e.g., 1.0 → 1.0.1): Documentation fixes, no schema change.
- **Minor** (e.g., 1.0 → 1.1): New optional fields added; backward compatible.
- **Major** (e.g., 1.0 → 2.0): Required field added, field removed, or type changed; breaking change requiring migration.

The `schema_version` field in each Intent payload allows the Orchestrator to detect stale or incompatible messages from older NLU nodes during rolling updates.
