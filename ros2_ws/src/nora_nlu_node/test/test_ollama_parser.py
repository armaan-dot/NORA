"""Tests for the Ollama NLU backend without a running Ollama server."""

import json
from unittest.mock import patch

import pytest

from nora_nlu_node.ollama_parser import OllamaParser, OllamaParserError


class _Response:
    def __init__(self, body: dict) -> None:
        self._body = body

    def read(self) -> bytes:
        return json.dumps(self._body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None


def _response(intent: dict) -> dict:
    return {"message": {"content": json.dumps(intent)}}


def test_parse_enriches_a_schema_valid_ollama_response() -> None:
    generated = {
        "action": "pick", "target_object": "red_cube", "target_location": None,
        "parameters": {}, "confidence": 0.91,
    }
    with patch("nora_nlu_node.ollama_parser.urlopen", return_value=_Response(_response(generated))):
        result = OllamaParser().parse("Please grab the little red block")
    assert result["action"] == "pick"
    assert result["raw_text"] == "Please grab the little red block"
    assert result["version"] == "1.0"
    assert result["confidence"] == pytest.approx(0.91)
    assert result["command_id"]


def test_parse_rejects_an_unsupported_action() -> None:
    generated = {
        "action": "pour", "target_object": "water", "target_location": None,
        "parameters": {}, "confidence": 0.9,
    }
    with patch("nora_nlu_node.ollama_parser.urlopen", return_value=_Response(_response(generated))):
        with pytest.raises(OllamaParserError, match="Unsupported action"):
            OllamaParser().parse("Pour water")
