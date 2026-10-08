"""Physical environment and robot state representations for affordance evaluation.

Defines :class:`WorldState`, :class:`RobotState`, and :class:`WorldObject`
which supply the physical context for computing feasibility in SayCan-style
affordance scoring.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass
class RobotState:
    """State of the robot arm and end-effector.

    Attributes
    ----------
    gripper_state:
        Current gripper configuration: ``"open"``, ``"closed"``, or ``"holding"``.
    held_object:
        Identifier of the object currently held in the gripper, or ``None``.
    current_pose:
        Named pose of the robot arm (e.g. ``"home"``, ``"table"``).
    reach_radius_min:
        Minimum reach distance from arm base in meters (default 0.15m).
    reach_radius_max:
        Maximum reach distance from arm base in meters (default 0.85m).
    """

    gripper_state: str = "open"  # "open", "closed", "holding"
    held_object: str | None = None
    current_pose: str = "home"
    reach_radius_min: float = 0.15
    reach_radius_max: float = 0.85

    def is_reachable(self, x: float, y: float, z: float = 0.0) -> bool:
        """Check whether coordinates (x, y, z) are within the robot workspace."""
        dist = math.sqrt(x**2 + y**2 + z**2)
        return self.reach_radius_min <= dist <= self.reach_radius_max


@dataclass
class WorldObject:
    """Perceived object in the robot workspace.

    Attributes
    ----------
    name:
        Canonical object identifier (e.g. ``"water_glass"``, ``"apple"``).
    position:
        3D coordinate tuple (x, y, z) in meters relative to robot base.
    is_grasped:
        True if the object is currently grasped.
    is_visible:
        True if the object is actively detected by vision perception.
    is_graspable:
        True if the geometry and material allow grasping.
    is_obstructed:
        True if path or clearance to the object has an obstacle.
    """

    name: str
    position: tuple[float, float, float] = (0.45, 0.10, 0.05)
    is_grasped: bool = False
    is_visible: bool = True
    is_graspable: bool = True
    is_obstructed: bool = False


@dataclass
class Location:
    """Named placement destination or area.

    Attributes
    ----------
    name:
        Location name (e.g. ``"table"``, ``"trash_bin"``, ``"shelf"``, ``"user"``).
    position:
        3D coordinate tuple (x, y, z) in meters.
    reachable:
        True if destination is within manipulator reach.
    """

    name: str
    position: tuple[float, float, float] = (0.50, -0.25, 0.05)
    reachable: bool = True


@dataclass
class WorldState:
    """Full environmental state passed into affordance scoring.

    Attributes
    ----------
    robot:
        Current arm and gripper state.
    objects:
        Dictionary of known or perceived objects mapped by name.
    locations:
        Dictionary of placement locations mapped by name.
    """

    robot: RobotState = field(default_factory=RobotState)
    objects: dict[str, WorldObject] = field(default_factory=dict)
    locations: dict[str, Location] = field(default_factory=dict)

    @classmethod
    def default(cls) -> "WorldState":
        """Construct standard reachable tabletop environment with default items."""
        state = cls()
        # Common tabletop items
        default_items = [
            ("water_glass", (0.40, 0.15, 0.05)),
            ("water", (0.40, 0.15, 0.05)),
            ("glass", (0.40, 0.15, 0.05)),
            ("water_bottle", (0.45, 0.20, 0.08)),
            ("coke", (0.38, 0.22, 0.06)),
            ("apple", (0.42, -0.10, 0.04)),
            ("banana", (0.44, -0.15, 0.03)),
            ("snack", (0.44, -0.15, 0.03)),
            ("red_cube", (0.35, 0.00, 0.03)),
            ("blue_cube", (0.38, -0.05, 0.03)),
            ("screwdriver", (0.48, 0.05, 0.02)),
            ("pen", (0.32, 0.12, 0.01)),
            ("stapler", (0.46, -0.18, 0.04)),
            ("tissue_box", (0.50, 0.25, 0.07)),
            ("sponge", (0.36, -0.22, 0.03)),
            ("trash", (0.35, -0.30, 0.02)),
        ]
        for name, pos in default_items:
            state.objects[name] = WorldObject(name=name, position=pos)

        # Standard locations
        default_locs = [
            ("table", (0.45, 0.00, 0.00), True),
            ("user", (0.30, 0.00, 0.20), True),
            ("trash_bin", (0.60, -0.40, -0.10), True),
            ("recycle_bin", (0.60, -0.50, -0.10), True),
            ("shelf", (0.55, 0.35, 0.25), True),
            ("box", (0.40, -0.35, 0.05), True),
            ("storage_box", (0.40, -0.35, 0.05), True),
            ("pencil_holder", (0.30, 0.25, 0.08), True),
        ]
        for name, pos, reach in default_locs:
            state.locations[name] = Location(name=name, position=pos, reachable=reach)

        return state

    @classmethod
    def with_held_object(cls, object_name: str = "water_glass") -> "WorldState":
        """Construct state where robot is already holding an object."""
        state = cls.default()
        state.robot.gripper_state = "holding"
        state.robot.held_object = object_name
        if object_name in state.objects:
            state.objects[object_name].is_grasped = True
        return state

    @classmethod
    def with_unreachable_object(cls, object_name: str = "water_glass") -> "WorldState":
        """Construct state where target object is out of physical reach."""
        state = cls.default()
        state.objects[object_name] = WorldObject(
            name=object_name,
            position=(2.50, 2.00, 0.00),  # Beyond robot arm radius
            is_visible=True,
            is_graspable=True,
        )
        return state

    @classmethod
    def with_obstructed_object(cls, object_name: str = "water_glass") -> "WorldState":
        """Construct state where target object is blocked by an obstacle."""
        state = cls.default()
        if object_name not in state.objects:
            state.objects[object_name] = WorldObject(name=object_name)
        state.objects[object_name].is_obstructed = True
        return state

    def get_or_create_object(self, name: str) -> WorldObject:
        """Retrieve existing object or register default tabletop object."""
        if name not in self.objects:
            # Register within reach by default
            self.objects[name] = WorldObject(name=name, position=(0.45, 0.05, 0.04))
        return self.objects[name]

    def get_or_create_location(self, name: str) -> Location:
        """Retrieve existing location or register reachable default."""
        if name not in self.locations:
            self.locations[name] = Location(name=name, position=(0.40, -0.20, 0.05), reachable=True)
        return self.locations[name]
