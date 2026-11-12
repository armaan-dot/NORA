import numpy as np

from nora_perception.detector import (
    COCO_CLASSES, YoloxDetector, assign_ids, detect, locate_boxes, merge,
)

SPECS = [("red_cube", 170, 10), ("blue_cylinder", 100, 130), ("green_sphere", 45, 85)]
FX = FY = 500.0
CX, CY = 320.0, 240.0


def frame():
    return np.zeros((480, 640, 3), np.uint8), np.full((480, 640), 1.0, np.float32)


def test_red_blob_is_deprojected_to_3d():
    bgr, depth = frame()
    bgr[200:240, 400:440] = (0, 0, 255)
    depth[200:240, 400:440] = 0.9
    found = detect(bgr, depth, FX, FY, CX, CY, SPECS)
    assert [d["label"] for d in found] == ["red_cube"]
    x, y, z = found[0]["position"]
    assert abs(z - 0.9) < 1e-6
    assert abs(x - (419.5 - CX) * 0.9 / FX) < 2e-3
    assert abs(y - (219.5 - CY) * 0.9 / FY) < 2e-3
    assert abs(found[0]["size"][0] - 40 * 0.9 / FX) < 2e-3


def test_each_colour_gets_its_label():
    bgr, depth = frame()
    bgr[50:90, 50:90] = (255, 0, 0)
    bgr[300:340, 100:140] = (0, 255, 0)
    assert {d["label"] for d in detect(bgr, depth, FX, FY, CX, CY, SPECS)} == {
        "blue_cylinder", "green_sphere"}


def test_small_grey_or_depthless_blobs_are_ignored():
    bgr, depth = frame()
    bgr[10:15, 10:15] = (0, 0, 255)          # too small
    bgr[100:160, 100:160] = (128, 128, 128)  # no saturation
    bgr[300:360, 300:360] = (255, 0, 0)      # no valid depth
    depth[300:360, 300:360] = np.nan
    assert detect(bgr, depth, FX, FY, CX, CY, SPECS) == []


class _FakeSession:
    def __init__(self, output):
        self.output = output

    def run(self, _names, _feeds):
        return [self.output]


def _yolox(output, size=416):
    det = YoloxDetector.__new__(YoloxDetector)
    det._session, det._input, det._size = _FakeSession(output), "images", size
    grids, strides = [], []
    for stride in (8, 16, 32):
        n = size // stride
        xv, yv = np.meshgrid(np.arange(n), np.arange(n))
        grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
        strides.append(np.full((n * n, 1), stride))
    det._grid = np.concatenate(grids).astype(np.float32)
    det._stride = np.concatenate(strides).astype(np.float32)
    return det


def test_yolox_output_is_decoded_to_image_boxes():
    out = np.zeros((1, 3549, 85), np.float32)
    cup = COCO_CLASSES.index("cup")
    # Anchor (10, 5) on the stride-8 grid: centre (84, 44) px in the 416 input.
    anchor = 5 * 52 + 10
    out[0, anchor, :4] = [0.5, 0.5, np.log(4.0), np.log(2.0)]  # 32 x 16 px box
    out[0, anchor, 4] = 0.9
    out[0, anchor, 5 + cup] = 0.8
    out[0, anchor + 1, :5] = [0.5, 0.5, np.log(4.0), np.log(2.0), 0.9]
    out[0, anchor + 1, 5 + cup] = 0.7  # overlapping duplicate, removed by NMS
    bgr = np.zeros((832, 832, 3), np.uint8)  # scale 0.5 into the 416 input
    boxes = _yolox(out).boxes(bgr, classes={"cup"})
    assert len(boxes) == 1
    label, score, (x, y, w, h) = boxes[0]
    assert label == "cup" and abs(score - 0.72) < 1e-5
    assert (x, y, w, h) == (136, 72, 64, 32)
    assert _yolox(out).boxes(bgr, classes={"bottle"}) == []


def test_box_depth_uses_near_surface_and_deprojects():
    depth = np.full((480, 640), 1.0, np.float32)
    depth[200:280, 300:340] = 0.8
    found = locate_boxes([("wine glass", 0.9, (300, 200, 40, 80))], depth, FX, FY, CX, CY)
    assert found[0]["label"] == "wine_glass"
    x, y, z = found[0]["position"]
    assert abs(z - 0.8) < 1e-6 and abs(x) < 1e-6 and abs(y) < 1e-6


def test_colour_detection_wins_over_duplicate_model_detection():
    colour = [{"label": "green_sphere", "position": (0.5, 0.0, 0.1)}]
    model = [{"label": "sports_ball", "position": (0.51, 0.0, 0.1)},
             {"label": "cup", "position": (0.3, 0.2, 0.1)}]
    assert [d["label"] for d in merge(colour, model)] == ["green_sphere", "cup"]


def test_ids_stay_with_the_nearest_instance():
    first = [{"label": "cup", "position": (0.3, 0.0, 0.1)},
             {"label": "cup", "position": (0.6, 0.0, 0.1)}]
    ids = assign_ids(first, {})
    assert ids == ["cup", "cup_2"]
    tracks = {i: (d["label"], d["position"]) for i, d in zip(ids, first)}
    swapped = [first[1], {"label": "cup", "position": (0.31, 0.0, 0.1)}]
    assert assign_ids(swapped, tracks) == ["cup_2", "cup"]
