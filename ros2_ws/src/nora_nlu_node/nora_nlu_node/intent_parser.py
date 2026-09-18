"""
nora_nlu_node/intent_parser.py
───────────────────────────────
Interface for all NLU backends.

All concrete parsers must subclass :class:`IntentParser` and implement
:meth:`parse`.  The returned dict must conform to ``intent.schema.json``:

.. code-block:: python

    {
        "action": str,           # e.g. "pick", "place", "go_home"
        "target_object": str,    # e.g. "red cube" (may be empty)
        "confidence": float,     # 0.0 – 1.0
        "raw_text": str,         # original input text
    }
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class IntentParser(ABC):
    """Interface for all NLU backends.

    Subclasses implement :meth:`parse` and return a dictionary whose keys
    match the intent schema consumed by :class:`~nora_nlu_node.nlu_node.NLUNode`.
    """

    @abstractmethod
    def parse(self, text: str) -> dict:
        """Parse a natural-language command into a structured intent dict.

        Parameters
        ----------
        text:
            Raw input string, e.g. ``"pick up the red cube"``.

        Returns
        -------
        dict
            A dict with keys: ``action``, ``target_object``, ``confidence``,
            ``raw_text``.  See module docstring for the full schema.
        """
        ...
