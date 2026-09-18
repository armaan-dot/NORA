# NORA Affordance Scoring

**Version:** 0.1.0  
**Status:** Draft

---

## Table of Contents

1. [Overview](#overview)
2. [Motivation: SayCan-Inspired Design](#motivation-saycan-inspired-design)
3. [Scoring Formula](#scoring-formula)
4. [Usefulness Score](#usefulness-score)
5. [Feasibility Score](#feasibility-score)
6. [Weighted Product Fusion](#weighted-product-fusion)
7. [Weight Selection Rationale](#weight-selection-rationale)
8. [Worked Example: "Pick up the red cube"](#worked-example-pick-up-the-red-cube)
9. [Threshold and Ranking](#threshold-and-ranking)
10. [Implementation Reference](#implementation-reference)
11. [Future Directions](#future-directions)

---

## Overview

NORA's Affordance Scoring Engine determines **which skills the robot should attempt** in response to a parsed intent. Rather than hard-coding a lookup table from action tokens to skill sequences, NORA computes a continuous score for every candidate skill, combining:

- **Usefulness**: How semantically relevant is this skill to the operator's intent?
- **Feasibility**: Can the robot physically succeed at this skill right now, given its current world state?

These two dimensions are fused into a single **combined score**, which is used to rank and filter candidate skills before the Planner assembles the final `SkillPlan`.

---

## Motivation: SayCan-Inspired Design

The design is inspired by **SayCan** (Ahn et al., 2022, Google Robotics). SayCan's central insight is that language model probabilities alone are insufficient for robotic manipulation — a skill can be *linguistically plausible* but *physically impossible* given the current robot state (e.g., "pick up the object" is impossible if the object is not visible).

SayCan proposes multiplying the language model probability of a skill (usefulness) with a value function representing physical feasibility (can the robot do it?). This product prevents the system from selecting semantically attractive but physically infeasible skills.

NORA generalizes this with:

1. **Pluggable usefulness models**: The usefulness score can come from a rule-based keyword match (Phase 1), a fine-tuned classifier (Phase 2), or a full language model scoring the skill given the utterance (Phase 3+).

2. **Pluggable feasibility models**: Feasibility can be a binary reachability check (Phase 1), a learned value function from RL rollouts (Phase 3), or a physics-based simulation check (Phase 4).

3. **Configurable fusion weights**: Operators can tune how much each dimension contributes via `nora_config.yaml`.

---

## Scoring Formula

```
combined_score = usefulness^w_u  ×  feasibility^w_f
```

Where:

| Symbol | Type | Range | Description |
|---|---|---|---|
| `usefulness` | float | [0, 1] | Semantic relevance of skill to intent |
| `feasibility` | float | [0, 1] | Estimated probability of physical success |
| `w_u` | float | (0, 1) | Usefulness weight |
| `w_f` | float | (0, 1) | Feasibility weight |
| `combined_score` | float | [0, 1] | Final fused score for ranking |

**Constraint:** `w_u + w_f = 1`  
**Defaults:** `w_u = 0.6`, `w_f = 0.4`

---

## Usefulness Score

### Definition

```
U(skill | intent) ∈ [0, 1]
```

The usefulness score answers: *"If the operator issued this intent, how useful would executing this skill be towards satisfying it?"*

### Phase 1: Rule-Based (Mock)

In Phase 1, the `MockUsefulnessModel` assigns scores by keyword matching between the intent `action` and the skill name:

```python
def score(self, skill_name: str, intent: dict) -> float:
    if skill_name == intent["action"]:
        return 0.85          # direct match
    elif skill_name in COMPOSITE_MAP.get(intent["action"], []):
        return 0.70          # sub-skill of a composite action
    else:
        return 0.15          # low relevance
```

### Phase 2: Classifier

A lightweight text classifier (`nora_core/affordance/usefulness_classifier.py`) is fine-tuned on annotated (utterance, skill, score) triples. Input: `[utterance, skill_description]` encoded with a sentence transformer. Output: scalar in [0, 1].

### Phase 3: LLM Scoring

The usefulness score is estimated by prompting an LLM:

```
Prompt: "Given the command '{utterance}', on a scale of 0 to 1, how useful 
         is the skill '{skill_description}' for completing the command?"
```

The LLM's calibrated probability for the skill token is used as the usefulness score (following the SayCan approach).

---

## Feasibility Score

### Definition

```
F(skill | world_state) ∈ [0, 1]
```

The feasibility score answers: *"Given what the robot can currently perceive and do, how likely is it that executing this skill will succeed?"*

### Phase 1: Heuristic Checks

Binary checks converted to floats:

| Check | Passing Score | Failing Score |
|---|---|---|
| Object detected in workspace | 0.90 | 0.05 |
| Pose reachable (IK exists) | 0.90 | 0.05 |
| Gripper not already holding object (for pick) | 0.90 | 0.10 |
| Gripper holding object (for place) | 0.90 | 0.10 |

Checks are ANDed multiplicatively:
```python
feasibility = reduce(lambda a, b: a * b, check_scores, 1.0)
```

### Phase 2: Learned Value Function

A value function `V(s, skill) → [0, 1]` is trained via RL rollouts in simulation. State `s` is encoded from the current joint positions, gripper state, and detected object poses. The value function is queried at inference time.

### Phase 3: Physics-Based Pre-check

MoveIt2's motion planning is queried in planning-only mode (no execution) to check trajectory feasibility. Success rate across `N` planning attempts gives a continuous feasibility estimate.

---

## Weighted Product Fusion

The `WeightedProductFusion` class combines usefulness and feasibility:

```python
class WeightedProductFusion:
    def __init__(self, weights: dict[str, float]):
        self.w_u = weights["usefulness"]
        self.w_f = weights["feasibility"]

    def fuse(self, usefulness: float, feasibility: float) -> float:
        return (usefulness ** self.w_u) * (feasibility ** self.w_f)
```

### Why Multiplicative?

The product form has several desirable properties:

1. **Hard veto**: If either score is zero, the combined score is zero regardless of the other. A skill that is physically impossible (`F=0`) never gets selected, no matter how semantically relevant it is.

2. **Smooth degradation**: As either score decreases from 1.0, the combined score degrades gracefully. This allows the planner to compare partially-feasible options.

3. **Interpretability**: The geometric mean interpretation is intuitive — both dimensions must be reasonably high for the combined score to be high.

4. **Numerical stability**: Both scores are already in [0, 1]; the product stays in [0, 1] without normalization.

### Why Exponentiation (Weighted Product)?

A simple product (`U × F`) weights both dimensions equally. Raising to fractional powers lets us control the *relative influence* of each dimension:

```
combined = U^0.6 × F^0.4
```

With `w_u = 0.6 > w_f = 0.4`, usefulness has slightly more influence. This reflects the Phase 1 assumption that semantic relevance is a stronger signal than the heuristic feasibility estimate. As the feasibility model matures (Phase 3+), weights can be rebalanced toward `w_f`.

**Comparison of fusion strategies:**

| Strategy | Formula | Property |
|---|---|---|
| Simple product | `U × F` | Equal weighting |
| Weighted product (default) | `U^w_u × F^w_f` | Configurable emphasis |
| Arithmetic weighted avg | `w_u·U + w_f·F` | No hard veto from zero |
| Min | `min(U, F)` | Pessimistic; bottleneck |
| Harmonic mean | `2·U·F / (U+F)` | Penalizes imbalance |

The weighted product is chosen as the default because it provides a hard veto while being configurable.

---

## Weight Selection Rationale

**Default: `w_u = 0.6`, `w_f = 0.4`**

In NORA's current phase (Phase 1–2), the usefulness model (rule-based or classifier) is more reliable than the feasibility model (heuristic checks). Giving usefulness slightly more weight (`0.6`) reflects this asymmetry.

As the system matures:

| Phase | Recommended `w_u` | Recommended `w_f` | Rationale |
|---|---|---|---|
| 1 (mock) | 0.6 | 0.4 | Rule-based feasibility is coarse |
| 2 (classifier) | 0.55 | 0.45 | Classifier still uncertain |
| 3 (LLM + value fn) | 0.5 | 0.5 | Both models mature |
| 4 (production) | 0.45 | 0.55 | Physics feasibility is high confidence |

Weights are tuned via offline evaluation on the benchmark task suite (`sim/benchmarks/task_suite.yaml`) by maximizing task success rate.

---

## Worked Example: "Pick up the red cube"

**Parsed Intent:**
```json
{
  "action": "pick",
  "target_object": "red_cube",
  "confidence": 0.95,
  "raw_utterance": "pick up the red cube"
}
```

**World State (mock):**
- `red_cube` detected at pose `(0.35, 0.0, 0.12)` in world frame.
- Gripper is open.
- IK solution exists for approach pose.

**Candidate Skills:** `[pick, place, go_home, open_gripper, close_gripper, move_to_pose]`

**Step 1 — Compute Usefulness Scores:**

| Skill | Usefulness Logic | U |
|---|---|---|
| `pick` | Direct action match | 0.85 |
| `open_gripper` | Sub-skill of `pick` composite | 0.70 |
| `close_gripper` | Sub-skill of `pick` composite | 0.70 |
| `move_to_pose` | Sub-skill of `pick` composite | 0.70 |
| `place` | Different action | 0.15 |
| `go_home` | Unrelated | 0.10 |

**Step 2 — Compute Feasibility Scores:**

All manipulation skills: `red_cube` is visible + reachable → F = 0.90 × 0.90 = 0.81  
`go_home`: Always feasible → F = 0.95  
`place`: Gripper not holding anything → F = 0.10

**Step 3 — Fuse (w_u = 0.6, w_f = 0.4):**

```
combined(pick)         = 0.85^0.6 × 0.81^0.4 = 0.905 × 0.924 = 0.836
combined(open_gripper) = 0.70^0.6 × 0.81^0.4 = 0.838 × 0.924 = 0.775
combined(close_gripper)= 0.70^0.6 × 0.81^0.4 = 0.838 × 0.924 = 0.775
combined(move_to_pose) = 0.70^0.6 × 0.81^0.4 = 0.838 × 0.924 = 0.775
combined(place)        = 0.15^0.6 × 0.10^0.4 = 0.312 × 0.251 = 0.078
combined(go_home)      = 0.10^0.6 × 0.95^0.4 = 0.251 × 0.980 = 0.246
```

**Step 4 — Rank and Filter (threshold = 0.3):**

```
Rank 1: pick          → 0.836  ✓ selected
Rank 2: open_gripper  → 0.775  ✓ selected
Rank 3: close_gripper → 0.775  ✓ selected
Rank 4: move_to_pose  → 0.775  ✓ selected
Rank 5: go_home       → 0.246  ✗ below threshold
Rank 6: place         → 0.078  ✗ below threshold
```

**Step 5 — Planner assembles SkillPlan:**

The Planner sees `pick` at rank 1 and knows it is a composite skill. It expands it:
```
SkillPlan: [open_gripper, move_to_pose, close_gripper]
```

---

## Threshold and Ranking

Skills with `combined_score < min_combined_score` (default `0.3`) are excluded from the plan. This prevents the robot from attempting skills that are both semantically irrelevant *and* physically difficult.

The Planner requests the top-K skills (default `K=3`) from the scorer, then decides whether to use the highest-ranked skill directly or expand a composite.

---

## Implementation Reference

| Class | File | Description |
|---|---|---|
| `AffordanceScore` | `core/nora_core/affordance/scoring.py` | Dataclass holding all score components |
| `UsefulnessModel` | `core/nora_core/affordance/usefulness.py` | Abstract base + mock implementation |
| `FeasibilityModel` | `core/nora_core/affordance/feasibility.py` | Abstract base + mock implementation |
| `WeightedProductFusion` | `core/nora_core/affordance/fusion.py` | Fusion operator |
| `AffordanceScorer` | `core/nora_core/affordance/scorer.py` | Orchestrates models + fusion |

---

## Future Directions

- **Temporal Affordance**: Extend feasibility to account for multi-step dependencies (e.g., `place` is only feasible *after* `pick` succeeds).
- **Uncertainty-Aware Scoring**: Propagate perception uncertainty into the feasibility score using probabilistic object detection confidences.
- **Online Weight Adaptation**: Use operator corrections to update `w_u` / `w_f` online via a Bayesian update.
- **Multi-Step Planning**: Integrate the affordance scorer into a tree search (MCTS) for long-horizon task planning.
