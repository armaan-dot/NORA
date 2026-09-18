"""test_skill_registry.py
========================
Tests that ``config/skill_registry.yaml`` is well-formed and contains all
expected skill entries.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

# Locate the YAML relative to this test file regardless of working directory.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_REGISTRY_PATH = _REPO_ROOT / "config" / "skill_registry.yaml"

_EXPECTED_SKILL_NAMES = {
    "pick",
    "place",
    "move_to_pose",
    "open_gripper",
    "close_gripper",
    "go_home",
}


@pytest.fixture(scope="module")
def registry() -> dict:
    """Load and parse the skill registry YAML."""
    assert _REGISTRY_PATH.exists(), (
        f"skill_registry.yaml not found at {_REGISTRY_PATH}"
    )
    with open(_REGISTRY_PATH) as fh:
        data = yaml.safe_load(fh)
    return data


def test_registry_has_skills_key(registry: dict) -> None:
    """Top-level key must be 'skills'."""
    assert "skills" in registry, "Registry YAML missing top-level 'skills' key"


def test_registry_skill_count(registry: dict) -> None:
    """There must be exactly 6 skills registered."""
    skills = registry["skills"]
    assert len(skills) == 6, f"Expected 6 skills, got {len(skills)}"


def test_all_expected_skills_present(registry: dict) -> None:
    """Every expected skill name must appear in the registry."""
    names = {s["name"] for s in registry["skills"]}
    missing = _EXPECTED_SKILL_NAMES - names
    assert not missing, f"Missing skill entries: {missing}"


def test_each_skill_has_required_fields(registry: dict) -> None:
    """Every skill entry must have name, action_server, description, params."""
    required_fields = {"name", "action_server", "description", "params"}
    for skill in registry["skills"]:
        missing = required_fields - set(skill.keys())
        assert not missing, (
            f"Skill '{skill.get('name', '?')}' missing fields: {missing}"
        )


def test_action_server_names_have_nora_prefix(registry: dict) -> None:
    """All action_server topics must start with '/nora/skills/'."""
    for skill in registry["skills"]:
        assert skill["action_server"].startswith("/nora/skills/"), (
            f"Skill '{skill['name']}' has unexpected action_server: "
            f"'{skill['action_server']}'"
        )
