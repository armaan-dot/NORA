"""Local Ollama backend for converting natural-language commands to Intent.

The parser uses Ollama's local ``/api/chat`` endpoint with a JSON schema.  The
model generates structured data, while this module remains the final trust
boundary: it validates every field and supplies command metadata itself.
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from nora_nlu_node.intent_parser import IntentParser

_ACTIONS = {
    "pick", "place", "move_to_pose", "open_gripper", "close_gripper", "go_home", "unknown",
}
_REQUIRED_FIELDS = {"action", "target_object", "target_location", "parameters", "confidence"}
_INTENT_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": sorted(_REQUIRED_FIELDS),
    "properties": {
        "action": {"type": "string", "enum": sorted(_ACTIONS)},
        "target_object": {"type": ["string", "null"]},
        "target_location": {"type": ["string", "null"]},
        "parameters": {"type": "object"},
        "confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
    },
}
_SYSTEM_PROMPT = """Translate a user's robot-arm request into one JSON object.
Use only the supplied schema. Select unknown when the request cannot be mapped
to one action. Do not invent an object or location; use null when absent.
Confidence is language-understanding confidence, not physical feasibility."""


class OllamaParserError(RuntimeError):
    """Raised when Ollama cannot return a valid NORA intent."""


class OllamaParser(IntentParser):
    """Parse robot commands with a model served by a local Ollama instance."""

    def __init__(
        self,
        model: str = "qwen2.5:1.5b",
        host: str = "http://localhost:11434",
        timeout_seconds: float = 30.0,
    ) -> None:
        if not model.strip():
            raise ValueError("Ollama model must not be empty")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero")
        self._model = model
        self._url = f"{host.rstrip('/')}/api/chat"
        self._timeout_seconds = timeout_seconds

    def parse(self, text: str) -> dict[str, Any]:
        """Return a validated Intent dictionary for *text*."""
        if not text or not text.strip():
            raise ValueError("Command text must not be empty")
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            "format": _INTENT_RESPONSE_SCHEMA,
            "stream": False,
            "options": {"temperature": 0},
        }
        request = Request(
            self._url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:  # noqa: S310
                body = json.loads(response.read().decode("utf-8"))
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise OllamaParserError(f"Could not call local Ollama at {self._url}: {exc}") from exc
        try:
            generated = json.loads(body["message"]["content"])
        except (KeyError, TypeError, json.JSONDecodeError) as exc:
            raise OllamaParserError("Ollama response did not contain valid JSON intent data") from exc
        return self._validate_and_enrich(generated, text)

    @staticmethod
    def _validate_and_enrich(generated: Any, raw_text: str) -> dict[str, Any]:
        """Validate model fields and attach metadata that NORA owns."""
        if not isinstance(generated, dict):
            raise OllamaParserError("Ollama intent must be a JSON object")
        if set(generated) != _REQUIRED_FIELDS:
            raise OllamaParserError("Ollama intent fields do not match the required NORA schema")
        action = generated["action"]
        target_object = generated["target_object"]
        target_location = generated["target_location"]
        parameters = generated["parameters"]
        confidence = generated["confidence"]
        if action not in _ACTIONS:
            raise OllamaParserError(f"Unsupported action returned by Ollama: {action!r}")
        if not isinstance(target_object, (str, type(None))):
            raise OllamaParserError("target_object must be a string or null")
        if not isinstance(target_location, (str, type(None))):
            raise OllamaParserError("target_location must be a string or null")
        if not isinstance(parameters, dict):
            raise OllamaParserError("parameters must be an object")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            raise OllamaParserError("confidence must be a number")
        if not 0.0 <= float(confidence) <= 1.0:
            raise OllamaParserError("confidence must be between 0.0 and 1.0")
        return {
            "version": "1.0",
            "command_id": str(uuid.uuid4()),
            "raw_text": raw_text,
            "action": action,
            "target_object": target_object,
            "target_location": target_location,
            "parameters": parameters,
            "confidence": float(confidence),
        }
