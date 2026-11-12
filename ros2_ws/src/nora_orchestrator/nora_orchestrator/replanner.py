"""Recovery planning from a structured execution failure and the current world state.

No ROS imports, so it can be unit-tested.
"""

from __future__ import annotations

from typing import Optional

Plan = list[dict]


def find_object(world: list[dict], name: str) -> Optional[dict]:
    key = (name or "").strip().lower().replace(" ", "_")
    if not key:
        return None
    for obj in world:
        if key in (obj["id"], obj.get("label")):
            return obj
    for obj in world:
        if key in obj["id"] or obj["id"] in key:
            return obj
    return None


def replan(plan: Plan, failure: dict, world: list[dict]) -> Optional[Plan]:
    """Return a revised plan that recovers from *failure*, or None if there is none.

    failure: ``{"index", "skill", "code", "reason"}`` as reported by the executor.
    world:   world-model objects as dicts (``id``, ``state``, ``visible``, ...).

    The revised plan retreats to home (a known-safe pose that also clears the
    camera's view), re-acquires the object if it is no longer held, and resumes
    from the approach motion that led to the failed step. Steps that are already
    satisfied are skipped by the executor's tree, not here.
    """
    index = failure["index"]
    if not 0 <= index < len(plan):
        return None
    step = plan[index]
    holding = any(obj["state"] == "grasped" for obj in world)

    # Opening the gripper again is only safe when nothing is in it.
    prelude = ("move_to_pose",) if holding else ("move_to_pose", "open_gripper")
    start = index
    while start > 0 and plan[start - 1]["skill"] in prelude:
        start -= 1

    recovery: Plan = []
    if step["skill"] != "go_home":
        recovery.append({"skill": "go_home", "params": {}})
    target = step.get("params", {}).get("target_object")
    if step["skill"] == "place" and target and world:
        obj = find_object(world, target)
        if obj is None or obj["state"] != "grasped":
            recovery += [
                {"skill": "move_to_pose", "params": {"pose_name": "pre_grasp", "target": target}},
                {"skill": "open_gripper", "params": {"stroke_mm": 80}},
                {"skill": "pick", "params": {"target_object": target}},
            ]
    return recovery + plan[start:]
