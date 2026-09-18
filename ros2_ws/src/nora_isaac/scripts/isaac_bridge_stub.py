#!/usr/bin/env python3
"""
isaac_bridge_stub.py — Stub for the Isaac Sim ↔ ROS 2 bridge node.

This script is a placeholder. When Isaac Sim is available, it will:
  1. Import the omni.isaac.ros2_bridge extension.
  2. Create ROS 2 publishers/subscribers for joint states, TF, camera images.
  3. Synchronise the simulation clock with ROS 2 /clock.
  4. Expose a service to reset/reload the USD stage.

Requirements (Isaac Sim side):
  - NVIDIA Isaac Sim >= 4.0
  - omni.isaac.ros2_bridge extension enabled
  - USD stage with the NORA arm imported (see usd/ directory)

Requirements (ROS 2 side):
  - Humble or Iron distribution
  - ros2_bridge launched before running this script

Usage (from within Isaac Sim's Python environment):
    ./isaac_bridge_stub.py --ros-domain-id 0

# TODO(nora): implement OmniGraph-based clock synchronisation
# TODO(nora): implement joint state publisher from ArticulationView
# TODO(nora): implement joint command subscriber → articulation drive
# TODO(nora): implement RGB-D camera bridge using IsaacSimCameraHelper
# TODO(nora): expose /reset_sim service via rclpy
"""

import argparse
import sys


def parse_args(argv=None) -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="NORA Isaac Sim ↔ ROS 2 bridge stub"
    )
    parser.add_argument(
        "--ros-domain-id",
        type=int,
        default=0,
        help="ROS_DOMAIN_ID to use (default: 0)",
    )
    parser.add_argument(
        "--usd-path",
        type=str,
        default="",
        help="Path to the NORA USD stage (optional)",
    )
    return parser.parse_args(argv)


def main() -> int:
    """Entry point — stub implementation."""
    args = parse_args()

    print("[nora_isaac] isaac_bridge_stub.py — NOT YET IMPLEMENTED")
    print(f"[nora_isaac]   ROS_DOMAIN_ID : {args.ros_domain_id}")
    print(f"[nora_isaac]   USD path      : {args.usd_path or '(none)'}")
    print()
    print("[nora_isaac] TODO(nora): replace this stub with real Isaac Sim bridge logic.")
    print("[nora_isaac] See README.md for setup instructions.")

    # TODO(nora): initialise Isaac Sim application context
    # TODO(nora): enable omni.isaac.ros2_bridge extension
    # TODO(nora): open USD stage if --usd-path provided
    # TODO(nora): register OmniGraph action nodes for joint state pub/sub
    # TODO(nora): run simulation step loop

    return 0


if __name__ == "__main__":
    sys.exit(main())
