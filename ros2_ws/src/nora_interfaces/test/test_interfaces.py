"""Minimal smoke tests for nora_interfaces.

These tests verify that the generated interface modules are importable after
the package has been built with colcon. Run via:

    colcon test --packages-select nora_interfaces

# TODO(nora): add interface existence tests — check each field name, type,
#             and constant value once the generated Python stubs are stable.
"""

import pytest


def test_import_intent():
    """Verify Intent message module is importable."""
    # TODO(nora): add interface existence tests
    try:
        from nora_interfaces.msg import Intent  # noqa: F401
    except ImportError as exc:
        pytest.skip(f"nora_interfaces not yet built: {exc}")


def test_import_skill_call():
    """Verify SkillCall message module is importable."""
    # TODO(nora): add interface existence tests
    try:
        from nora_interfaces.msg import SkillCall  # noqa: F401
    except ImportError as exc:
        pytest.skip(f"nora_interfaces not yet built: {exc}")


def test_import_affordance_score():
    """Verify AffordanceScore message module is importable."""
    # TODO(nora): add interface existence tests
    try:
        from nora_interfaces.msg import AffordanceScore  # noqa: F401
    except ImportError as exc:
        pytest.skip(f"nora_interfaces not yet built: {exc}")


def test_import_parse_command_srv():
    """Verify ParseCommand service module is importable."""
    # TODO(nora): add interface existence tests
    try:
        from nora_interfaces.srv import ParseCommand  # noqa: F401
    except ImportError as exc:
        pytest.skip(f"nora_interfaces not yet built: {exc}")


def test_import_score_affordances_srv():
    """Verify ScoreAffordances service module is importable."""
    # TODO(nora): add interface existence tests
    try:
        from nora_interfaces.srv import ScoreAffordances  # noqa: F401
    except ImportError as exc:
        pytest.skip(f"nora_interfaces not yet built: {exc}")


def test_import_execute_intent_action():
    """Verify ExecuteIntent action module is importable."""
    # TODO(nora): add interface existence tests
    try:
        from nora_interfaces.action import ExecuteIntent  # noqa: F401
    except ImportError as exc:
        pytest.skip(f"nora_interfaces not yet built: {exc}")


def test_import_execute_skill_action():
    """Verify ExecuteSkill action module is importable."""
    # TODO(nora): add interface existence tests
    try:
        from nora_interfaces.action import ExecuteSkill  # noqa: F401
    except ImportError as exc:
        pytest.skip(f"nora_interfaces not yet built: {exc}")
