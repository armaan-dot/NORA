.PHONY: generate-data train evaluate export test

generate-data:
	python scripts/generate_synthetic_data.py

train:
	bash scripts/train.sh

evaluate:
	bash scripts/evaluate.sh

export:
	bash scripts/export_merged_model.sh

test:
	pytest tests/ -v
