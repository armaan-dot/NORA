# nora-core

`nora_core` is a **ROS-free, pure-Python** library that forms the cognitive backbone of the NORA robotic manipulation system.

It is intentionally decoupled from ROS so that the same code can run in:
- ROS 2 nodes (imported as a normal Python package)
- Offline ML training / fine-tuning scripts
- Unit tests on any developer machine without a ROS install

## Package layout

```
nora_core/
├── __init__.py          # Public API surface
├── intent.py            # Pydantic Intent model
├── skills.py            # SkillDefinition + SkillRegistry
├── interfaces.py        # Abstract base classes (IntentParser, AffordanceScorer)
├── planner.py           # SkillPlan dataclass + Planner
└── affordance/
    ├── __init__.py
    ├── scoring.py       # AffordanceScore dataclass + BaseScorer ABC
    ├── fusion.py        # WeightedProductFusion
    └── metrics.py       # AffordanceMetricsLogger (CSV logging stub)
```

## Data flow

```
raw text (str)
    │
    ▼  IntentParser.parse()
Intent (validated Pydantic model)
    │
    ▼  AffordanceScorer.score()  ×  N skills
list[AffordanceScore]
    │
    ▼  Planner.rank_skills()
list[SkillPlan]   ──►  dispatched to ROS action servers
```

## Inputs / Outputs

| Stage | Input | Output |
|---|---|---|
| Intent parsing | Raw text string or intent dict/JSON | Validated `Intent` object |
| Affordance scoring | `Intent` + skill name | `AffordanceScore` (usefulness, feasibility, combined) |
| Planning | `Intent` + `list[AffordanceScore]` | `list[SkillPlan]` sorted by score descending |

## Installation

```bash
pip install -e core/   # from the NORA repo root
```

## Requirements

- Python ≥ 3.10
- pydantic ≥ 2.0
- jsonschema ≥ 4.0
