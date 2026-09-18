"""
nora_nlu_node/local_parser.py
──────────────────────────────
Local fine-tuned HuggingFace model backend for NLU.

Loads a sequence-classification or text-generation model from *model_path*
(a local directory produced by ``transformers.Trainer.save_model()``).

Dependencies (install via pip):
  pip install transformers torch

Set the ``model_path`` ROS parameter to the directory containing
``config.json`` and ``pytorch_model.bin`` (or safetensors equivalent).
"""

from __future__ import annotations

from nora_nlu_node.intent_parser import IntentParser


class LocalFineTunedParser(IntentParser):
    """HuggingFace fine-tuned model backend.

    Parameters
    ----------
    model_path:
        Absolute path to the local model directory.
    """

    def __init__(self, model_path: str) -> None:
        self._model_path = model_path
        self._pipeline = None  # type: ignore[assignment]

        # TODO(nora): Load HuggingFace pipeline here, e.g.:
        #   from transformers import pipeline
        #   self._pipeline = pipeline(
        #       "text-classification",
        #       model=model_path,
        #       tokenizer=model_path,
        #   )
        #
        # Raise RuntimeError if model_path does not exist or is incompatible.

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
        # TODO(nora): Implement HF model inference:
        #   result = self._pipeline(text)[0]
        #   action = self._label_to_action(result["label"])
        #   confidence = float(result["score"])
        #   target_object = self._extract_object_entities(text)
        #   return {"action": action, "target_object": target_object,
        #           "confidence": confidence, "raw_text": text}

        raise NotImplementedError(
            "LocalFineTunedParser is not yet implemented. "
            "Set backend='mock' or implement HF inference in local_parser.py."
        )

    # ── Private helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _label_to_action(label: str) -> str:
        """Map a model output label to a canonical action string.

        TODO(nora): Fill in the mapping once the model label scheme is known.
        """
        # Example: {"LABEL_0": "pick", "LABEL_1": "place", ...}
        label_map: dict[str, str] = {}
        return label_map.get(label, "unknown")

    @staticmethod
    def _extract_object_entities(text: str) -> str:
        """Extract target object from NER output or post-processing.

        TODO(nora): Implement NER or slot-filling entity extraction.
        """
        return ""
