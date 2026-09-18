# NORA ML — NLU Fine-Tuning Module

This module contains everything needed to fine-tune a small LLM to parse natural language robot commands into structured **intent JSON** for the NORA robotic-arm system.

---

## Overview

| Item | Detail |
|------|--------|
| **Task** | Instruction → Intent JSON (action, target_object, target_location, parameters) |
| **Base models** | Qwen2.5-1.5B-Instruct · Llama-3.2-1B-Instruct |
| **Fine-tuning method** | LoRA / QLoRA via 🤗 PEFT + TRL `SFTTrainer` |
| **Config system** | [Hydra](https://hydra.cc/) (see `configs/`) |
| **Data versioning** | [DVC](https://dvc.org/) — never commit raw datasets |
| **Experiment tracking** | MLflow (local) |

---

## Inputs / Outputs

```
Input  : raw natural-language instruction string
         e.g. "pick up the red cube and place it on the shelf"

Output : intent JSON validated against ../../schemas/intent.schema.json
         {
           "version": "1.0",
           "command_id": "<uuid4>",
           "raw_text": "...",
           "action": "pick",
           "target_object": "red_cube",
           "target_location": "shelf",
           "parameters": {},
           "confidence": 0.97
         }
```

---

## Directory Structure

```
ml/
├── configs/          # Hydra YAML configs (model, train, data, eval)
├── data/             # DVC-managed data directories
│   ├── raw/          # Original collected data
│   ├── interim/      # Intermediate processing artifacts
│   ├── processed/    # Train/val/test splits ready for training
│   ├── synthetic/    # Synthetically generated examples
│   └── examples/     # Seed commands for bootstrapping
├── experiments/      # MLflow run artifacts & evaluation results
├── models/           # Exported / merged model weights
├── notebooks/        # Exploration & analysis notebooks
├── scripts/          # Shell & Python entry-point scripts
├── src/nora_nlu/     # Core Python package
│   ├── data/         # Dataset loading, validation, splits, synthetic gen
│   ├── models/       # Model wrappers, tokenizer utils, prompt templates
│   ├── training/     # Trainer, callbacks, training-arg builders
│   ├── inference/    # NLUParser, FastAPI serving
│   ├── eval/         # Metrics, evaluation runner, error analysis
│   └── utils/        # Logging, seeding, config helpers
└── tests/            # pytest test suite
```

---

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Generate synthetic training data
make generate-data

# 3. Train (LoRA on Qwen2.5-1.5B)
make train

# 4. Evaluate
make evaluate

# 5. Export merged model
make export
```

---

## Key Technologies

- **LoRA / QLoRA** — Parameter-efficient fine-tuning via `peft`. QLoRA adds 4-bit quantisation (`bitsandbytes`) to fit on smaller GPUs.
- **TRL SFTTrainer** — Handles supervised fine-tuning with packing, formatting, and PEFT integration out of the box.
- **Hydra** — Composable config system; swap model or training strategy with `+model=llama_small`.
- **DVC** — Data version control; data files are tracked with `.dvc` pointers, not stored in git.
- **MLflow** — Logs hyperparameters, metrics, and model artefacts per run under `experiments/`.

---

## TODO

- [ ] TODO(nora): Collect real human-labelled command dataset
- [ ] TODO(nora): Add DVC remote (S3 / GCS) and `.dvc/config`
- [ ] TODO(nora): Add ONNX / llama.cpp export pipeline
- [ ] TODO(nora): Integrate W&B as alternative experiment tracker
- [ ] TODO(nora): Add constrained decoding (outlines / guidance) to inference
- [ ] TODO(nora): CI/CD pipeline for automated retraining on new data
