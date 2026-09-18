"""Skill definitions and registry for NORA.

Provides :class:`SkillDefinition` (a Pydantic model describing a single
robot skill) and :class:`SkillRegistry` (a runtime store of all available
skills loaded from a YAML file).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


class SkillDefinition(BaseModel):
    """Definition of a single robot skill.

    Attributes
    ----------
    name:
        Unique skill identifier (e.g. ``"pick_object"``).
    action_server:
        ROS 2 action server topic name that executes this skill.
    description:
        Human-readable description of what this skill does.
    preconditions:
        List of predicate strings that must be true before the skill can run
        (e.g. ``["gripper_open", "object_visible"]``).
    effects:
        List of predicate strings that become true after the skill succeeds
        (e.g. ``["object_grasped"]``).
    params:
        Mapping of parameter name → type hint string describing the skill's
        configurable inputs (e.g. ``{"object_id": "str", "speed": "float"}``).
    """

    name: str
    action_server: str
    description: str = ""
    preconditions: list[str] = Field(default_factory=list)
    effects: list[str] = Field(default_factory=list)
    params: dict[str, str] = Field(default_factory=dict)


class SkillRegistry:
    """Runtime registry of all skills available to the planner.

    Skills are loaded from a YAML file that validates against
    ``schemas/skill_registry.schema.json``.

    Examples
    --------
    >>> registry = SkillRegistry.load_from_yaml("config/skills.yaml")
    >>> print(registry.list_names())
    ['pick_object', 'place_object', 'go_home']
    """

    def __init__(self, skills: list[SkillDefinition]) -> None:
        self._skills: dict[str, SkillDefinition] = {s.name: s for s in skills}

    # ------------------------------------------------------------------
    # Constructors
    # ------------------------------------------------------------------

    @classmethod
    def load_from_yaml(cls, path: str | Path) -> "SkillRegistry":
        """Load a :class:`SkillRegistry` from a YAML file.

        Parameters
        ----------
        path:
            Filesystem path to the YAML file.  The file must conform to
            ``schemas/skill_registry.schema.json``.

        Returns
        -------
        SkillRegistry
            A populated registry instance.

        Raises
        ------
        FileNotFoundError
            If *path* does not exist.
        yaml.YAMLError
            If the file is malformed YAML.
        pydantic.ValidationError
            If any skill entry fails schema validation.
        """
        # TODO(nora): import yaml at top of file once PyYAML is added to deps
        # TODO(nora): optionally validate raw data against skill_registry.schema.json via jsonschema
        import yaml  # deferred import — yaml is not a hard dependency of nora-core yet

        raw: dict[str, Any] = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        skills = [SkillDefinition.model_validate(entry) for entry in raw.get("skills", [])]
        return cls(skills)

    # ------------------------------------------------------------------
    # Lookup helpers
    # ------------------------------------------------------------------

    def get(self, name: str) -> SkillDefinition:
        """Return the :class:`SkillDefinition` for *name*.

        Parameters
        ----------
        name:
            The skill name to look up.

        Returns
        -------
        SkillDefinition

        Raises
        ------
        KeyError
            If *name* is not registered.
        """
        # TODO(nora): raise a friendlier SkillNotFoundError instead of raw KeyError
        return self._skills[name]

    def list_names(self) -> list[str]:
        """Return a sorted list of all registered skill names.

        Returns
        -------
        list[str]
        """
        return sorted(self._skills.keys())

    def __len__(self) -> int:
        """Return the number of registered skills."""
        return len(self._skills)

    def __repr__(self) -> str:  # pragma: no cover
        return f"SkillRegistry({self.list_names()!r})"
