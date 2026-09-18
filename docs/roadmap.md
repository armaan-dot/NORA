# NORA Project Roadmap

**Version:** 0.1.0  
**Status:** Active Development

---

> [!NOTE]
> This roadmap is the technical expansion of the phases outlined in `README.md`. Each phase includes concrete goals, measurable success criteria, and estimated engineering effort.

---

## Phase 0 — Foundations *(Complete)*

**Theme:** Repository scaffold, tooling, CI

### Goals

- [x] Repository structure established (`core/`, `ros2_ws/`, `ml/`, `sim/`, `docs/`, `docker/`)
- [x] Python packaging configured (`pyproject.toml` for `nora_core`)
- [x] Core stub modules created with type hints and docstrings
- [x] GitHub Actions CI: lint (ruff), type-check (mypy), unit tests (pytest)
- [x] Docker images: `Dockerfile.ros`, `Dockerfile.ml`
- [x] VS Code devcontainer configured
- [x] Documentation stubs: architecture, intent schema, affordance scoring

### Success Criteria

| Criterion | Metric |
|---|---|
| CI passes on main branch | 100% green |
| All core stubs importable | `python3 -c "import nora_core"` exits 0 |
| Docker build succeeds | `docker compose build` exits 0 |

### Estimated Effort

~1 week (1 engineer)

---

## Phase 1 — Mock Pipeline *(In Progress)*

**Theme:** End-to-end mock pipeline with no hardware or LLM dependency

### Goals

- [ ] `MockRuleBasedParser` fully implemented and tested
- [ ] `Intent` Pydantic schema validated
- [ ] `WeightedProductFusion` fully implemented and tested
- [ ] `AffordanceScorer` with mock usefulness and feasibility models
- [ ] `Planner` producing `SkillPlan` from scored affordances
- [ ] `run_demo.sh --mock` executes full pipeline and prints results
- [ ] Benchmark suite (`task_suite.yaml`) runner implemented (`run_benchmark.py`)
- [ ] ≥5 benchmark tasks passing at ≥80% intent-match accuracy
- [ ] Integration test (`tests/test_e2e_mock.py`) passing in CI

### Technical Details

**Mock Parser:** Regex + keyword trie matching action tokens and object/location labels. No network dependency.

**Mock Usefulness Model:** Dictionary lookup — O(1), deterministic for testing.

**Mock Feasibility Model:** Returns configurable static scores per skill; world state is a hardcoded dict in tests.

**Planner:** Sorts `AffordanceScore` list by `combined_score` descending; returns top-K.

### Success Criteria

| Criterion | Metric |
|---|---|
| Mock parser intent accuracy | ≥80% on `task_suite.yaml` (5/5 tasks) |
| Demo script exit code | 0 |
| Integration test | All assertions pass |
| Benchmark runner output | Formatted table printed, accuracy reported |

### Estimated Effort

~2 weeks (1 engineer)

---

## Phase 2 — ROS 2 Integration *(Planned)*

**Theme:** Bring the pipeline into ROS 2; connect to a simulated arm in Gazebo

### Goals

- [ ] `nora_nlu_node` ROS 2 node publishing `Intent` on `/nora/intent`
- [ ] `nora_msgs` custom message definitions (`Intent.msg`, `SkillPlan.msg`, `WorldState.msg`)
- [ ] `nora_orchestrator` node subscribing to `/nora/intent`, running affordance scoring, publishing `SkillPlan`
- [ ] `nora_skills` node executing `SkillPlan` via MoveIt2 in Gazebo
- [ ] `nora_bringup` launch files: `demo.launch.py`, `sim.launch.py`
- [ ] UR5e URDF/xacro loaded in Gazebo
- [ ] `pick` skill executing `open_gripper → move_to_pose → close_gripper` in simulation
- [ ] RViz2 visualization of planned trajectories
- [ ] TF2 object frame publishing from mock world state

### Technical Details

**ROS 2 Node Architecture:**
```
nora_nlu_node       → /nora/intent          → nora_orchestrator_node
nora_orchestrator   → /nora/skill_plan      → nora_skills_node
nora_skills_node    → MoveIt2 action server → Gazebo arm
```

**MoveIt2 Integration:**
- `MoveGroupInterface` for Cartesian and joint-space planning
- `PlanningSceneInterface` for collision object management
- Approach pose computed from object TF2 frame + configurable offset

### Success Criteria

| Criterion | Metric |
|---|---|
| `ros2 topic echo /nora/intent` | Correct intent published for "pick up the red cube" |
| Gazebo arm completes pick task | Object lifted off table, gripper force nonzero |
| End-to-end latency | Command → motion start ≤ 5 seconds |
| No planning failures | ≥90% planning success rate across 20 runs |

### Estimated Effort

~4 weeks (2 engineers)

---

## Phase 3 — LLM NLU + Learned Affordances *(Planned)*

**Theme:** Replace mock components with real ML models

### Goals

- [ ] `OpenAIParser` / `LocalLLMParser` implemented and tested
- [ ] Prompt engineering: few-shot examples, output format enforcement (function calling)
- [ ] Classifier-based usefulness model trained on annotated task dataset
- [ ] Value function feasibility model trained via RL in Gazebo
- [ ] ML model inference server (`ml/serve.py`) with REST API
- [ ] `nora_ml_node` ROS 2 node calling ML inference server
- [ ] Offline dataset of (utterance, intent, outcome) tuples from Phase 2 telemetry
- [ ] LLM parser unit tests with VCR cassettes (no live API calls in CI)

### Technical Details

**LLM Parsing:**
- Use OpenAI function calling or structured output mode to enforce Intent schema.
- Fallback: if LLM confidence < threshold, fall back to rule-based parser.

**Usefulness Classifier:**
- Architecture: `sentence-transformers/all-MiniLM-L6-v2` encoder + MLP head.
- Training: supervised on (utterance, skill, score) dataset from Phase 2.
- Inference: ~5ms on CPU, ~1ms on GPU.

**Feasibility Value Function:**
- Architecture: MLP on (joint state, object poses, skill ID) → scalar.
- Training: PPO rollouts in Gazebo, reward = task success binary.
- Dataset: ~50k simulated episodes.

### Success Criteria

| Criterion | Metric |
|---|---|
| LLM parser accuracy | ≥95% on held-out utterance test set |
| Usefulness classifier | ≥88% accuracy on validation set |
| Affordance scorer task success rate | ≥85% on benchmark suite |
| LLM parser latency | ≤ 2s per utterance (cloud API) |

### Estimated Effort

~6 weeks (2 engineers + 1 ML engineer)

---

## Phase 4 — Physical Hardware *(Future)*

**Theme:** Deploy on a real robot arm

### Goals

- [ ] UR5e driver integration (`ur_robot_driver`) with ros2_control
- [ ] Safety layer: joint limit checking, velocity clamping, E-stop handler
- [ ] Real-sense D435i depth camera integration for 6-DOF object pose estimation
- [ ] Hand-eye calibration pipeline
- [ ] Grasping: GraspIt! or contact-GraspNet integration for grasp pose generation
- [ ] Operator UI: web dashboard for command input and camera feed
- [ ] Telemetry: Prometheus metrics + Grafana dashboard
- [ ] Deployment docs and runbooks

### Success Criteria

| Criterion | Metric |
|---|---|
| Pick task success (physical) | ≥80% across 50 trials, 5 objects |
| Place task success (physical) | ≥75% across 50 trials |
| E-stop response time | ≤ 100ms from trigger to arm halt |
| Camera pose estimation error | ≤ 5mm RMS |

### Estimated Effort

~8–12 weeks (2 engineers + hardware access)

---

## Cross-Cutting Concerns

These are tracked across all phases:

| Concern | Status |
|---|---|
| **Safety**: Joint limit enforcement | ⏳ Phase 2 |
| **Logging**: Structured JSON logs, `/nora/telemetry` topic | ⏳ Phase 2 |
| **Config**: All tunable params in `nora_config.yaml` | ✅ Phase 0 |
| **CI/CD**: GitHub Actions for lint, type, test | ✅ Phase 0 |
| **Documentation**: Architecture, schema, scoring docs | ✅ Phase 0/1 |
| **Benchmarking**: `task_suite.yaml` runner | ✅ Phase 1 |
| **Hardware abstraction**: Sim/physical swap via config | ⏳ Phase 2 |
