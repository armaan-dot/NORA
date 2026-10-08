"""Inference parser for NORA NLU.

Provides a clean runtime interface to parse text into validated Intent dicts.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from nora_nlu.model import NLUModel

_DEFAULT_MODEL_PATH = (
    Path(__file__).parent.parent.parent / "models" / "nora_nlu_model.json"
)


class NLUParser:
    """Parser that loads a trained NLUModel and performs inference."""

    def __init__(self, model_path: str | Path | None = None) -> None:
        self.model = NLUModel()
        path = Path(model_path) if model_path else _DEFAULT_MODEL_PATH
        if path.is_file():
            self.model.load(path)
        else:
            # Fallback: fit on seed data if model file doesn't exist yet
            from nora_nlu.dataset import generate_dataset
            self.model.fit(generate_dataset(num_samples=200))

    def parse(self, text: str) -> dict[str, Any]:
        """Parse natural language command into structured intent dict."""
        return self.model.predict(text)
