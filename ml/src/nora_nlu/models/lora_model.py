"""
nora_nlu.models.lora_model
===========================
LoRA / QLoRA fine-tuned model wrapper using HuggingFace Transformers + PEFT.
"""

from __future__ import annotations

from typing import Optional

# TODO(nora): these imports will fail if peft/transformers are not installed;
#             guard with try/except for import-time safety in non-GPU envs.
try:
    import torch
    from peft import PeftModel, get_peft_model, LoraConfig, TaskType  # noqa: F401
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig  # noqa: F401

    _DEPS_AVAILABLE = True
except ImportError:
    _DEPS_AVAILABLE = False

from nora_nlu.models.base_model import BaseNLUModel


class LoRAModel(BaseNLUModel):
    """LoRA / QLoRA fine-tuned causal LM wrapper.

    Parameters
    ----------
    model_name_or_path:
        HuggingFace Hub model ID or local path to the base model.
    lora_weights_path:
        Optional path to pre-trained LoRA adapter weights. If ``None``, the
        model is loaded without any adapter (for training from scratch).
    load_in_4bit:
        Whether to apply 4-bit QLoRA quantisation via ``bitsandbytes``.
    torch_dtype:
        PyTorch dtype string (e.g. ``"bfloat16"``).
    """

    def __init__(
        self,
        model_name_or_path: str,
        lora_weights_path: Optional[str] = None,
        load_in_4bit: bool = False,
        torch_dtype: str = "bfloat16",
    ) -> None:
        if not _DEPS_AVAILABLE:
            raise ImportError(
                "torch, peft, and transformers must be installed to use LoRAModel. "
                "Run: pip install torch peft transformers"
            )

        self.model_name_or_path = model_name_or_path
        self.lora_weights_path = lora_weights_path
        self.load_in_4bit = load_in_4bit
        self.torch_dtype = torch_dtype

        # Set after .load() is called
        self._model = None
        self._tokenizer = None

    # ── BaseNLUModel interface ──────────────────────────────────────────────────

    def load(self) -> "LoRAModel":
        """Load the base model (+ optional LoRA adapter) and tokenizer.

        Returns
        -------
        LoRAModel
            ``self`` for chaining.
        """
        # TODO(nora): add BitsAndBytesConfig when load_in_4bit=True
        # TODO(nora): apply get_peft_model() for new LoRA training runs
        # TODO(nora): load PeftModel from lora_weights_path for inference

        dtype = getattr(torch, self.torch_dtype, torch.bfloat16)

        self._tokenizer = AutoTokenizer.from_pretrained(
            self.model_name_or_path,
            trust_remote_code=True,
        )

        self._model = AutoModelForCausalLM.from_pretrained(
            self.model_name_or_path,
            torch_dtype=dtype,
            device_map="auto",
            trust_remote_code=True,
        )

        if self.lora_weights_path is not None:
            # TODO(nora): merge-and-unload vs. keep adapter separate
            self._model = PeftModel.from_pretrained(
                self._model,
                self.lora_weights_path,
            )

        return self

    def generate(self, prompt: str, max_new_tokens: int = 256) -> str:
        """Run greedy decoding and return the generated text.

        Parameters
        ----------
        prompt:
            Formatted prompt string.
        max_new_tokens:
            Maximum tokens to generate.

        Returns
        -------
        str
            Decoded model output (full sequence, including prompt).
        """
        if self._model is None or self._tokenizer is None:
            raise RuntimeError("Call .load() before .generate().")

        # TODO(nora): switch to constrained decoding (outlines / guidance)
        #             to guarantee valid JSON output.
        inputs = self._tokenizer(prompt, return_tensors="pt").to(self._model.device)
        with torch.no_grad():
            output_ids = self._model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,
            )
        return self._tokenizer.decode(output_ids[0], skip_special_tokens=True)

    def save(self, path: str) -> None:
        """Save LoRA adapter weights (not merged) to ``path``.

        Parameters
        ----------
        path:
            Destination directory path.
        """
        if self._model is None:
            raise RuntimeError("Call .load() before .save().")
        # TODO(nora): optionally merge adapter before saving for inference-only
        self._model.save_pretrained(path)
        if self._tokenizer is not None:
            self._tokenizer.save_pretrained(path)
