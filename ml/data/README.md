# Data Directory — NORA NLU

This directory holds all data used for fine-tuning and evaluating the NLU model.
**Do not commit raw datasets or processed splits to git.** All data files are tracked with [DVC](https://dvc.org/).

## Sub-directories

| Dir | Purpose |
|-----|---------|
| `raw/` | Original collected command data — human-labelled JSONL files as received from annotators or data collection pipelines. Never modify these. |
| `interim/` | Intermediate artifacts from preprocessing steps — deduplication, normalisation, schema coercion. |
| `processed/` | Final `train.jsonl`, `val.jsonl`, `test.jsonl` splits ready for `SFTTrainer`. |
| `synthetic/` | Synthetically generated examples produced by `SyntheticGenerator`. Used to augment small real datasets. |
| `examples/` | Hand-crafted seed commands used for development, prompt engineering, and testing. Safe to commit. |

## DVC Usage

```bash
# Pull latest data from remote
dvc pull

# Push local data to remote after adding new files
dvc add data/raw/new_batch.jsonl
dvc push
```

> **Note:** DVC remote configuration lives in `.dvc/config` (not yet set up — TODO(nora)).
