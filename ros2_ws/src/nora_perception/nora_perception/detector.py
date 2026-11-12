"""Colour-keyed object detection on an aligned RGB-D frame. No ROS imports."""

from __future__ import annotations

import cv2
import numpy as np


def detect(
    bgr: np.ndarray,
    depth_m: np.ndarray,
    fx: float,
    fy: float,
    cx: float,
    cy: float,
    specs: list[tuple[str, int, int]],
    min_saturation: int = 80,
    min_value: int = 40,
    min_area_px: int = 150,
) -> list[dict]:
    """Find the largest blob of each colour and deproject it to 3D.

    specs: ``(label, hue_min, hue_max)`` in OpenCV hue units (0-179). A range
    with ``hue_min > hue_max`` wraps around 0, which is what red needs.

    Returns one dict per detected label: ``label``, ``position`` (x, y, z in
    the camera optical frame, metres; z is the median depth of the blob, i.e.
    the visible surface), ``size`` (width, height in metres) and ``score``
    (blob area relative to four times the minimum area, capped at 1).
    """
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    valid = np.isfinite(depth_m) & (depth_m > 0)
    detections = []
    for label, hue_min, hue_max in specs:
        if hue_min <= hue_max:
            mask = cv2.inRange(hsv, (hue_min, min_saturation, min_value), (hue_max, 255, 255))
        else:
            mask = cv2.inRange(hsv, (hue_min, min_saturation, min_value), (179, 255, 255))
            mask |= cv2.inRange(hsv, (0, min_saturation, min_value), (hue_max, 255, 255))
        contours = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[-2]
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(contour)
        if area < min_area_px:
            continue
        blob = np.zeros(mask.shape, np.uint8)
        cv2.drawContours(blob, [contour], -1, 255, -1)
        depths = depth_m[(blob > 0) & valid]
        if depths.size == 0:
            continue
        z = float(np.median(depths))
        moments = cv2.moments(contour)
        u = moments["m10"] / moments["m00"]
        v = moments["m01"] / moments["m00"]
        _, _, width, height = cv2.boundingRect(contour)
        detections.append({
            "label": label,
            "position": ((u - cx) * z / fx, (v - cy) * z / fy, z),
            "size": (width * z / fx, height * z / fy),
            "score": min(1.0, area / (4.0 * min_area_px)),
        })
    return detections
