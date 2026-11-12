import numpy as np

from nora_perception.detector import detect

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
