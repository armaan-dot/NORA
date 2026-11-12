"""Object detection on an aligned RGB-D frame. No ROS imports.

Two detectors share the same output format:
- :class:`YoloxDetector`: YOLOX (Apache-2.0) trained on COCO, run with onnxruntime.
- :func:`detect`: colour blobs, for plain primitives that COCO has no class for.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

COCO_CLASSES = (
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
    "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant",
    "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
    "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors",
    "teddy bear", "hair drier", "toothbrush",
)


def _deproject(u: float, v: float, z: float, fx: float, fy: float, cx: float, cy: float):
    return ((u - cx) * z / fx, (v - cy) * z / fy, z)


class YoloxDetector:
    """COCO object detector. ``model_path`` is a YOLOX ``.onnx`` export."""

    def __init__(self, model_path: str, input_size: int = 416) -> None:
        import onnxruntime

        self._session = onnxruntime.InferenceSession(
            model_path, providers=["CPUExecutionProvider"]
        )
        self._input = self._session.get_inputs()[0].name
        self._size = input_size
        grids, strides = [], []
        for stride in (8, 16, 32):
            n = input_size // stride
            xv, yv = np.meshgrid(np.arange(n), np.arange(n))
            grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
            strides.append(np.full((n * n, 1), stride))
        self._grid = np.concatenate(grids).astype(np.float32)
        self._stride = np.concatenate(strides).astype(np.float32)

    def boxes(self, bgr: np.ndarray, score_threshold: float = 0.35, nms_threshold: float = 0.45,
              classes: set[str] | None = None) -> list[tuple[str, float, tuple[int, int, int, int]]]:
        """Return ``(class_name, score, (x, y, w, h))`` boxes in image pixels."""
        h, w = bgr.shape[:2]
        r = min(self._size / h, self._size / w)
        padded = np.full((self._size, self._size, 3), 114, np.uint8)
        padded[: int(h * r), : int(w * r)] = cv2.resize(bgr, (int(w * r), int(h * r)))
        blob = padded.transpose(2, 0, 1)[None].astype(np.float32)
        out = self._session.run(None, {self._input: blob})[0][0]

        xy = (out[:, :2] + self._grid) * self._stride / r
        wh = np.exp(out[:, 2:4]) * self._stride / r
        scores = out[:, 4:5] * out[:, 5:]
        cls = scores.argmax(1)
        best = scores[np.arange(len(cls)), cls]
        keep = best >= score_threshold
        if classes is not None:
            keep &= np.isin(cls, [i for i, n in enumerate(COCO_CLASSES) if n in classes])
        xywh = np.concatenate([xy - wh / 2, wh], 1)[keep]
        cls, best = cls[keep], best[keep]

        result = []
        for c in np.unique(cls):
            idx = np.where(cls == c)[0]
            kept = cv2.dnn.NMSBoxes(xywh[idx].tolist(), best[idx].tolist(),
                                    score_threshold, nms_threshold)
            for k in np.array(kept).reshape(-1):
                x, y, bw, bh = xywh[idx[k]]
                result.append((COCO_CLASSES[c], float(best[idx[k]]),
                               (int(x), int(y), int(bw), int(bh))))
        return result


def locate_boxes(
    boxes: list[tuple[str, float, tuple[int, int, int, int]]],
    depth_m: np.ndarray,
    fx: float, fy: float, cx: float, cy: float,
) -> list[dict]:
    """Deproject 2D boxes using the depth inside each box.

    Depth is the 30th percentile of the central half of the box: the object's
    near surface rather than the table behind it. Boxes without valid depth
    are dropped.
    """
    h, w = depth_m.shape
    detections = []
    for label, score, (x, y, bw, bh) in boxes:
        x0, x1 = max(0, x + bw // 4), min(w, x + 3 * bw // 4 + 1)
        y0, y1 = max(0, y + bh // 4), min(h, y + 3 * bh // 4 + 1)
        region = depth_m[y0:y1, x0:x1]
        region = region[np.isfinite(region) & (region > 0)]
        if region.size == 0:
            continue
        z = float(np.percentile(region, 30))
        detections.append({
            "label": label.replace(" ", "_"),
            "position": _deproject(x + bw / 2, y + bh / 2, z, fx, fy, cx, cy),
            "size": (bw * z / fx, bh * z / fy),
            "score": score,
        })
    return detections


def merge(primary: list[dict], extra: list[dict], min_separation: float = 0.04) -> list[dict]:
    """Add *extra* detections that are not within *min_separation* of a *primary* one."""
    return primary + [
        e for e in extra
        if all(math.dist(e["position"], p["position"]) >= min_separation for p in primary)
    ]


def assign_ids(detections: list[dict], previous: dict[str, tuple[str, tuple]],
               max_jump: float = 0.10) -> list[str]:
    """Give each detection a stable id: ``label`` for the first instance, ``label_2``... after.

    An instance keeps the id of the nearest same-label detection from the
    previous frame within *max_jump* metres, so two cups do not swap ids.
    """
    ids: list[str] = [""] * len(detections)
    taken: set[str] = set()
    pairs = sorted(
        (math.dist(d["position"], pos), i, pid)
        for i, d in enumerate(detections)
        for pid, (label, pos) in previous.items()
        if label == d["label"]
    )
    for dist, i, pid in pairs:
        if dist <= max_jump and not ids[i] and pid not in taken:
            ids[i] = pid
            taken.add(pid)
    for i, d in enumerate(detections):
        if not ids[i]:
            n = 1
            while (pid := d["label"] if n == 1 else f"{d['label']}_{n}") in taken:
                n += 1
            ids[i] = pid
            taken.add(pid)
    return ids


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
            "position": _deproject(u, v, z, fx, fy, cx, cy),
            "size": (width * z / fx, height * z / fy),
            "score": min(1.0, area / (4.0 * min_area_px)),
        })
    return detections
