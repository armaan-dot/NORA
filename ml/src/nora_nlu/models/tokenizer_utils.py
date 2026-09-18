"""
nora_nlu.models.tokenizer_utils
================================
Tokenizer construction and input formatting helpers.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from transformers import PreTrainedTokenizer


def build_tokenizer(model_name: str) -> "PreTrainedTokenizer":
    """Build and configure a tokenizer for the given model.

    Sets ``pad_token = eos_token`` when a pad token is not explicitly defined
    (common for many causal LMs).

    Parameters
    ----------
    model_name:
        HuggingFace Hub model ID or local path.

    Returns
    -------
    PreTrainedTokenizer
        Configured tokenizer.

    Example
    -------
    >>> tok = build_tokenizer("Qwen/Qwen2.5-1.5B-Instruct")
    """
    # TODO(nora): guard import for environments without transformers
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        trust_remote_code=True,
    )

    # Many causal LMs have no explicit pad token
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # TODO(nora): add chat template validation — ensure the template supports
    #             the system / user / assistant role structure used in training.
    return tokenizer


def format_input(instruction: str, system_prompt: str) -> str:
    """Format a raw instruction into a model-ready input string.

    This is a simple fallback formatter. For chat-template–aware formatting,
    use :func:`nora_nlu.models.prompt_templates.build_inference_prompt`.

    Parameters
    ----------
    instruction:
        Raw natural language command from the user.
    system_prompt:
        System prompt that precedes the user instruction.

    Returns
    -------
    str
        Concatenated prompt string.

    Example
    -------
    >>> text = format_input("pick up the cube", SYSTEM_PROMPT)
    """
    # TODO(nora): switch to tokenizer.apply_chat_template() for proper
    #             multi-turn formatting once a tokenizer instance is available.
    return f"{system_prompt}\n\nUser: {instruction}\nAssistant:"
