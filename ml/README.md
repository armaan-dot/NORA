# NORA ML — Natural Language Understanding (NLU) Module

This module contains the self-contained Machine Learning model that parses natural-language robot commands into structured **intent JSON** for the NORA robotic-arm system.

---

## Highlights

- **Zero-Dependency Inference:** Runs in pure Python 3.10 with standard library. No Ollama, no heavy PyTorch/CUDA downloads required.
- **Pre-Trained Model Included:** `models/nora_nlu_model.json` is bundled ready to use out of the box.
- **Commonsense & Indirect Reasoning:** Supports both direct commands (*"pick up the red cube"*) and indirect commonsense requests (*"I am thirsty"* $\rightarrow$ picks water, *"give me the glass"* $\rightarrow$ picks glass).
- **Fast:** Inference runs in **< 1 ms** on any standard CPU.

---

## Directory Structure

```
ml/
├── data/
│   └── examples/
│       └── seed_commands.jsonl     # Hand-crafted command-intent training pairs
├── models/
│   └── nora_nlu_model.json         # Pre-trained model weights (108 KB)
├── src/
│   └── nora_nlu/
│       ├── __init__.py             # Public API exports
│       ├── dataset.py              # Synthetic & seed dataset generator
│       ├── model.py                # Statistical ML intent classifier & entity extractor
│       └── inference.py            # Runtime NLUParser
├── tests/
│   └── test_nlu_model.py           # Unit tests
├── train.py                        # Standalone 1-command trainer
├── evaluate.py                     # Evaluation benchmark script
├── Makefile                        # Convenience commands
└── requirements.txt                # Lightweight requirements
```

---

## Quick Start

### 1. Evaluate the Pre-Trained Model
```bash
python evaluate.py
```

### 2. Train / Retrain Model
```bash
python train.py
```
This generates diverse training pairs, fits the ML model, and saves weights to `models/nora_nlu_model.json`.

### 3. Run Tests
```bash
pytest tests/ -v
```

---

## Python Usage Example

```python
from nora_nlu.inference import NLUParser

parser = NLUParser()

# Direct command
intent = parser.parse("pick up the red cube from the table")
print(intent)
# -> {'action': 'pick', 'target_object': 'red_cube', 'target_location': 'table', ...}

# Commonsense command
intent = parser.parse("I am thirsty")
print(intent)
# -> {'action': 'pick', 'target_object': 'water', 'target_location': 'user', ...}
```
