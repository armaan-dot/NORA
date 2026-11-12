from nora_orchestrator.replanner import replan

PICK_AND_PLACE = [
    {"skill": "move_to_pose", "params": {"pose_name": "pre_grasp", "target": "cup"}},
    {"skill": "open_gripper", "params": {"stroke_mm": 80}},
    {"skill": "pick", "params": {"target_object": "cup"}},
    {"skill": "move_to_pose", "params": {"pose_name": "approach_target", "target": "shelf"}},
    {"skill": "place", "params": {"target_location": "shelf", "target_object": "cup"}},
    {"skill": "open_gripper", "params": {"stroke_mm": 80}},
    {"skill": "go_home", "params": {}},
]


def skills(plan):
    return [step["skill"] for step in plan]


def failure(index, code="SKILL_ABORTED"):
    return {"index": index, "skill": PICK_AND_PLACE[index]["skill"], "code": code, "reason": ""}


def test_failed_grasp_retreats_and_reapproaches():
    world = [{"id": "cup", "label": "cup", "state": "detected", "visible": True}]
    plan = replan(PICK_AND_PLACE, failure(2), world)
    assert skills(plan) == ["go_home"] + skills(PICK_AND_PLACE)


def test_failed_place_while_holding_keeps_the_object():
    world = [{"id": "cup", "label": "cup", "state": "grasped", "visible": False}]
    plan = replan(PICK_AND_PLACE, failure(4), world)
    assert skills(plan) == ["go_home", "move_to_pose", "place", "open_gripper", "go_home"]


def test_failed_place_after_drop_picks_again():
    world = [{"id": "cup", "label": "cup", "state": "detected", "visible": True}]
    plan = replan(PICK_AND_PLACE, failure(4, "PRECONDITION"), world)
    assert skills(plan) == [
        "go_home", "move_to_pose", "open_gripper", "pick",
        "move_to_pose", "place", "open_gripper", "go_home",
    ]


def test_failed_go_home_is_retried_without_extra_steps():
    assert skills(replan(PICK_AND_PLACE, failure(6), [])) == ["go_home"]


def test_failure_without_a_step_has_no_recovery():
    assert replan(PICK_AND_PLACE, {"index": -1, "skill": "", "code": "", "reason": ""}, []) is None
