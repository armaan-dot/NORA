import math

import numpy as np
import pytest

from nora_affordance import scoring

TWO_LINK = """
<robot name="two_link">
  <link name="base_link"/><link name="upper"/><link name="lower"/><link name="tcp"/>
  <joint name="shoulder" type="revolute">
    <parent link="base_link"/><child link="upper"/>
    <origin xyz="0 0 0.1" rpy="0 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
  <joint name="elbow" type="revolute">
    <parent link="upper"/><child link="lower"/>
    <origin xyz="0.3 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
  <joint name="tip" type="fixed">
    <parent link="lower"/><child link="tcp"/><origin xyz="0.2 0 0"/>
  </joint>
</robot>
"""

ARM_JOINTS = [f"joint{i}" for i in range(1, 7)]


def arm_urdf():
    """Six revolute joints stacked along z, then a gripper joint that is not part of the arm."""
    spec = [
        ("joint1", "0 0 0.10", "0 0 1"), ("joint2", "0 0 0.15", "0 1 0"),
        ("joint3", "0 0 0.20", "0 1 0"), ("joint4", "0 0 0.18", "0 0 1"),
        ("joint5", "0 0 0.14", "0 1 0"), ("joint6", "0 0 0.10", "0 0 1"),
        ("gripper_joint", "0 0 0.06", "1 0 0"),
    ]
    links = ["base_link"] + [f"link{i}" for i in range(1, 7)] + ["gripper_link"]
    xml = "".join(f'<link name="{name}"/>' for name in links)
    for (name, xyz, axis), parent, child in zip(spec, links, links[1:]):
        xml += (
            f'<joint name="{name}" type="revolute"><parent link="{parent}"/>'
            f'<child link="{child}"/><origin xyz="{xyz}"/><axis xyz="{axis}"/>'
            f'<limit lower="-3.14159" upper="3.14159" effort="1" velocity="1"/></joint>'
        )
    return f'<robot name="arm">{xml}</robot>'


def obj(oid, x, y, z, state="detected", confidence=0.9):
    return {"id": oid, "label": oid, "position": [x, y, z], "state": state,
            "visible": True, "confidence": confidence}


def test_fk_of_two_link_chain():
    chain = scoring.parse_chain(TWO_LINK)
    assert chain.names == ["shoulder", "elbow"] and chain.tip == "tcp"
    assert np.allclose(chain.fk([0.0, 0.0])[:3, 3], [0.5, 0.0, 0.1])
    assert np.allclose(chain.fk([math.pi / 2, 0.0])[:3, 3], [0.0, 0.5, 0.1])
    assert np.allclose(chain.fk([0.0, math.pi / 2])[:3, 3], [0.3, 0.2, 0.1])
    centre, radius = chain.reach()
    assert np.allclose(centre, [0.0, 0.0, 0.1]) and radius == pytest.approx(0.5)


def test_chain_falls_back_to_gripper_link_and_named_joints():
    chain = scoring.parse_chain(arm_urdf(), active_joints=ARM_JOINTS)
    assert chain.tip == "gripper_link" and chain.names == ARM_JOINTS
    assert np.allclose(chain.fk([0.0] * 6)[:3, 3], [0.0, 0.0, 0.93])
    with pytest.raises(ValueError):
        scoring.parse_chain(arm_urdf(), base_link="nowhere")


def test_ik_reaches_a_reachable_point_tool_down():
    chain = scoring.parse_chain(arm_urdf(), active_joints=ARM_JOINTS)
    target = [0.35, 0.1, 0.07]
    q, pos_err, ang_err = scoring.solve_ik(chain, target)
    pose = chain.fk(q)
    assert pos_err < 0.01 and np.linalg.norm(pose[:3, 3] - target) < 0.01
    assert pose[2, 2] < -0.98  # tool z axis points down
    assert np.all(q >= chain.lower) and np.all(q <= chain.upper)
    assert scoring.reachability_score(chain, target)[0] == 1.0


def test_ik_fails_an_unreachable_point():
    chain = scoring.parse_chain(arm_urdf(), active_joints=ARM_JOINTS)
    score, reason = scoring.reachability_score(chain, [2.0, 0.0, 0.1])
    assert score == 0.0 and "max reach" in reason
    # Inside the reach sphere, but too far out to point the tool down.
    score, reason = scoring.reachability_score(chain, [0.75, 0.0, 0.12])
    assert score < 0.5 and "residual" in reason


def test_clearance_falls_with_a_nearby_taller_object():
    target = obj("cube", 0.4, 0.0, 0.02)

    def score(*others):
        return scoring.clearance_score(target, [target, *others])[0]

    assert score() == 1.0
    far = score(obj("box", 0.6, 0.0, 0.10))
    near = score(obj("box", 0.52, 0.0, 0.10))
    close = score(obj("box", 0.45, 0.0, 0.10))
    assert far == 1.0 and near == pytest.approx(0.9) and close == pytest.approx(0.2)
    assert score(obj("box", 0.41, 0.0, 0.10)) == 0.0
    assert score(obj("box", 0.45, 0.0, 0.02)) == 1.0  # not higher than the target
    assert score(obj("box", 0.45, 0.0, 0.10, state="missing")) == 1.0


def test_object_state_rules():
    def score(skill, objects, target="cup"):
        return scoring.object_state_score(skill, {"target_object": target}, objects)[0]

    assert score("pick", None) == scoring.UNAVAILABLE
    assert score("pick", []) == 0.0
    assert score("pick", [obj("cup", 0.4, 0, 0, confidence=0.7)]) == pytest.approx(0.7)
    assert score("pick", [obj("cup", 0.4, 0, 0)], target="Cup") == pytest.approx(0.9)
    assert score("pick", [obj("cup", 0.4, 0, 0, state="missing")]) == 0.0
    assert score("pick", [obj("cup", 0.4, 0, 0, state="unknown")]) == 0.0
    assert score("pick", [obj("cup", 0.4, 0, 0, state="grasped")]) == 0.0
    assert score("place", [obj("cup", 0.4, 0, 0, state="grasped")]) == 1.0
    assert score("place", [obj("cup", 0.4, 0, 0)]) == pytest.approx(0.1)  # nothing held
    assert score("place", [obj("pen", 0.4, 0, 0, state="grasped")], target="") == 1.0
    assert score("go_home", None) == 1.0
    assert score("open_gripper", []) == 1.0


def test_feasibility_reports_missing_inputs():
    intent = {"action": "pick", "target_object": "cup", "target_location": ""}
    scores, notes = scoring.feasibility_scores("pick", intent, None, None)
    assert set(scores.values()) == {scoring.UNAVAILABLE}
    assert "world model unavailable" in notes["reachability"]

    scores, notes = scoring.feasibility_scores("pick", intent, [obj("cup", 0.35, 0.1, 0.05)], None)
    assert scores["reachability"] == scoring.UNAVAILABLE and "URDF" in notes["reachability"]
    assert scores["collision_free"] == 1.0 and scores["object_state"] == pytest.approx(0.9)

    scores, _ = scoring.feasibility_scores("go_home", intent, None, None)
    assert set(scores.values()) == {1.0}


def test_feasibility_of_pick_with_world_and_chain():
    chain = scoring.parse_chain(arm_urdf(), active_joints=ARM_JOINTS)
    intent = {"action": "pick", "target_object": "cup", "target_location": ""}
    scores, _ = scoring.feasibility_scores("pick", intent, [obj("cup", 0.35, 0.1, 0.05)], chain)
    assert scores == {"object_state": pytest.approx(0.9), "reachability": 1.0,
                      "collision_free": 1.0}


def test_usefulness_follows_action_and_confidence():
    intent = {"action": "pick", "confidence": 0.8}
    assert scoring.usefulness_score("pick", intent) == pytest.approx(0.8)
    assert scoring.usefulness_score("pick_red_cube", intent) == pytest.approx(0.8)
    assert scoring.usefulness_score("go_home", intent) == pytest.approx(0.24)
    assert scoring.usefulness_score("pick", {"action": "explicit_blocked", "confidence": 1.0}) == 0.0
    assert scoring.usefulness_score("pick", {"action": "unknown", "confidence": 1.0}) < 0.2
