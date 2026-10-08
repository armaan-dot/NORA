#!/usr/bin/env python3
"""Convenience entry point for checking NORA Affordance Scores and Workflow.

Usage:
    python check_affordance.py "I am thirsty"
    python check_affordance.py "pick up the water glass"
    python check_affordance.py "pick up the apple" --state holding
    python check_affordance.py --test
"""

import sys
from pathlib import Path

# Ensure core and ml/src and ros2_ws are in sys.path
REPO_ROOT = Path(__file__).resolve().parent
CORE_DIR = REPO_ROOT / "core"
ML_DIR = REPO_ROOT / "ml" / "src"
ROS_DIR = REPO_ROOT / "ros2_ws" / "src" / "nora_nlu_node"

for p in (CORE_DIR, ML_DIR, ROS_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from nora_core.affordance.checker import main

if __name__ == "__main__":
    main()

