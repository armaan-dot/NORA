"""
nora_nlu.models.base_model
===========================
Abstract base class for all NORA NLU model wrappers.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class BaseNLUModel(ABC):
    """Abstract base for NLU model wrappers used in training and inference.

    Subclasses must implement :meth:`load`, :meth:`generate`, and
    :meth:`save`.

    Example
    -------
    >>> class MyModel(BaseNLUModel):
    ...     def load(self): ...
    ...     def generate(self, prompt): return "{}"
    ...     def save(self, path): ...
    """

    @abstractmethod
    def load(self) -> "BaseNLUModel":
        """Load model weights and tokenizer into memory.

        Returns
        -------
        BaseNLUModel
            ``self`` for chaining.
        """
        ...

    @abstractmethod
    def generate(self, prompt: str) -> str:
        """Run inference and return the raw text output.

        Parameters
        ----------
        prompt:
            Formatted prompt string (see
            :mod:`nora_nlu.models.prompt_templates`).

        Returns
        -------
        str
            Raw model output text. The caller is responsible for parsing the
            JSON from this string.
        """
        ...

    @abstractmethod
    def save(self, path: str) -> None:
        """Persist model weights (and adapter, if applicable) to ``path``.

        Parameters
        ----------
        path:
            Destination directory.
        """
        ...
