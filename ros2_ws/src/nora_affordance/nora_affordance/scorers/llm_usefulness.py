"""
nora_affordance/scorers/llm_usefulness.py
──────────────────────────────────────────
LLM-based usefulness scorer.

Queries a language model (e.g. GPT-4, Gemini) to estimate how useful a skill
is for satisfying the current intent.  Inspired by SayCan (Ahn et al., 2022).

Paper: https://say-can.github.io/
"""

from __future__ import annotations

from nora_affordance.scorers.base import BaseScorer

_MOCK_MATCH_SCORE   = 0.8
_MOCK_NOMATCH_SCORE = 0.2


class LLMUsefulnessScorer(BaseScorer):
    """Scores how *useful* a skill is for achieving the current intent.

    The LLM is prompted with the intent description and a skill description,
    and asked to return a probability (0–1) that the skill advances the goal.

    Parameters
    ----------
    api_key:
        API key for the LLM provider (OpenAI, Gemini, etc.).
    model_name:
        Model identifier string.
    """

    def __init__(self, api_key: str = "", model_name: str = "gpt-4") -> None:
        self._api_key = api_key
        self._model_name = model_name

        # TODO(nora): Initialise the LLM client here, e.g.:
        #   import openai
        #   openai.api_key = api_key
        #   self._client = openai.OpenAI()

    def score(self, intent_dict: dict, skill_name: str) -> float:
        """Score the usefulness of *skill_name* for *intent_dict*.

        Parameters
        ----------
        intent_dict:
            Parsed intent (keys: action, target_object, confidence, raw_text).
        skill_name:
            Candidate skill identifier, e.g. ``"pick_red_cube"``.

        Returns
        -------
        float
            Usefulness score in ``[0.0, 1.0]``.
        """
        # TODO(nora): Call LLM API to score usefulness, e.g.:
        #   prompt = self._build_prompt(intent_dict, skill_name)
        #   response = self._client.chat.completions.create(
        #       model=self._model_name,
        #       messages=[{"role": "user", "content": prompt}],
        #       max_tokens=10,
        #   )
        #   return self._parse_score(response.choices[0].message.content)
        #
        # Mock implementation ─────────────────────────────────────────────────
        action = intent_dict.get("action", "")
        if action != "unknown" and action in skill_name:
            return _MOCK_MATCH_SCORE
        return _MOCK_NOMATCH_SCORE

    @staticmethod
    def _build_prompt(intent_dict: dict, skill_name: str) -> str:
        """Build the LLM prompt for usefulness scoring.

        TODO(nora): Refine this prompt with few-shot examples.
        """
        return (
            f"The robot's goal is: '{intent_dict.get('raw_text', '')}'\n"
            f"Candidate skill: '{skill_name}'\n"
            "On a scale from 0.0 to 1.0, how useful is this skill for "
            "completing the goal? Reply with a single float."
        )
