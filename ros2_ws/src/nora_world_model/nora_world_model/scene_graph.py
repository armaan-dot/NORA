"""Scene graph behind the world-model node. No ROS imports, so it can be unit-tested."""

from __future__ import annotations

import json
import math
import os
from typing import Optional

STATES = ("detected", "grasped", "moved", "placed", "missing", "unknown")
IDENTITY = [0.0, 0.0, 0.0, 1.0]


def normalize(name: str) -> str:
    return name.strip().lower().replace(" ", "_")


class SceneGraph:
    """Objects keyed by id. Times are epoch seconds so they survive restarts."""

    def __init__(
        self,
        visibility_timeout: float = 1.0,
        half_life: float = 60.0,
        stale_after: float = 300.0,
        moved_threshold: float = 0.05,
    ) -> None:
        self.visibility_timeout = visibility_timeout
        self.half_life = half_life
        self.stale_after = stale_after
        self.moved_threshold = moved_threshold
        self.objects: dict[str, dict] = {}
        self.dirty = False

    # -- updates -----------------------------------------------------------

    def observe(self, detections: list[dict], frame: str, now: float) -> None:
        """Apply one perception frame. Objects absent from it stop being visible.

        Each detection: ``{"id", "label", "position", "orientation", "score"}``
        with the pose already expressed in ``frame``.
        """
        seen = set()
        for det in detections:
            oid = normalize(det["id"])
            if not oid:
                continue
            seen.add(oid)
            obj = self.objects.get(oid)
            if obj is None:
                obj = self.objects[oid] = {"id": oid, "state": "detected", "location": ""}
            elif obj["state"] in ("missing", "unknown"):
                obj["state"] = "detected"
            elif obj["state"] != "grasped" and (
                math.dist(obj["position"], det["position"]) > self.moved_threshold
            ):
                obj["state"] = "moved"
                obj["location"] = ""
            obj.update(
                label=det.get("label") or oid,
                frame=frame,
                position=[float(v) for v in det["position"]],
                orientation=[float(v) for v in det.get("orientation") or IDENTITY],
                score=float(det.get("score", 1.0)),
                visible=True,
                last_seen=now,
                stamp=now,
            )
        for oid, obj in self.objects.items():
            if oid not in seen:
                obj["visible"] = False
        self.dirty = True

    def refresh(self, now: float) -> None:
        """Expire visibility and demote long-unobserved objects to ``unknown``."""
        for obj in self.objects.values():
            if obj["visible"] and now - obj["last_seen"] > self.visibility_timeout:
                obj["visible"] = False
                self.dirty = True
            if (
                not obj["visible"]
                and obj["state"] not in ("grasped", "missing", "unknown")
                and now - obj["stamp"] > self.stale_after
            ):
                obj["state"] = "unknown"
                self.dirty = True

    def update(
        self,
        object_id: str,
        state: str,
        location: str,
        now: float,
        frame: str = "",
        position: Optional[list] = None,
        orientation: Optional[list] = None,
    ) -> dict:
        """Record a manipulation outcome. A pose is given when the gripper pose is known."""
        if state not in STATES:
            raise ValueError(f"unknown state {state!r}; expected one of {STATES}")
        oid = normalize(object_id)
        if not oid:
            raise ValueError("object_id must not be empty")
        obj = self.objects.get(oid)
        if obj is None:
            obj = self.objects[oid] = {
                "id": oid, "label": oid, "frame": frame, "position": [0.0, 0.0, 0.0],
                "orientation": list(IDENTITY), "score": 1.0,
                "visible": False, "last_seen": 0.0, "stamp": now, "location": "",
            }
        obj["state"] = state
        if state == "grasped":
            obj["location"] = "gripper"
        elif location:
            obj["location"] = location
        if position is not None:
            obj.update(frame=frame, position=[float(v) for v in position],
                       orientation=[float(v) for v in orientation or IDENTITY])
        if state == "missing":
            # Keep the old stamp: the pose is still the last real knowledge.
            obj["visible"] = False
        else:
            obj["stamp"] = now
        self.dirty = True
        return obj

    def set_pose(self, object_id: str, frame: str, position: list, orientation: list,
                 now: float) -> None:
        """Move a held object with the gripper (not persisted on every call)."""
        obj = self.objects[object_id]
        obj.update(frame=frame, position=list(position), orientation=list(orientation), stamp=now)

    # -- queries -----------------------------------------------------------

    def confidence(self, obj: dict, now: float) -> float:
        if obj["state"] in ("missing", "unknown"):
            return 0.0
        if obj["visible"]:
            return obj["score"]
        if obj["state"] == "grasped":
            return 1.0
        age = max(0.0, now - obj["stamp"])
        return obj["score"] * 0.5 ** (age / self.half_life)

    def find(self, name: str) -> list[dict]:
        key = normalize(name)
        exact = [o for o in self.objects.values() if key in (o["id"], normalize(o["label"]))]
        return exact or [
            o for o in self.objects.values() if key and (key in o["id"] or o["id"] in key)
        ]

    def describe(self, obj: dict, now: float) -> str:
        where = "({:.2f}, {:.2f}, {:.2f}) in {}".format(*obj["position"], obj["frame"] or "?")
        if obj["location"] and obj["location"] != "gripper":
            where += f" ({obj['location']})"
        if obj["state"] == "grasped":
            return f"The robot is holding {obj['id']}."
        if obj["visible"]:
            return f"{obj['id']} is currently visible at {where}."
        age = _age(now - obj["stamp"])
        if obj["state"] == "missing":
            return (f"{obj['id']} is missing: it was not found at its last known position "
                    f"{where}, recorded {age} ago.")
        if obj["state"] == "unknown":
            return (f"{obj['id']} has not been observed for {age}; its last known position "
                    f"{where} can no longer be trusted.")
        verb = {"placed": "The robot placed it", "moved": "It was last seen, moved,"}.get(
            obj["state"], "It was last seen")
        return (f"{obj['id']} is not currently visible. {verb} {age} ago at {where} "
                f"(remembered, confidence {self.confidence(obj, now):.2f}).")

    def query(self, kind: str, object_id: str, now: float) -> tuple[bool, str, list[dict]]:
        self.refresh(now)
        if kind == "object":
            found = self.find(object_id)
            if not found:
                return False, f"No object matching '{object_id}' has been observed.", []
            return True, " ".join(self.describe(o, now) for o in found), found
        if kind == "visible":
            found = [o for o in self.objects.values() if o["visible"]]
            names = ", ".join(o["id"] for o in found)
            return True, (f"Currently visible: {names}." if found
                          else "No objects are currently visible."), found
        if kind == "holding":
            found = [o for o in self.objects.values() if o["state"] == "grasped"]
            return True, (" ".join(self.describe(o, now) for o in found) if found
                          else "The robot is not holding anything."), found
        if kind in ("all", ""):
            found = list(self.objects.values())
            return True, " ".join(self.describe(o, now) for o in found) or "No objects known.", found
        return False, f"Unsupported query '{kind}'.", []

    # -- persistence -------------------------------------------------------

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"version": 1, "objects": list(self.objects.values())}, fh)
        os.replace(tmp, path)
        self.dirty = False

    def load(self, path: str) -> int:
        """Load remembered objects. Nothing is visible until perception reports it again."""
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError:
            return 0
        for obj in data.get("objects", []):
            obj["visible"] = False
            self.objects[obj["id"]] = obj
        return len(self.objects)


def _age(seconds: float) -> str:
    seconds = max(0.0, seconds)
    if seconds < 90:
        return f"{seconds:.0f} s"
    if seconds < 5400:
        return f"{seconds / 60:.0f} min"
    return f"{seconds / 3600:.1f} h"
