# NORA Architecture

NORA (Natural Language Orchestrated Robotics Agent) converts a natural-language
manipulation request into a ranked set of robot skills and executes the selected
skills through ROS 2. It is designed so language understanding, decision logic,
robot interfaces, and simulation can evolve independently.

## System at a glance

```text
Operator command
       |
       v
+-----------------------+
| NLU node              |  nora_nlu_node
| text -> Intent        |
+-----------+-----------+
            | ParseCommand service / Intent topic
            v
+-----------------------+
| Affordance scoring    |  nora_affordance + nora_core
| usefulness + feasible |
+-----------+-----------+
            | ScoreAffordances service
            v
+-----------------------+
| Orchestrator          |  nora_orchestrator
| rank, plan, recover   |
+-----------+-----------+
            | ExecuteSkill actions
            v
+-----------------------+       +------------------------------+
| Primitive skills      | ----> | MoveIt 2 / ros2_control       |
| pick, place, home...  |       | joint trajectory controllers  |
+-----------------------+       +---------------+--------------+
                                               |
                                               v
                              NORA arm: Gazebo, Isaac Sim, or hardware
```

## Architectural layers

| Layer | Main location | Responsibility |
|---|---|---|
| Contracts | `schemas/`, `nora_interfaces/` | Versioned JSON schemas and ROS messages, services, and actions shared by all components. |
| Cognitive core | `core/nora_core/` | ROS-independent intent validation, skill registry, affordance fusion, and ranked planning. |
| Language | `nora_nlu_node/`, `ml/` | Converts text into an `Intent`; supports mock rules now and a local fine-tuned model backend. |
| Decision and orchestration | `nora_affordance/`, `nora_orchestrator/` | Evaluates candidate skills, then drives the task state machine and recovery loop. |
| Execution | `nora_skills/`, `nora_moveit_config/`, `nora_control/` | Hosts reusable skill action servers and delegates motion to MoveIt 2 and controllers. |
| Robot and environments | `nora_description/`, `nora_gazebo/`, `nora_isaac/`, `nora_perception/` | Provides the arm model, simulation targets, and replaceable world-state/perception sources. |

## Core execution flow

1. A caller sends raw text to `/nora/parse_command`.
2. The NLU backend produces an `Intent`: action, object, optional location and
   parameters, source text, command ID, schema version, and confidence.
3. Candidate skills are scored for usefulness to the intent and feasibility in
   the current world state.
4. `WeightedProductFusion` combines those scores:

   ```text
   combined = usefulness^w_u * feasibility^w_f
   ```

   The default design uses `w_u = 0.6` and `w_f = 0.4`; a zero usefulness or
   feasibility score prevents selection.
5. `Planner.rank_skills()` sorts the scores descending and returns up to five
   `SkillPlan` candidates.
6. The orchestrator dispatches skills as `ExecuteSkill` actions and reports the
   overall result through the `ExecuteIntent` action.
7. A failed skill moves the task into recovery, where it may replan or end in a
   terminal failure.

## ROS 2 contracts

`nora_interfaces` is the shared ROS contract package. The intended public
interfaces are:

| Type | Name | Purpose |
|---|---|---|
| Message | `Intent` | Parsed command semantics. |
| Message | `SkillCall` | A single skill invocation and its parameters. |
| Message | `AffordanceScore` | Per-skill usefulness, feasibility, combined score, and breakdown. |
| Service | `ParseCommand` | Raw text -> parsed intent. |
| Service | `ScoreAffordances` | Intent + candidate skill names -> scores. |
| Action | `ExecuteIntent` | Run a complete intent with progress feedback. |
| Action | `ExecuteSkill` | Run one primitive skill. |

Services are used for bounded request/response work; actions are used for
long-running, cancellable execution. The orchestrator additionally publishes
its current state on `/nora/orchestrator/state`.

## Orchestrator lifecycle

```text
IDLE -> PARSING -> SCORING -> PLANNING -> EXECUTING -> DONE
                                           |
                                           +-> RECOVERING -> PLANNING
                                           |
                                           +-> FAILED

DONE / FAILED -> IDLE
```

The transition guard in `nora_orchestrator/state_machine.py` rejects illegal
state changes. This makes task progress observable and gives recovery a clear,
bounded handoff point.

## Extensibility boundaries

- **NLU:** `IntentParser` isolates callers from the mock and local-model
  backends. Training data and LoRA/QLoRA configuration live under `ml/`.
- **Affordance scoring:** scorer implementations return normalized values in
  `[0, 1]`, so learned, rule-based, reachability, collision, and object-state
  signals can be composed without changing the planner.
- **Skills:** each primitive server derives from `BaseSkillServer`, which owns
  action-server setup, cancellation, exception handling, and logging.
- **Backends:** the same skill layer can target Gazebo, Isaac Sim, or physical
  hardware as long as the underlying ROS/MoveIt control interfaces are kept.
- **Perception:** world-state producers are deliberately replaceable, allowing
  a mock pose source today and camera-based perception later.

## Current implementation status

The repository contains the contract definitions, pure-Python core, parser
backends, skill-server base and primitive skill modules, an orchestrator state
machine, robot description, controller configuration, MoveIt configuration,
and a Gazebo tabletop world. Several runtime connections are intentionally
scaffolded: the NLU node currently exposes a `Trigger` placeholder and publishes
stringified intents until generated interfaces are wired in; the orchestrator's
`ExecuteIntent` callback currently aborts with a TODO; and real perception,
motion execution, collision/reachability integration, and closed-loop recovery
remain in progress. The interface and layer boundaries above describe the
target integration path, while these limitations describe the present runtime.

The NLU package also includes an Ollama backend. When selected, it calls a
local Ollama model with a restricted response schema, then validates the model
output and owns the command metadata locally. See its package README for the
startup command and ROS parameters.

## Repository map

```text
schemas/                 Canonical JSON contracts
core/                    Testable, ROS-free decision library
ml/                      NLU datasets, model helpers, and training configs
ros2_ws/src/
  nora_interfaces/       Generated ROS interface source
  nora_nlu_node/         NLU service and topic publisher
  nora_affordance/       Scorer implementations
  nora_orchestrator/     Task state machine and action endpoint
  nora_skills/           Primitive action servers
  nora_description/      URDF/xacro arm model
  nora_moveit_config/    Kinematics and planning configuration
  nora_control/          ros2_control configuration
  nora_gazebo/           Tabletop simulation
  nora_isaac/            Isaac bridge stub
  nora_perception/       Perception package scaffold
docs/                    Setup, schemas, roadmap, and detailed notes
```

For a deeper treatment of contracts and score semantics, see
[`docs/intent_schema.md`](docs/intent_schema.md) and
[`docs/affordance_scoring.md`](docs/affordance_scoring.md).
