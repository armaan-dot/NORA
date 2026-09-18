"""
nora_nlu.models.prompt_templates
==================================
System prompts and prompt-building utilities for NORA NLU training and
inference.

The model is trained to map natural language commands → intent JSON that
conforms to ``intent.schema.json``.
"""

from __future__ import annotations

import json

# ── System prompt ───────────────────────────────────────────────────────────────

SYSTEM_PROMPT: str = (
    "You are NORA's natural language understanding module. "
    "Your task is to parse a natural language robot command and output a "
    "single valid JSON object conforming to the NORA intent schema.\n\n"
    "The JSON must have these fields:\n"
    "  version        (string, always \"1.0\")\n"
    "  command_id     (UUID v4 string)\n"
    "  raw_text       (the original instruction, verbatim)\n"
    "  action         (one of: pick, place, move_to_pose, open_gripper, close_gripper, go_home)\n"
    "  target_object  (string or null)\n"
    "  target_location (string or null)\n"
    "  parameters     (object, may be empty {})\n"
    "  confidence     (float between 0.0 and 1.0)\n\n"
    "Output ONLY the JSON object — no explanation, no markdown code fences."
)


# ── Prompt builders ─────────────────────────────────────────────────────────────

def build_training_prompt(instruction: str, intent_json: dict) -> str:
    """Build a full supervised fine-tuning prompt (input + expected output).

    Used by the dataset formatter passed to ``SFTTrainer``. The model is
    trained to produce the JSON completion given the system + user turn.

    Parameters
    ----------
    instruction:
        Raw natural language robot command.
    intent_json:
        Ground-truth intent dict.

    Returns
    -------
    str
        Complete prompt string including the target completion.

    Example
    -------
    >>> prompt = build_training_prompt("pick up the cube", intent)
    >>> "<|im_start|>assistant" in prompt
    True
    """
    intent_str = json.dumps(intent_json, indent=2)
    return (
        f"<|im_start|>system\n{SYSTEM_PROMPT}<|im_end|>\n"
        f"<|im_start|>user\n{instruction}<|im_end|>\n"
        f"<|im_start|>assistant\n{intent_str}<|im_end|>"
    )


def build_inference_prompt(instruction: str) -> str:
    """Build an inference-only prompt (no completion).

    Used by :class:`nora_nlu.inference.parser.NLUParser` at inference time.

    Parameters
    ----------
    instruction:
        Raw natural language robot command.

    Returns
    -------
    str
        Prompt string ending with the open assistant turn, ready for
        the model to complete.

    Example
    -------
    >>> prompt = build_inference_prompt("go home")
    >>> prompt.endswith("<|im_start|>assistant\\n")
    True
    """
    return (
        f"<|im_start|>system\n{SYSTEM_PROMPT}<|im_end|>\n"
        f"<|im_start|>user\n{instruction}<|im_end|>\n"
        f"<|im_start|>assistant\n"
    )
