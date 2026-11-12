"""Affordance scoring math: URDF chain, FK, IK, clearance and object-state rules.

No ROS imports, so it can be unit-tested. World objects are dicts with
``id``, ``label``, ``position`` ([x, y, z] in the chain's base frame), ``state``
and ``confidence``.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

UNAVAILABLE = 0.5  # score of a component whose inputs are missing
SPATIAL_SKILLS = ("pick", "place", "move_to_pose")
_SKILLS = ("move_to_pose", "open_gripper", "close_gripper", "go_home", "pick", "place")
_GONE = ("missing", "unknown")
_MOVABLE = ("revolute", "continuous", "prismatic")
_SEED_STEP = 0.6180339887498949

# Relevance of each skill to the NLU action; unlisted pairs score _DEFAULT_RELEVANCE.
_DEFAULT_RELEVANCE = 0.1
_RELEVANCE = {
    "pick": {
        "pick": 1.0, "move_to_pose": 0.7, "open_gripper": 0.6, "close_gripper": 0.6,
        "place": 0.3, "go_home": 0.3,
    },
    "place": {
        "place": 1.0, "move_to_pose": 0.7, "open_gripper": 0.6, "pick": 0.4,
        "go_home": 0.3, "close_gripper": 0.2,
    },
    "move_to_pose": {"move_to_pose": 1.0, "go_home": 0.3},
    "open_gripper": {"open_gripper": 1.0},
    "close_gripper": {"close_gripper": 1.0},
    "go_home": {"go_home": 1.0, "move_to_pose": 0.4},
    "explicit_blocked": dict.fromkeys(_SKILLS, 0.0),
}


@dataclass
class Params:
    approach_height: float = 0.02  # tcp goal above the target position [m]
    tool_axis: tuple = (0.0, 0.0, 1.0)  # tip-frame axis that must point down
    ik_position_tolerance: float = 0.01  # [m]
    ik_angle_tolerance: float = math.radians(10.0)  # [rad]
    gripper_clearance: float = 0.10  # jaw half-width plus margin [m]
    object_radius: float = 0.03  # assumed radius of every object [m]
    height_tolerance: float = 0.01  # [m]
    place_not_holding: float = 0.1


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def normalize(name: str) -> str:
    return (name or "").strip().lower().replace(" ", "_")


def skill_kind(skill_name: str) -> str:
    """Map e.g. ``pick_red_cube`` to ``pick``; unknown names are returned normalized."""
    name = normalize(skill_name)
    for kind in _SKILLS:
        if name == kind or name.startswith(kind + "_"):
            return kind
    return name


def find_object(objects: Sequence[dict], name: str) -> Optional[dict]:
    """Match by id or label, then by id substring (the world model's rule)."""
    key = normalize(name)
    if not key:
        return None
    for obj in objects:
        if key in (obj["id"], normalize(obj.get("label", ""))):
            return obj
    for obj in objects:
        if key in obj["id"] or obj["id"] in key:
            return obj
    return None


# -- kinematics ---------------------------------------------------------------


def _floats(text: Optional[str], default: Sequence[float]) -> list[float]:
    return [float(v) for v in text.split()] if text else list(default)


def _rotation(axis: np.ndarray, angle: float) -> np.ndarray:
    x, y, z = axis
    c, s = math.cos(angle), math.sin(angle)
    k = 1.0 - c
    return np.array([
        [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
        [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
        [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
    ])


def _origin(joint: ET.Element) -> np.ndarray:
    elem = joint.find("origin")
    xyz = _floats(elem.get("xyz") if elem is not None else None, (0.0, 0.0, 0.0))
    roll, pitch, yaw = _floats(elem.get("rpy") if elem is not None else None, (0.0, 0.0, 0.0))
    transform = np.eye(4)
    transform[:3, :3] = (
        _rotation(np.array([0.0, 0.0, 1.0]), yaw)
        @ _rotation(np.array([0.0, 1.0, 0.0]), pitch)
        @ _rotation(np.array([1.0, 0.0, 0.0]), roll)
    )
    transform[:3, 3] = xyz
    return transform


class Chain:
    """Serial chain of URDF joints from a base link to a tip link."""

    def __init__(self, joints: list[dict], tip: str) -> None:
        self.joints = joints
        self.tip = tip
        active = [j for j in joints if j["active"]]
        self.names = [j["name"] for j in active]
        self.lower = np.array([j["lower"] for j in active])
        self.upper = np.array([j["upper"] for j in active])

    def fk(self, q: Sequence[float]) -> np.ndarray:
        """4x4 pose of the tip in the base frame."""
        return self.jacobian(q)[0]

    def jacobian(self, q: Sequence[float]) -> tuple[np.ndarray, np.ndarray]:
        """Tip pose and the 6xN geometric Jacobian (linear rows, then angular)."""
        transform = np.eye(4)
        columns = []
        k = 0
        for joint in self.joints:
            transform = transform @ joint["origin"]
            if not joint["active"]:
                continue
            axis = transform[:3, :3] @ joint["axis"]
            columns.append((axis, transform[:3, 3].copy(), joint["type"]))
            motion = np.eye(4)
            if joint["type"] == "prismatic":
                motion[:3, 3] = joint["axis"] * q[k]
            else:
                motion[:3, :3] = _rotation(joint["axis"], q[k])
            transform = transform @ motion
            k += 1
        jac = np.zeros((6, len(columns)))
        for i, (axis, origin, kind) in enumerate(columns):
            if kind == "prismatic":
                jac[:3, i] = axis
            else:
                jac[:3, i] = np.cross(axis, transform[:3, 3] - origin)
                jac[3:, i] = axis
        return transform, jac

    def reach(self) -> tuple[np.ndarray, float]:
        """Centre and radius of a sphere that contains every tip position."""
        transform = np.eye(4)
        centre = None
        radius = 0.0
        for joint in self.joints:
            if centre is None:
                transform = transform @ joint["origin"]
                if joint["active"]:
                    centre = transform[:3, 3].copy()
            else:
                radius += float(np.linalg.norm(joint["origin"][:3, 3]))
            if joint["active"] and joint["type"] == "prismatic":
                radius += max(abs(joint["lower"]), abs(joint["upper"]))
        if centre is None:
            centre = transform[:3, 3].copy()
        return centre, radius


def parse_chain(
    urdf_xml: str,
    base_link: str = "base_link",
    tip_links: Sequence[str] = ("tcp", "gripper_link"),
    active_joints: Optional[Sequence[str]] = None,
) -> Chain:
    """Build the joint chain from *base_link* to the first of *tip_links* in the URDF.

    Movable joints named in *active_joints* are solved for; other movable joints
    in the chain are held at zero. If none of the names are in the chain (or
    *active_joints* is empty), every movable joint is active.
    """
    root = ET.fromstring(urdf_xml)
    links = {link.get("name") for link in root.findall("link")}
    by_child = {j.find("child").get("link"): j for j in root.findall("joint")}
    tip = next((name for name in tip_links if name in links), None)
    if tip is None:
        raise ValueError(f"none of the tip links {list(tip_links)} are in the URDF")

    elements = []
    link = tip
    while link != base_link:
        joint = by_child.get(link)
        if joint is None or len(elements) > len(by_child):
            raise ValueError(f"no joint chain from '{base_link}' to '{tip}'")
        elements.append(joint)
        link = joint.find("parent").get("link")
    elements.reverse()

    wanted = set(active_joints or ())
    if not any(j.get("type") in _MOVABLE and j.get("name") in wanted for j in elements):
        wanted = None

    joints = []
    for elem in elements:
        kind = elem.get("type")
        name = elem.get("name")
        axis_elem = elem.find("axis")
        axis = np.array(
            _floats(axis_elem.get("xyz") if axis_elem is not None else None, (1.0, 0.0, 0.0))
        )
        length = float(np.linalg.norm(axis))
        limit = elem.find("limit")
        lower, upper = -math.pi, math.pi
        if kind != "continuous" and limit is not None:
            lower = float(limit.get("lower", 0.0))
            upper = float(limit.get("upper", 0.0))
        joints.append({
            "name": name,
            "type": kind,
            "origin": _origin(elem),
            "axis": axis / length if length > 0.0 else axis,
            "lower": lower,
            "upper": upper,
            "active": kind in _MOVABLE and (wanted is None or name in wanted),
        })
    return Chain(joints, tip)


def _tool_error(tool: np.ndarray, down: np.ndarray) -> tuple[np.ndarray, float]:
    """Rotation axis and angle that turn the tool axis onto *down*."""
    axis = np.cross(tool, down)
    sine = float(np.linalg.norm(axis))
    angle = math.atan2(sine, float(tool @ down))
    if sine < 1e-9:  # parallel or opposite: any perpendicular axis works
        axis = np.cross(tool, np.array([1.0, 0.0, 0.0]))
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(tool, np.array([0.0, 1.0, 0.0]))
        sine = float(np.linalg.norm(axis))
    return axis / sine, angle


def solve_ik(
    chain: Chain,
    target: Sequence[float],
    tool_axis: Optional[Sequence[float]] = (0.0, 0.0, 1.0),
    position_tolerance: float = 0.01,
    angle_tolerance: float = math.radians(10.0),
    seeds: int = 6,
    iterations: int = 150,
    damping: float = 0.05,
) -> tuple[np.ndarray, float, float]:
    """Damped-least-squares IK for the tip position with *tool_axis* pointing down.

    Returns the best ``(q, position_error [m], angle_error [rad])`` over the seeds.
    ``tool_axis=None`` drops the orientation constraint.
    """
    target = np.asarray(target, dtype=float)
    down = np.array([0.0, 0.0, -1.0])
    tool = None if tool_axis is None else np.asarray(tool_axis, dtype=float)
    span = chain.upper - chain.lower
    index = np.arange(1, len(span) + 1)
    best = None
    for seed in range(1, seeds + 1):
        q = chain.lower + span * ((0.5 + seed * ((index * _SEED_STEP) % 1.0)) % 1.0)
        for step in range(iterations + 1):
            transform, jac = chain.jacobian(q)
            error = target - transform[:3, 3]
            pos_err = float(np.linalg.norm(error))
            ang_err = 0.0
            if tool is not None:
                pointing = transform[:3, :3] @ tool
                axis, ang_err = _tool_error(pointing, down)
            if (pos_err <= position_tolerance and ang_err <= angle_tolerance) or step == iterations:
                break
            if pos_err > 0.05:
                error = error * (0.05 / pos_err)
            rows = jac[:3]
            if tool is not None:
                # Rotation about the tool axis itself is left free.
                free = np.eye(3) - np.outer(pointing, pointing)
                rows = np.vstack((rows, free @ jac[3:]))
                error = np.concatenate((error, axis * min(ang_err, 0.3)))
            gram = rows @ rows.T + damping ** 2 * np.eye(len(error))
            q = np.clip(q + rows.T @ np.linalg.solve(gram, error), chain.lower, chain.upper)
        cost = pos_err / position_tolerance + ang_err / angle_tolerance
        if best is None or cost < best[0]:
            best = (cost, q, pos_err, ang_err)
        if pos_err <= position_tolerance and ang_err <= angle_tolerance:
            break
    return best[1], best[2], best[3]


# -- component scores -----------------------------------------------------------


def reachability_score(
    chain: Chain, target: Sequence[float], params: Params = Params()
) -> tuple[float, str]:
    """1.0 if IK reaches *target* tool-down, decaying with the residual; 0 outside reach."""
    target = np.asarray(target, dtype=float)
    centre, radius = chain.reach()
    distance = float(np.linalg.norm(target - centre))
    if distance > radius:
        return 0.0, f"target {distance:.2f} m from the shoulder, max reach {radius:.2f} m"
    _, pos_err, ang_err = solve_ik(
        chain, target, params.tool_axis,
        params.ik_position_tolerance, params.ik_angle_tolerance,
    )
    if pos_err <= params.ik_position_tolerance and ang_err <= params.ik_angle_tolerance:
        return 1.0, "ik solved"
    score = math.exp(-max(0.0, pos_err - params.ik_position_tolerance) / 0.05) * math.exp(
        -max(0.0, ang_err - params.ik_angle_tolerance) / 0.5
    )
    return score, f"ik residual {pos_err * 1000:.0f} mm, {math.degrees(ang_err):.0f} deg"


def clearance_score(
    target: dict, objects: Sequence[dict], params: Params = Params()
) -> tuple[float, str]:
    """Clearance of a vertical gripper approach above *target* from taller objects."""
    worst, reason = 1.0, "clear"
    tx, ty, tz = target["position"]
    for obj in objects:
        if obj is target or obj["state"] in _GONE or obj["state"] == "grasped":
            continue
        x, y, z = obj["position"]
        if z <= tz + params.height_tolerance:
            continue
        distance = math.hypot(x - tx, y - ty)
        score = clamp01((distance - params.object_radius) / params.gripper_clearance)
        if score < worst:
            worst = score
            reason = f"'{obj['id']}' is higher and {distance * 1000:.0f} mm from the target"
    return worst, reason


def object_state_score(
    skill_name: str, intent: dict, objects: Optional[Sequence[dict]], params: Params = Params()
) -> tuple[float, str]:
    kind = skill_kind(skill_name)
    if kind not in SPATIAL_SKILLS:
        return 1.0, "no object needed"
    if objects is None:
        return UNAVAILABLE, "world model unavailable"
    name = normalize(intent.get("target_object", ""))
    target = find_object(objects, name)
    holding = any(obj["state"] == "grasped" for obj in objects)

    if not name:
        if kind == "pick":
            return 0.0, "no target object"
        if kind == "place" and not holding:
            return params.place_not_holding, "nothing is held"
        return 1.0, "no target object"
    if target is None:
        return 0.0, f"'{name}' is not in the world model"
    if target["state"] in _GONE:
        return 0.0, f"'{target['id']}' is {target['state']}"
    if target["state"] == "grasped":
        if kind == "pick":
            return 0.0, f"'{target['id']}' is already held"
        return 1.0, f"'{target['id']}' is held"
    if kind == "place" and not holding:
        return params.place_not_holding, "nothing is held"
    return clamp01(target["confidence"]), f"'{target['id']}' confidence"


def spatial_target(skill_name: str, intent: dict, objects: Sequence[dict]) -> Optional[dict]:
    """World object whose position the skill has to reach, if any."""
    kind = skill_kind(skill_name)
    if kind == "pick":
        return find_object(objects, intent.get("target_object", ""))
    if kind == "place":
        return find_object(objects, intent.get("target_location", ""))
    if kind == "move_to_pose":
        obj = find_object(objects, intent.get("target_object", ""))
        if obj is None or obj["state"] == "grasped":  # a held object has no pose to reach
            obj = find_object(objects, intent.get("target_location", ""))
        return obj
    return None


def usefulness_score(skill_name: str, intent: dict) -> float:
    """Relevance of the skill to the intent action, scaled by the parse confidence."""
    relevance = _RELEVANCE.get(normalize(intent.get("action", "")), {})
    return clamp01(
        relevance.get(skill_kind(skill_name), _DEFAULT_RELEVANCE) * intent.get("confidence", 1.0)
    )


def feasibility_scores(
    skill_name: str,
    intent: dict,
    objects: Optional[Sequence[dict]],
    chain: Optional[Chain],
    params: Params = Params(),
    cache: Optional[dict] = None,
) -> tuple[dict, dict]:
    """Reachability, collision and object-state scores for one skill, with reasons.

    ``objects=None`` means no world state has been received, ``chain=None`` that
    no URDF was loaded. *cache* keeps IK results per target across skills.
    """
    scores, notes = {}, {}
    scores["object_state"], notes["object_state"] = object_state_score(
        skill_name, intent, objects, params
    )
    kind = skill_kind(skill_name)
    if kind not in SPATIAL_SKILLS:
        reach = collision = (1.0, "no spatial target")
    elif objects is None:
        reach = collision = (UNAVAILABLE, "world model unavailable")
    else:
        target = spatial_target(skill_name, intent, objects)
        if target is not None and not np.all(np.isfinite(target["position"])):
            reach = collision = (UNAVAILABLE, f"'{target['id']}' has no valid position")
        elif target is not None:
            collision = clearance_score(target, objects, params)
            if chain is None:
                reach = (UNAVAILABLE, "URDF unavailable")
            else:
                cache = {} if cache is None else cache
                if target["id"] not in cache:
                    goal = np.array(target["position"], dtype=float)
                    goal[2] += params.approach_height
                    cache[target["id"]] = reachability_score(chain, goal, params)
                reach = cache[target["id"]]
        elif kind != "place" and (
            normalize(intent.get("target_object", ""))
            and find_object(objects, intent.get("target_object", "")) is None
        ):
            reach = collision = (UNAVAILABLE, "target position unknown")
        else:
            reach = collision = (1.0, "no spatial target in the world model; not checked")
    scores["reachability"], notes["reachability"] = reach
    scores["collision_free"], notes["collision_free"] = collision
    return scores, notes
