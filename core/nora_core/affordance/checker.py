"""CLI tool and inspector for checking NORA Affordance Scores and Workflow.

Run standalone or as a module:
    python -m nora_core.affordance.checker "I am thirsty"
    python check_affordance.py "pick up the water glass" --state holding
    python check_affordance.py --test
"""

from __future__ import annotations

import argparse
import time
from typing import Any

from nora_core.affordance.environment import WorldState
from nora_core.affordance.saycan import SayCanPlan, SayCanPlanner
from nora_core.affordance.workflow import AffordanceWorkflow, WorkflowResult


def format_table(headers: list[str], rows: list[list[Any]], alignments: list[str] | None = None) -> str:
    """Format tabular data into an ASCII/Unicode table."""
    if not rows:
        return ""

    num_cols = len(headers)
    aligns = alignments or ["<"] * num_cols

    # Calculate max widths
    widths = [len(h) for h in headers]
    for row in rows:
        for idx, val in enumerate(row):
            widths[idx] = max(widths[idx], len(str(val)))

    # Separator line
    border = "+-" + "-+-".join("-" * w for w in widths) + "-+"

    # Header line
    header_cells = [
        f"{h:<{widths[i]}}" if aligns[i] == "<" else f"{h:>{widths[i]}}"
        for i, h in enumerate(headers)
    ]
    header_line = "| " + " | ".join(header_cells) + " |"

    # Data lines
    data_lines = []
    for row in rows:
        cells = [
            f"{str(val):<{widths[i]}}" if aligns[i] == "<" else f"{str(val):>{widths[i]}}"
            for i, val in enumerate(row)
        ]
        data_lines.append("| " + " | ".join(cells) + " |")

    return "\n".join([border, header_line, border] + data_lines + [border])


def check_affordance(
    utterance: str,
    state_preset: str = "default",
    execute: bool = True,
    threshold: float = 0.25,
) -> WorkflowResult:
    """Check affordance scores and workflow for an utterance and display detailed breakdown."""
    # Build world state according to preset
    if state_preset == "holding":
        world = WorldState.with_held_object("water_glass")
    elif state_preset == "unreachable":
        world = WorldState.with_unreachable_object("water_glass")
    elif state_preset == "obstructed":
        world = WorldState.with_obstructed_object("water_glass")
    else:
        world = WorldState.default()

    workflow = AffordanceWorkflow(world_state=world, score_threshold=threshold)
    result = workflow.run(utterance, execute=execute)

    print("\n" + "=" * 76)
    print("  NORA AFFORDANCE SCORING & WORKFLOW CHECKER")
    print("=" * 76)

    # 1. Intent Details
    intent = result.intent
    action_val = intent.action.value if hasattr(intent.action, "value") else str(intent.action)
    print(f"\n[1] INPUT UTTERANCE: \"{utterance}\"")
    print(f"    Structured Intent:")
    print(f"      Action:          {action_val}")
    print(f"      Target Object:   {intent.target_object or 'None'}")
    print(f"      Target Location: {intent.target_location or 'None'}")
    print(f"      Confidence:      {intent.confidence:.2f}")

    # 2. Physical World State
    r_init = result.initial_world_state.robot
    print(f"\n[2] WORLD & ROBOT STATE (Pre-Execution):")
    print(f"      Gripper State:   {r_init.gripper_state}")
    print(f"      Held Object:     {r_init.held_object or 'None (empty)'}")
    print(f"      Current Pose:    {r_init.current_pose}")

    # 3. Affordance Scores Table
    headers = ["Rank", "Candidate Skill", "Usefulness", "Feasib.", "Reach", "Coll.", "ObjSt", "Pre", "Combined", "Status"]
    alignments = [">", "<", ">", ">", ">", ">", ">", ">", ">", "<"]

    # Sort scores descending
    sorted_scores = sorted(result.scores, key=lambda s: s.combined_score, reverse=True)
    table_rows = []

    for rank, s in enumerate(sorted_scores, 1):
        b = s.breakdown
        reach = f"{b.get('reachability', 1.0):.2f}"
        coll = f"{b.get('collision_free', 1.0):.2f}"
        objs = f"{b.get('object_state', 1.0):.2f}"
        pre = f"{b.get('preconditions', 1.0):.2f}"

        if result.executed_skill == s.skill_name and s.combined_score >= threshold:
            status = "SELECTED"
        elif s.combined_score >= threshold:
            status = "Viable"
        elif s.feasibility == 0.0:
            status = "Infeasible"
        elif s.usefulness < 0.20:
            status = "Irrelevant"
        else:
            status = "Below Thresh"

        table_rows.append([
            rank,
            s.skill_name,
            f"{s.usefulness:.3f}",
            f"{s.feasibility:.3f}",
            reach,
            coll,
            objs,
            pre,
            f"{s.combined_score:.3f}",
            status,
        ])

    print(f"\n[3] CANDIDATE SKILLS AFFORDANCE EVALUATION:")
    print(f"    Formula: Combined = Usefulness^0.60 x Feasibility^0.40")
    print(format_table(headers, table_rows, alignments))

    # 4. Plan & Execution
    print(f"\n[4] PLANNER DECISION & EXECUTION:")
    if result.executed_skill:
        print(f"    Top Selected Skill:  '{result.executed_skill}'")
        print(f"    Execution Success:   {result.success}")
        print(f"    Status Message:      {result.message}")
        r_fin = result.final_world_state.robot
        print(f"    New Gripper State:   {r_fin.gripper_state} (held: {r_fin.held_object or 'None'})")
    else:
        print(f"    NO SKILL EXECUTED:   {result.message}")

    print(f"    Processing Time:     {result.execution_time_ms:.1f} ms")
    print("=" * 76 + "\n")

    return result


def run_test_suite() -> None:
    """Run built-in demonstration test suite across key robotics scenarios."""
    scenarios = [
        (
            "Scenario 1: Direct Pick Command",
            "pick up the water glass",
            "default",
        ),
        (
            "Scenario 2: Indirect Thirst Commonsense (SayCan test)",
            "I am thirsty",
            "default",
        ),
        (
            "Scenario 3: Feasibility Gating - Pick when already holding object",
            "pick up the apple",
            "holding",
        ),
        (
            "Scenario 4: Feasibility Gating - Place when already holding object",
            "place the water glass on the table",
            "holding",
        ),
        (
            "Scenario 5: Physical Kinematics - Target object out of reach",
            "grab the water glass",
            "unreachable",
        ),
        (
            "Scenario 6: Gripper Manipulation Command",
            "open the gripper",
            "default",
        ),
    ]

    print("\n" + "#" * 76)
    print("  RUNNING NORA AFFORDANCE VERIFICATION TEST SUITE")
    print("#" * 76)

    for title, cmd, preset in scenarios:
        print(f"\n>>> TEST: {title}")
        print(f"    Command: '{cmd}' | Preset: '{preset}'")
        check_affordance(cmd, state_preset=preset, execute=True)
        time.sleep(0.05)


def check_saycan(query: str, state_preset: str = "default") -> SayCanPlan:
    """Run Google Research SayCan sequential planning loop and display steps."""
    if state_preset == "holding":
        world = WorldState.with_held_object("water_glass")
    elif state_preset == "unreachable":
        world = WorldState.with_unreachable_object("water_glass")
    elif state_preset == "obstructed":
        world = WorldState.with_obstructed_object("water_glass")
    else:
        world = WorldState.default()

    planner = SayCanPlanner()
    plan = planner.plan(query, initial_world_state=world)

    print("\n" + "=" * 76)
    print("  GOOGLE RESEARCH SAYCAN LONG-HORIZON PLANNING")
    print("=" * 76)
    print(f"\n[INSTRUCTION]: \"{query}\"")
    print(f"Initial State: Gripper={world.robot.gripper_state}, Held={world.robot.held_object or 'None'}")
    print("\nSayCan Sequential Execution Steps:")
    print("-" * 76)

    headers = ["Step", "Selected Option", "LLM P(a|q)", "Affordance V(a|s)", "Combined S(a)", "Feasible"]
    alignments = [">", "<", ">", ">", ">", "<"]
    table_rows = []

    for idx, s in enumerate(plan.steps, 1):
        table_rows.append([
            idx,
            s.option.description,
            f"{s.language_prob:.3f}",
            f"{s.affordance_val:.3f}",
            f"{s.combined_score:.3f}",
            "YES" if s.feasible else "NO",
        ])

    print(format_table(headers, table_rows, alignments))
    print(f"\nFinal Outcome: {'Goal Satisfied (done)' if plan.completed else 'Plan Truncated'}")
    if plan.final_world_state:
        r = plan.final_world_state.robot
        print(f"Final Robot State: Gripper={r.gripper_state}, Held={r.held_object or 'None'}")
    print("=" * 76 + "\n")

    return plan


def main() -> None:
    """CLI entry point for checking affordance scores."""
    parser = argparse.ArgumentParser(description="Check NORA Affordance Scores and Workflow.")
    parser.add_argument(
        "utterance",
        nargs="?",
        default="I am thirsty",
        help="Natural language command (default: 'I am thirsty')",
    )
    parser.add_argument(
        "--state",
        choices=["default", "holding", "unreachable", "obstructed"],
        default="default",
        help="Physical world state preset (default: 'default')",
    )
    parser.add_argument(
        "--saycan",
        action="store_true",
        help="Run multi-step Google Research SayCan sequential planner",
    )
    parser.add_argument(
        "--no-execute",
        action="store_true",
        help="Dry run without mutating world state",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.25,
        help="Minimum affordance score threshold (default: 0.25)",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Run comprehensive affordance test suite across scenarios",
    )

    args = parser.parse_args()

    if args.test:
        run_test_suite()
    elif args.saycan:
        check_saycan(query=args.utterance, state_preset=args.state)
    else:
        check_affordance(
            utterance=args.utterance,
            state_preset=args.state,
            execute=not args.no_execute,
            threshold=args.threshold,
        )


if __name__ == "__main__":
    main()
