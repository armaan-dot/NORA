"""Train script for NORA Natural Language Understanding (NLU) model.

Usage:
    python ml/train.py
"""

from __future__ import annotations

from pathlib import Path
import sys

# Ensure src is on sys.path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from nora_nlu.dataset import generate_dataset  # noqa: E402
from nora_nlu.model import NLUModel  # noqa: E402


def main() -> None:
    print("=" * 60)
    print("NORA NLU Model Training")
    print("=" * 60)

    # 1. Generate dataset (including direct and commonsense examples)
    print("1. Generating dataset with direct & commonsense intents...")
    dataset = generate_dataset(num_samples=5000, seed=42)
    print(f"   Total training examples generated: {len(dataset)}")

    # Split 80/20 train/val
    split_idx = int(0.8 * len(dataset))
    train_data = dataset[:split_idx]
    val_data = dataset[split_idx:]
    print(f"   Train samples: {len(train_data)} | Val samples: {len(val_data)}")

    # 2. Train model
    print("\n2. Training Statistical ML Intent & Slot Model...")
    model = NLUModel()
    model.fit(train_data)
    print(f"   Vocabulary size: {len(model.vocabulary)}")
    print(f"   Known objects: {len(model.known_objects)}")
    print(f"   Known locations: {len(model.known_locations)}")

    # 3. Validation evaluation
    print("\n3. Evaluating on Validation Set...")
    correct_actions = 0
    for sample in val_data:
        pred = model.predict(sample["instruction"])
        expected = sample["intent"]["action"]
        if pred["action"] == expected:
            correct_actions += 1

    accuracy = correct_actions / len(val_data)
    print(f"   Validation Action Accuracy: {accuracy * 100:.2f}% ({correct_actions}/{len(val_data)})")

    # 4. Save trained model
    output_path = Path(__file__).parent / "models" / "nora_nlu_model.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    model.save(output_path)
    print(f"\n4. Successfully saved trained model to: {output_path.resolve()}")

    # 5. Benchmark sample predictions
    test_queries = [
        "give me the glass",
        "I am thirsty",
        "pick up the red cube from the table",
        "put the green block in the bin",
        "open the gripper",
        "close gripper tightly",
        "go home",
        "move to coordinates 0.3, 0.1, 0.5",
    ]
    print("\n5. Sample Benchmark Predictions:")
    print("-" * 60)
    for q in test_queries:
        res = model.predict(q)
        print(f"Query  : '{q}'")
        print(f"Result : action={res['action']}, object={res['target_object']}, loc={res['target_location']}, conf={res['confidence']}")
        print("-" * 60)

    print("\nTraining complete! The model is ready to run without external dependencies.")


if __name__ == "__main__":
    main()
