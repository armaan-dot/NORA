<div align="center">

# NORA

### Natural Language Orchestrated Robotics Agent

*Plain English → Structured Intent → Affordance Scoring → Robot Arm*

[![ROS 2 Humble](https://img.shields.io/badge/ROS%202-Humble-blue?logo=ros)](https://docs.ros.org/en/humble/)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python)](https://python.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![CI](https://github.com/your-org/nora/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/nora/actions/workflows/ci.yml)

</div>

---

## What is NORA?

NORA is a robotics framework that lets you control a robot arm by talking to it the way you'd talk to a person.

Instead of writing low-level motion code, you give it a command like:

```
"Pour me some Water in the glass"
```

NORA figures out what that means, checks whether it's physically possible, picks the right sequence of actions, and sends them to a ROS 2 arm — all without you specifying a single joint angle.

The system is built around three ideas:

1. **Language is the interface.** A fine-tuned language model converts free-form text into a structured intent JSON that the rest of the system can act on. The model is a swappable component behind a clean interface; you can run a mock rule-based parser during development and drop in a real fine-tuned model when you're ready.

2. **Actions are scored before they're executed.** Inspired by SayCan, every candidate skill is evaluated against two questions — *is this action useful given the command?* and *is it physically feasible right now?* — before the orchestrator commits to a plan. This keeps the robot from attempting grasps out of reach or placing objects in occupied spots.

3. **ROS 2 is the backbone.** Everything that touches the arm goes through standard ROS 2 interfaces: action servers for long-running skills, services for synchronous queries, and topics for state. MoveIt 2 handles motion planning; Gazebo and NVIDIA Isaac Sim are the simulation targets.

---

## Pipeline

```
Human text
    │
    ▼
┌─────────────────────┐
│   NLU Node          │  ParseCommand service
│   (LLM / Mock)      │  → Intent JSON
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Affordance Node    │  ScoreAffordances service
│  usefulness × feas. │  → ranked AffordanceScore[]
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Orchestrator      │  ExecuteIntent action server
│   (state machine)   │  → skill sequence
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
 pick          move_to_pose        ... (skill action servers)
    │
    ▼
┌──────────────────────┐
│  MoveIt 2 / ROS 2    │
│  joint_trajectory    │
└──────────────────────┘
           │
           ▼
    NORA Arm (Gazebo / Isaac / Physical)
```

---

## Repository Layout

```
nora/
├── schemas/                     # Single source of truth for all data contracts
│   ├── intent.schema.json       #   Intent: action, object, location, confidence
│   ├── skill_registry.schema.json
│   └── affordance_score.schema.json
│
├── core/                        # Pure Python, zero ROS dependency
│   └── nora_core/               #   Intent models, affordance fusion, planner, interfaces
│
├── ros2_ws/src/
│   ├── nora_interfaces/         # All ROS 2 msgs / srvs / actions
│   ├── nora_description/        # URDF/xacro 6-DOF arm + gripper
│   ├── nora_gazebo/             # Tabletop world, Gazebo launch
│   ├── nora_isaac/              # Isaac Sim bridge (stub)
│   ├── nora_moveit_config/      # SRDF, kinematics, OMPL, controllers
│   ├── nora_control/            # ros2_control YAML, controller launch
│   ├── nora_nlu_node/           # NLU ROS node (mock + fine-tuned backends)
│   ├── nora_affordance/         # Affordance scoring node + combiner
│   ├── nora_skills/             # Primitive skill action servers
│   ├── nora_orchestrator/       # State machine, skill sequencing, replanning
│   ├── nora_perception/         # Mock object-pose publisher (replaceable)
│   └── nora_bringup/            # Launch files: sim, full stack, demo
│
├── ml/                          # Fine-tuning blueprint (LoRA / QLoRA, TRL)
│   ├── configs/                 #   Hydra: model, training, data, eval
│   ├── src/nora_nlu/            #   Dataset, models, training, inference, eval
│   └── data/examples/           #   seed_commands.jsonl — 15 labelled examples
│
├── sim/
│   ├── gazebo/                  # Extra worlds and models
│   ├── isaac/                   # USD scenes, Isaac ROS 2 bridge notes
│   └── benchmarks/              # task_suite.yaml + run_benchmark.py
│
├── docs/                        # Architecture, schema docs, setup guide, roadmap
├── docker/                      # Dockerfile.ros, Dockerfile.ml, docker-compose.yml
└── scripts/                     # setup_ubuntu.sh, build.sh, run_demo.sh, …
```

---

## Getting Started

### Prerequisites

- Ubuntu 22.04
- ROS 2 Humble
- Python 3.10+
- Gazebo (Classic or Harmonic)
- MoveIt 2

```bash
# Install ROS 2 Humble + dependencies
bash scripts/setup_ubuntu.sh
bash scripts/install_ros.sh

# Install Python dev dependencies
pip install -e ".[dev]"
pip install -e core/
```

### Build the ROS 2 workspace

```bash
make build-ros
source ros2_ws/install/setup.bash
```

### Run the mock demo

The mock demo runs the complete pipeline without a GPU or a physical arm. The mock NLU parser uses keyword rules; the mock perception node publishes fixed object poses.

```bash
make demo-mock
```

You'll see:

```
=== NORA Mock Demo ===
Command: pick up the red cube
Intent: {'action': 'pick', 'target_object': 'red_cube', 'confidence': 0.85, ...}
  Affordance [pick]:          usefulness=0.85  feasibility=0.90  combined=0.878
  Affordance [place]:         usefulness=0.20  feasibility=0.90  combined=0.422
  Affordance [go_home]:       usefulness=0.20  feasibility=0.90  combined=0.422
  Affordance [open_gripper]:  usefulness=0.20  feasibility=0.90  combined=0.422
Skill Plan: ['pick', 'place', 'go_home']
=== Demo Complete ===
```

### Run all checks

```bash
make check   # lint + pytest (core + ml) + colcon build + colcon test
```

### Launch the Gazebo simulation

```bash
make build-ros
ros2 launch nora_bringup sim_gazebo.launch.py
```

### Launch the full stack

```bash
ros2 launch nora_bringup full_stack.launch.py
```

---

## Intent Schema

Every command is translated into an Intent JSON object. This schema is the contract between the NLU, affordance scorer, orchestrator, and ML training pipeline.

```json
{
  "version": "1.0",
  "command_id": "550e8400-e29b-41d4-a716-446655440001",
  "raw_text": "pick up the red cube",
  "action": "pick",
  "target_object": "red_cube",
  "target_location": null,
  "parameters": {},
  "confidence": 0.92
}
```

Supported actions: `pick`, `place`, `move_to_pose`, `open_gripper`, `close_gripper`, `go_home`, `unknown`.

Full schema: [`schemas/intent.schema.json`](schemas/intent.schema.json). Documentation: [`docs/intent_schema.md`](docs/intent_schema.md).

---

## Affordance Scoring

For each candidate skill, NORA computes:

```
combined_score = usefulness^w_u × feasibility^w_f
```

where:
- **usefulness** — how well the skill serves the stated intent (LLM-scored)
- **feasibility** — whether the skill can physically succeed right now (IK reachability + collision check + object state)
- **w_u, w_f** — configurable weights (default 0.6 / 0.4)

The orchestrator runs the highest-scoring feasible skill first. If it fails, the replanning hook kicks in.

Weights live in [`ros2_ws/src/nora_affordance/config/weights.yaml`](ros2_ws/src/nora_affordance/config/weights.yaml).
Full explanation: [`docs/affordance_scoring.md`](docs/affordance_scoring.md).

---

## NLU Backends

The `nora_nlu_node` wraps any NLU implementation behind a single interface:

```python
class IntentParser(ABC):
    def parse(self, text: str) -> dict: ...
```

| Backend | When to use |
|---------|-------------|
| `MockRuleBasedParser` | Development, CI, offline testing |
| `LocalFineTunedParser` | After fine-tuning with `ml/` (LoRA checkpoint) |

Switch backends via the `backend` ROS 2 parameter in [`config/nlu.yaml`](ros2_ws/src/nora_nlu_node/config/nlu.yaml).

---

## ML Fine-Tuning

The `ml/` directory is a self-contained blueprint for fine-tuning a small LLM (Qwen-2.5-1.5B, Llama-3.2-1B, or similar) on robot command→intent pairs using LoRA/QLoRA and the TRL SFTTrainer.

```bash
cd ml/
make generate-data   # generate 200 synthetic command→intent pairs
make train           # run LoRA fine-tuning (requires GPU)
make evaluate        # intent accuracy, slot F1, schema-valid rate, latency
make export          # merge LoRA weights into a single checkpoint
```

Training data format matches [`schemas/intent.schema.json`](schemas/intent.schema.json). Seed examples: [`ml/data/examples/seed_commands.jsonl`](ml/data/examples/seed_commands.jsonl).

---

## Development

```bash
# Lint + format
make lint
make format

# Run unit tests
make test-core   # pytest core/tests/
make test-ml     # pytest ml/tests/

# Pre-commit hooks
pre-commit install
pre-commit run --all-files
```

### Docker

```bash
# ROS 2 environment
docker compose up ros

# ML training environment (GPU)
docker compose up ml
```

Dev container config for VS Code: [`docker/.devcontainer/devcontainer.json`](docker/.devcontainer/devcontainer.json).

---

## Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | Monorepo skeleton, schemas, core library, CI | ✅ Done |
| 2 | ROS 2 interface layer, mock end-to-end demo | ✅ Done |
| 3 | Real MoveIt 2 motion planning, Gazebo grasping | 🔧 In progress |
| 4 | Fine-tuned NLU model, full ML pipeline | ⬜ Planned |
| 5 | Real perception (depth camera, object detection) | ⬜ Planned |
| 6 | Closed-loop replanning, failure recovery | ⬜ Planned |
| 7 | NVIDIA Isaac Sim, physical arm deployment | ⬜ Planned |

Detailed roadmap: [`docs/roadmap.md`](docs/roadmap.md).

---

## Architecture

Full architecture writeup: [`docs/architecture.md`](docs/architecture.md)
Setup guide (Ubuntu 22.04): [`docs/setup_linux.md`](docs/setup_linux.md)

---

## Contributing

1. Fork the repo and create a feature branch
2. Run `pre-commit install` so hooks run on each commit
3. Make sure `make check` passes before opening a PR
4. Keep commits scoped — one logical change per commit

---

## License

MIT — see [`LICENSE`](LICENSE).
