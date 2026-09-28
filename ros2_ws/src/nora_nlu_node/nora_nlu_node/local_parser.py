"""
nora_nlu_node/local_parser.py
──────────────────────────────
Local fine-tuned HuggingFace model backend for NLU.

Loads a text-generation model from *model_path*
(a local directory produced by ``transformers.Trainer.save_model()``).

Dependencies (install via pip):
  pip install transformers torch

Set the ``model_path`` ROS parameter to the directory containing
``config.json`` and ``pytorch_model.bin`` (or safetensors equivalent).
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

from nora_nlu_node.intent_parser import IntentParser

_SYSTEM_PROMPT = (
    "You are NORA's natural language understanding module. "
    "Output only one valid JSON object with fields: version, command_id, "
    "raw_text, action, target_object, target_location, parameters, confidence. "
    "The action must be one of pick, place, move_to_pose, open_gripper, "
    "close_gripper, go_home, unknown."
)
_ACTIONS = {
    "pick", "place", "move_to_pose", "open_gripper", "close_gripper",
    "go_home", "unknown",
}


class LocalFineTunedParser(IntentParser):
    """HuggingFace fine-tuned model backend.

    Parameters
    ----------
    model_path:
        Absolute path to the local model directory.
    """

    def __init__(self, model_path: str) -> None:
        if not model_path:
            raise ValueError("model_path must be set for the local NLU backend")
        if not os.path.isdir(model_path):
            raise FileNotFoundError(f"NLU model directory does not exist: {model_path}")

        try:
            from transformers import pipeline
            self._pipeline = pipeline(
                "text-generation",
                model=model_path,
                tokenizer=model_path,
            )
        except Exception as exc:
            raise RuntimeError(
                f"Could not load NLU model from '{model_path}': {exc}"
            ) from exc

    def parse(self, text: str) -> dict:
        """Parse *text* using the local fine-tuned model.

        Parameters
        ----------
        text:
            Raw natural-language command.

        Returns
        -------
        dict
            Keys: ``action``, ``target_object``, ``confidence``, ``raw_text``.
        """
        prompt = (
            f"<|im_start|>system\n{_SYSTEM_PROMPT}<|im_end|>\n"
            f"<|im_start|>user\n{text}<|im_end|>\n"
            "<|im_start|>assistant\n"
        )
        result = self._pipeline(prompt, max_new_tokens=256, do_sample=False)[0]
        generated = result.get("generated_text", "")
        payload = generated[len(prompt):] if generated.startswith(prompt) else generated
        return self._normalise_intent(self._parse_json(payload), text)

    @staticmethod
    def _parse_json(output: str) -> dict[str, Any]:
        start = output.find("{")
        end = output.rfind("}")
        if start < 0 or end < start:
            raise ValueError(f"NLU model did not return a JSON object: {output!r}")
        try:
            value = json.loads(output[start:end + 1])
        except json.JSONDecodeError as exc:
            raise ValueError(f"NLU model returned invalid JSON: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError("NLU model JSON output must be an object")
        return value

    @staticmethod
    def _normalise_intent(value: dict[str, Any], raw_text: str) -> dict[str, Any]:
        action = str(value.get("action", "unknown"))
        if action not in _ACTIONS:
            action = "unknown"
        confidence = float(value.get("confidence", 0.0))
        if not 0.0 <= confidence <= 1.0:
            raise ValueError("NLU confidence must be between 0.0 and 1.0")
        parameters = value.get("parameters", {})
        if not isinstance(parameters, dict):
            raise ValueError("NLU parameters must be a JSON object")
        return {
            "version": "1.0",
            "command_id": LocalFineTunedParser._valid_command_id(
                value.get("command_id")
            ),
            "raw_text": raw_text,
            "action": action,
            "target_object": value.get("target_object"),
            "target_location": value.get("target_location"),
            "parameters": parameters,
            "confidence": confidence,
        }

    @staticmethod
    def _valid_command_id(value: Any) -> str:
        if value:
            try:
                return str(uuid.UUID(str(value)))
            except ValueError:
                pass
        return str(uuid.uuid4())
