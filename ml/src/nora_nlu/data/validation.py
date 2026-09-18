"""
nora_nlu.data.validation
=========================
JSON Schema validation helpers for NORA intent dicts.

Loads the canonical ``intent.schema.json`` from the shared schemas directory
and validates single or batches of intent dicts against it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import jsonschema
from jsonschema import Draft7Validator, ValidationError


# ── Schema loading ──────────────────────────────────────────────────────────────

def _find_schema() -> dict:
    """Locate and load ``intent.schema.json``.

    Searches relative to this file's location:
    ``ml/src/nora_nlu/data/ → ../../schemas/intent.schema.json``
    which resolves to ``NORA/schemas/intent.schema.json``.

    Returns
    -------
    dict
        Parsed JSON schema.

    Raises
    ------
    FileNotFoundError
        If the schema cannot be found at the expected path.
    """
    # This file lives at: ml/src/nora_nlu/data/validation.py
    # Schema lives at:    NORA/schemas/intent.schema.json
    # Relative path:      ../../../../schemas/intent.schema.json  (4 levels up)
    candidate = Path(__file__).parent.parent.parent.parent.parent / "schemas" / "intent.schema.json"
    if candidate.exists():
        with candidate.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    # Fallback: walk up looking for schemas/intent.schema.json
    for parent in Path(__file__).parents:
        schema_path = parent / "schemas" / "intent.schema.json"
        if schema_path.exists():
            with schema_path.open("r", encoding="utf-8") as fh:
                return json.load(fh)

    raise FileNotFoundError(
        "Could not locate intent.schema.json. "
        "Expected at NORA/schemas/intent.schema.json"
    )


# Cached validator — loaded once per process
_VALIDATOR: Optional[Draft7Validator] = None


def _get_validator() -> Draft7Validator:
    """Return (or build) the cached :class:`Draft7Validator`."""
    global _VALIDATOR  # noqa: PLW0603
    if _VALIDATOR is None:
        schema = _find_schema()
        _VALIDATOR = Draft7Validator(schema)
    return _VALIDATOR


# ── Public API ──────────────────────────────────────────────────────────────────

def validate_intent(intent_dict: dict) -> bool:
    """Validate a single intent dict against the NORA intent JSON schema.

    Parameters
    ----------
    intent_dict:
        A parsed intent object to validate.

    Returns
    -------
    bool
        ``True`` if the intent is valid, ``False`` otherwise.

    Example
    -------
    >>> from nora_nlu.data.validation import validate_intent
    >>> validate_intent({"version": "1.0", "action": "pick", ...})
    True
    """
    try:
        _get_validator().validate(intent_dict)
        return True
    except ValidationError:
        return False


def validate_batch(
    intents: list[dict],
) -> tuple[int, int, list[str]]:
    """Validate a list of intent dicts and collect error messages.

    Parameters
    ----------
    intents:
        List of intent dicts to validate.

    Returns
    -------
    tuple[int, int, list[str]]
        A 3-tuple of ``(valid_count, invalid_count, errors)`` where
        ``errors`` contains one human-readable string per invalid intent.

    Example
    -------
    >>> valid, invalid, errors = validate_batch(intents)
    >>> print(f"{valid} valid, {invalid} invalid")
    """
    validator = _get_validator()
    valid_count = 0
    invalid_count = 0
    errors: list[str] = []

    for idx, intent in enumerate(intents):
        try:
            validator.validate(intent)
            valid_count += 1
        except ValidationError as exc:
            invalid_count += 1
            errors.append(f"[index {idx}] {exc.message}")

    return valid_count, invalid_count, errors
