.PHONY: train evaluate test clean

train:
	python train.py

evaluate:
	python evaluate.py

test:
	pytest tests/ -v

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
