from nora_world_model.scene_graph import SceneGraph


def cup(x=0.4, score=0.9):
    return {"id": "cup", "label": "cup", "position": [x, 0.0, 0.1], "score": score}


def test_visible_then_remembered():
    g = SceneGraph(visibility_timeout=1.0, half_life=60.0)
    g.observe([cup()], "base_link", now=100.0)
    ok, answer, objs = g.query("object", "cup", now=100.5)
    assert ok and objs[0]["visible"] and "currently visible" in answer

    g.observe([], "base_link", now=101.0)  # camera frame without the cup
    ok, answer, objs = g.query("object", "cup", now=161.0)
    assert ok and not objs[0]["visible"]
    assert "not currently visible" in answer and "remembered" in answer
    assert objs[0]["position"] == [0.4, 0.0, 0.1]
    assert abs(g.confidence(objs[0], 160.0) - 0.45) < 1e-6  # one half-life


def test_visibility_times_out_without_frames():
    g = SceneGraph(visibility_timeout=1.0)
    g.observe([cup()], "base_link", now=100.0)
    assert g.query("visible", "", now=100.5)[2]
    assert not g.query("visible", "", now=102.0)[2]


def test_stale_observation_becomes_unknown():
    g = SceneGraph(stale_after=300.0)
    g.observe([cup()], "base_link", now=0.0)
    _, answer, objs = g.query("object", "cup", now=301.0)
    assert objs[0]["state"] == "unknown"
    assert g.confidence(objs[0], 301.0) == 0.0
    assert "no longer be trusted" in answer


def test_manipulation_updates_and_holding_query():
    g = SceneGraph()
    g.observe([cup()], "base_link", now=0.0)
    g.update("cup", "grasped", "", now=1.0)
    _, answer, objs = g.query("holding", "", now=1.0)
    assert [o["id"] for o in objs] == ["cup"] and "holding cup" in answer

    g.update("cup", "placed", "shelf", now=2.0, frame="base_link", position=[0.1, 0.5, 0.3])
    assert not g.query("holding", "", now=2.0)[2]
    _, answer, objs = g.query("object", "cup", now=10.0)
    assert objs[0]["state"] == "placed" and objs[0]["location"] == "shelf"
    assert "The robot placed it" in answer and "shelf" in answer


def test_missing_object_is_redetected_and_moved_is_flagged():
    g = SceneGraph(moved_threshold=0.05)
    g.observe([cup()], "base_link", now=0.0)
    g.update("cup", "missing", "", now=1.0)
    assert "missing" in g.query("object", "cup", now=1.0)[1]
    g.observe([cup()], "base_link", now=2.0)
    assert g.objects["cup"]["state"] == "detected"
    g.observe([cup(x=0.6)], "base_link", now=3.0)
    assert g.objects["cup"]["state"] == "moved"


def test_persistence_across_restart(tmp_path):
    path = str(tmp_path / "world.json")
    g = SceneGraph()
    g.observe([cup()], "base_link", now=0.0)
    g.save(path)

    restarted = SceneGraph()
    assert restarted.load(path) == 1
    ok, answer, objs = restarted.query("object", "cup", now=30.0)
    assert ok and not objs[0]["visible"] and "remembered" in answer
    assert restarted.load(str(tmp_path / "absent.json")) == 1  # missing file changes nothing


def test_unknown_object_and_query():
    g = SceneGraph()
    assert g.query("object", "cup", now=0.0)[0] is False
    assert g.query("nonsense", "", now=0.0)[0] is False
