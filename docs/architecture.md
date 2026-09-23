# NORA System Architecture

**Version:** 0.1.0  
**Status:** Draft  
**Author:** NORA Core Team

---

## Table of Contents

1. [Overview](#overview)
2. [System Diagram](#system-diagram)
3. [Component Reference](#component-reference)
   - [Natural Language Understanding (NLU)](#1-natural-language-understanding-nlu)
   - [Intent Resolution](#2-intent-resolution)
   - [Affordance Scoring Engine](#3-affordance-scoring-engine)
   - [Orchestrator](#4-orchestrator)
   - [Skill Library](#5-skill-library)
   - [ROS 2 Interface Layer](#6-ros-2-interface-layer)
   - [Arm Execution Backend](#7-arm-execution-backend)
4. [Data Flow](#data-flow)
5. [Inter-Component Interfaces](#inter-component-interfaces)
6. [Error Handling and Fallbacks](#error-handling-and-fallbacks)
7. [Configuration and Tunability](#configuration-and-tunability)

---

## Overview

NORA (Natural language Operation and Robotic Arm) is a modular, language-driven robotic manipulation system. A human operator issues natural-language commands; NORA parses them into structured intent, scores candidate skills for feasibility and usefulness, selects the best skill sequence, and executes them via ROS 2 against a physical or simulated robot arm.

The design is deliberately layered so that any component can be swapped independently:

- The NLU backend can switch from a rule-based mock to a full LLM (GPT-4o, Gemma-3, Mistral) without touching the orchestrator.
- The affordance scorer can be replaced with a learned model while retaining the same interface contract.
- The arm backend can target Gazebo simulation, Isaac Sim, or a physical manipulator (UR5e, xArm7, Kinova) by changing only the ROS 2 skill drivers.

---

## System Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              NORA System                                      │
│                                                                               │
│   Human Operator                                                              │
│       │                                                                       │
│       │  "pick up the red cube"  (text or speech)                            │
│       ▼                                                                       │
│  ┌─────────────────────────────────────────────────────┐                     │
│  │              NLU Layer  (nora_nlu_node)             │                     │
│  │                                                     │                     │
│  │  ┌──────────────┐     ┌───────────────────────┐    │                     │
│  │  │  Text Input  │────▶│  Parser / LLM Client  │    │                     │
│  │  └──────────────┘     └──────────┬────────────┘    │                     │
│  │                                  │                  │                     │
│  │                          Intent JSON                │                     │
│  │                    { action, target_object, ... }   │                     │
│  └──────────────────────────────────┬────────────────-─┘                     │
│                                     │  ROS 2 topic: /nora/intent             │
│                                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐                    │
│  │          Affordance Scoring Engine (nora_core)       │                    │
│  │                                                      │                    │
│  │  ┌──────────────────┐   ┌────────────────────────┐  │                    │
│  │  │ Usefulness Model │   │  Feasibility Model     │  │                    │
│  │  │  P(skill|intent) │   │  P(success|world_state)│  │                    │
│  │  └────────┬─────────┘   └────────────┬───────────┘  │                    │
│  │           │                          │               │                    │
│  │           └───────────┬──────────────┘               │                    │
│  │                       ▼                               │                    │
│  │          WeightedProductFusion                        │                    │
│  │     combined = U^w_u  *  F^w_f                       │                    │
│  │                       │                               │                    │
│  │               AffordanceScore[]                       │                    │
│  └──────────────────────────────────────────────────────┘                    │
│                           │  ranked candidate skills                         │
│                           ▼                                                  │
│  ┌──────────────────────────────────────────────────────┐                    │
│  │                  Orchestrator (nora_core)            │                    │
│  │                                                      │                    │
│  │  ┌──────────────┐    ┌───────────────────────────┐  │                    │
│  │  │   Planner    │───▶│   SkillPlan (sequence)    │  │                    │
│  │  └──────────────┘    └───────────────────────────┘  │                    │
│  │         ▲                                            │                    │
│  │         │  world state / perception                  │                    │
│  │  ┌──────┴──────────────────────────────────────┐    │                    │
│  │  │           Perception Module                  │    │                    │
│  │  │  (camera, depth, object detection)           │    │                    │
│  │  └──────────────────────────────────────────────┘    │                    │
│  └──────────────────────────────────────────────────────┘                    │
│                           │  SkillPlan                                       │
│                           ▼                                                  │
│  ┌──────────────────────────────────────────────────────┐                    │
│  │              Skill Library  (nora_skills)            │                    │
│  │                                                      │                    │
│  │   open_gripper   move_to_pose   close_gripper        │                    │
│  │   go_home        pick           place                 │                    │
│  │                                                      │                    │
│  │  Each skill: pre-condition check → execute → verify  │                    │
│  └──────────────────────────────────────────────────────┘                    │
│                           │  ROS 2 action calls / service calls              │
│                           ▼                                                  │
│  ┌──────────────────────────────────────────────────────┐                    │
│  │           ROS 2 Interface Layer  (nora_ros)          │                    │
│  │                                                      │                    │
│  │  MoveIt2 MoveGroupInterface  │  JointTrajectory      │                    │
│  │  GripperCommand action       │  TF2 transforms       │                    │
│  └──────────────────────────────────────────────────────┘                    │
│                           │  hardware or sim bridge                          │
│                           ▼                                                  │
│  ┌──────────────────────────────────────────────────────┐                    │
│  │          Arm Execution Backend                       │                    │
│  │                                                      │                    │
│  │   ┌──────────────┐   ┌──────────────┐               │                    │
│  │   │  Gazebo Sim  │   │  Isaac Sim   │               │                    │
│  │   └──────────────┘   └──────────────┘               │                    │
│  │   ┌──────────────┐   ┌──────────────┐               │                    │
│  │   │  UR5e Driver │   │  xArm7 Driver│               │                    │
│  │   └──────────────┘   └──────────────┘               │                    │
│  └──────────────────────────────────────────────────────┘                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Reference

### 1. Natural Language Understanding (NLU)

**Package:** `ros2_ws/src/nora_nlu_node`  
**Primary Class:** `NLUNode(rclpy.node.Node)`  
**ROS 2 Topic Published:** `/nora/intent` (`nora_msgs/Intent`)

#### Responsibilities

- Accept raw text (and optionally audio-transcribed text) from the operator.
- Normalize and tokenize the utterance.
- Route to the configured parser backend.
- Publish a validated `Intent` JSON payload on `/nora/intent`.

#### Parser Backends

| Backend | Module | Use Case |
|---|---|---|
| Mock rule-based | `mock_parser.MockRuleBasedParser` | Unit testing, CI, offline demo |
| OpenAI GPT-4o | `llm_parser.OpenAIParser` | Production (cloud) |
| Local LLM (vLLM) | `llm_parser.LocalLLMParser` | Production (on-premise) |

The NLU node reads `nora_config.yaml` for the `nlu.backend` key and instantiates the appropriate parser. All parsers implement the `BaseParser` abstract interface:

```python
class BaseParser(ABC):
    @abstractmethod
    def parse(self, utterance: str) -> dict:
        """Return a validated intent dictionary."""
        ...
```

#### Output Contract

The parser **must** return a dict that satisfies the `Intent` Pydantic model (see `core/nora_core/intent/schema.py`). The node serializes this to JSON and publishes it as a `std_msgs/String` on `/nora/intent` (Phase 1) or a `nora_msgs/Intent` message (Phase 2+).

---

### 2. Intent Resolution

**Module:** `core/nora_core/intent/`  
**Key Classes:** `Intent`, `IntentValidator`, `IntentRouter`

#### Responsibilities

- Define the canonical `Intent` schema via Pydantic v2.
- Validate that parsed output conforms to the schema.
- Route intents to the correct downstream handler (Affordance Scorer for manipulation intents; direct execution for trivial intents like `go_home`).

#### Intent Schema Summary

```
Intent {
  action:          str        # "pick" | "place" | "go_home" | "open_gripper" | ...
  target_object:   str | None # semantic object label
  target_location: str | None # semantic location label
  parameters:      dict       # action-specific extras (e.g., speed, force)
  confidence:      float      # parser confidence [0, 1]
  raw_utterance:   str        # original command string
}
```

Full schema documentation: [`docs/intent_schema.md`](intent_schema.md).

---

### 3. Affordance Scoring Engine

**Module:** `core/nora_core/affordance/`  
**Key Classes:** `AffordanceScore`, `UsefulnessModel`, `FeasibilityModel`, `WeightedProductFusion`

#### Responsibilities

- For each candidate skill, compute two scores:
  - **Usefulness** `U ∈ [0,1]`: How well does this skill satisfy the stated intent?
  - **Feasibility** `F ∈ [0,1]`: Can the robot physically execute this skill given the current world state?
- Fuse scores with a weighted product: `combined = U^w_u × F^w_f`
- Return a ranked `AffordanceScore` list.

#### Scoring Formula

```
combined_score = usefulness^w_u  ×  feasibility^w_f
```

Where `w_u + w_f = 1` (typically `w_u = 0.6`, `w_f = 0.4`).

Full scoring rationale and worked example: [`docs/affordance_scoring.md`](affordance_scoring.md).

---

### 4. Orchestrator

**Module:** `core/nora_core/planner.py`  
**Key Classes:** `Planner`, `SkillPlan`  
**ROS 2 Topic Subscribed:** `/nora/intent`  
**ROS 2 Topic Published:** `/nora/skill_plan`

#### Responsibilities

- Receive a validated `Intent`.
- Query the Affordance Scoring Engine for ranked skills.
- Use the top-K ranked skills to compose a `SkillPlan` (ordered list of atomic skills).
- Handle retry logic when a skill fails pre-condition checks.
- Publish the `SkillPlan` for execution by the Skill Library.

#### Replanning

If a skill fails during execution, the Orchestrator re-queries the Affordance Scorer with updated world state and attempts an alternative skill sequence, up to `max_replan_attempts` (configurable, default `3`).

---

### 5. Skill Library

**Packages:**
- `ros2_ws/src/nora_skills` (Python implementation for rapid prototyping and mock testing)
- `ros2_ws/src/nora_skills_cpp` (High-performance C++ implementation with native MoveIt 2 `MoveGroupInterface` integration)
**Key Classes:** `BaseSkill`, concrete skill implementations (`MoveToPoseSkill`, `PickSkill`, `PlaceSkill`, `GoHomeSkill`, `GripperSkill`)

#### Skill Lifecycle

Each skill follows a three-phase lifecycle:

```
1. pre_condition()  → bool   # is the robot in a valid state to attempt this skill?
2. execute()        → Result # send goal to MoveIt2 / gripper action server
3. post_condition() → bool   # verify expected outcome (e.g., gripper force threshold)
```

#### Registered Skills

| Skill Name | Description | Pre-Condition |
|---|---|---|
| `open_gripper` | Opens gripper to max aperture | None |
| `close_gripper` | Closes gripper until contact or limit | Gripper open |
| `move_to_pose` | Cartesian/joint-space move via MoveIt2 | Pose reachable (IK check) |
| `go_home` | Return to defined home joint configuration | None |
| `pick` | High-level composite: open → move → close | Object detected, pose known |
| `place` | High-level composite: move → open | Object held, target pose known |

---

### 6. ROS 2 Interface Layer

**Package:** `ros2_ws/src/nora_ros`

#### Interfaces Used

| ROS 2 Interface | Purpose |
|---|---|
| `moveit_msgs/action/MoveGroup` | Trajectory planning and execution |
| `control_msgs/action/GripperCommand` | Gripper open/close |
| `sensor_msgs/JointState` | Current arm state |
| `geometry_msgs/PoseStamped` | Target end-effector poses |
| `tf2_ros/TransformListener` | Object pose in world frame |
| `nora_msgs/Intent` | Custom intent message |
| `nora_msgs/SkillPlan` | Custom skill plan message |

#### TF2 and Perception

Object poses detected by the perception module are published to TF2 under the `/nora/objects/<label>` frame. The Skill Library resolves target poses by looking up this TF2 frame at skill-execution time, ensuring the arm tracks real-time object positions.

---

### 7. Arm Execution Backend

The lowest layer. NORA is hardware-agnostic at this level; the ROS 2 hardware interface (ros2_control) abstracts over:

- **Gazebo classic** (via `gazebo_ros2_control`): Primary simulation target for Phase 1–3.
- **Isaac Sim** (via `isaacsim_ros2_bridge`): High-fidelity simulation for Phase 3+.
- **UR5e** (via `ur_robot_driver`): Physical arm target for Phase 4+.
- **xArm7** (via `xarm_ros2`): Alternative physical arm.

Configuration is selected via the `robot_description` launch argument, which loads the appropriate URDF/xacro and controller config.

---

## Data Flow

```
Text Command
    │
    ▼
[NLU Node] ──────────────────────────────── /nora/raw_command
    │
    │ parse(utterance) → Intent dict
    ▼
[Intent Validator] ─── validation error? ── /nora/errors
    │
    │ valid Intent
    ▼
[Affordance Scorer]
    │
    │ world_state from /nora/world_state
    │
    │ AffordanceScore[] (ranked)
    ▼
[Planner / Orchestrator] ────────────────── /nora/skill_plan
    │
    │ SkillPlan
    ▼
[Skill Library]
    │
    │ pre_condition → execute → post_condition
    ▼
[ROS 2 Interface Layer]
    │
    │ MoveIt2 goals, gripper actions
    ▼
[Arm Backend]
    │
    │ joint trajectory execution
    ▼
Physical/Simulated Robot
```

---

## Inter-Component Interfaces

| From | To | Transport | Message Type |
|---|---|---|---|
| NLU Node | Orchestrator | ROS 2 topic `/nora/intent` | `nora_msgs/Intent` |
| Perception | Orchestrator | ROS 2 topic `/nora/world_state` | `nora_msgs/WorldState` |
| Orchestrator | Skill Library | In-process call (Phase 1) / ROS 2 topic (Phase 2+) | `SkillPlan` |
| Skill Library | MoveIt2 | ROS 2 action | `moveit_msgs/MoveGroup` |
| Skill Library | Gripper | ROS 2 action | `control_msgs/GripperCommand` |
| Config | All | YAML config file | `nora_config.yaml` |

---

## Error Handling and Fallbacks

| Error Condition | Handling |
|---|---|
| NLU parse failure / low confidence | Publish to `/nora/errors`, prompt operator for clarification |
| Intent validation failure | Reject, log, publish error |
| No skill scores above threshold | Abort, publish `NORA_ERR_NO_FEASIBLE_SKILL` |
| MoveIt2 planning failure | Retry with relaxed constraints; after N fails, abort |
| Post-condition check failure | Trigger replanning |
| Hardware estop | Immediate abort, publish `NORA_ERR_ESTOP` |

---

## Configuration and Tunability

All tunable parameters live in `config/nora_config.yaml`:

```yaml
nlu:
  backend: mock          # mock | openai | local_llm
  confidence_threshold: 0.7

affordance:
  weights:
    usefulness: 0.6
    feasibility: 0.4
  min_combined_score: 0.3

planner:
  top_k: 3
  max_replan_attempts: 3

robot:
  description: ur5e      # ur5e | xarm7 | mock
  home_joint_positions: [0.0, -1.57, 0.0, -1.57, 0.0, 0.0]
```
