#!/usr/bin/env python3
"""
arm_commander.py: turns a command into arm motion in Gazebo, through the ROS 2 interfaces a real arm would use.

  /nora/command (std_msgs/String, English)
     -> NLU node            /nora/parse_command               what is being asked
     -> camera perception   /nora/perception/detections       where the objects are (overhead camera)
     -> MoveIt              /compute_cartesian_path, /execute_trajectory, /move_action
          -> /arm_controller/follow_joint_trajectory          ros2_control
     -> /gripper_controller/gripper_cmd                       ros2_control

Examples: "I am thirsty", "bring me the apple", "clean the table", "put the can in the tray",
"rerack the table", "go home". Without the NLU node these still work:
  home | open | close | scan | pick <class> | place <tray|user|table>

The commander never reads object poses from Gazebo. It knows what the camera has seen (its "belief") and
where it has put things itself. It publishes that belief as /nora/scene_markers and progress on /nora/status.
The objects themselves are part of nora_gazebo/worlds/tabletop.world.
"""
import json
import math
import threading

import rclpy
from rclpy.action import ActionClient
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile

from control_msgs.action import GripperCommand
from geometry_msgs.msg import Pose
from moveit_msgs.action import ExecuteTrajectory, MoveGroup
from moveit_msgs.msg import CollisionObject, Constraints, JointConstraint, PlanningScene
from moveit_msgs.srv import GetCartesianPath
from shape_msgs.msg import SolidPrimitive
from std_msgs.msg import String
from vision_msgs.msg import Detection3DArray
from visualization_msgs.msg import Marker, MarkerArray

ARM_JOINTS = ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6"]
HOME = [-0.37, -0.35, 1.9, 0.02, -1.5708, 0.0]  # same as the SRDF "home" state and the URDF initial values
FRAME = "base_link"   # origin on the table top under the arm, so z is the height above the table
TIP = "tcp"
# tcp Z pointing straight down, fingers opening along X (x, y, z, w)
DOWN = (1.0, 0.0, 0.0, 0.0)

HOVER_Z = 0.20        # travel height of the grasp point above the table
REST = (0.37, 0.0, 0.356)  # tcp position of the home pose: the arm is clear of the camera's view of the table
CAMERA = (0.981, -0.05, 0.901)  # overhead_camera of tabletop.world, in FRAME
MIN_GRASP_Z = 0.027   # keeps the fingertips 8 mm above the table
OPEN = 0.085          # gripper_joint is the gap between the pad faces
SQUEEZE = 0.0015      # how far each pad is pressed into the object
TABLE = {"center": (0.35, -0.05), "size": (1.3, 0.9)}
TABLE_SPOTS = [(0.50, 0.00), (0.42, 0.10), (0.58, -0.10), (0.42, -0.12), (0.60, 0.08), (0.50, 0.14), (0.66, -0.02)]
ZONE_SLOTS = [(dx, dy) for dy in (-0.09, 0.0, 0.09) for dx in (-0.045, 0.045)]
# NLU location names -> zones of this scene
LOCATIONS = {
    "user": "user", "me": "user",
    "tray": "tray", "tote": "tray", "bin": "tray", "trash_bin": "tray", "recycle_bin": "tray",
    "storage_box": "tray", "desk_organizer": "tray", "pencil_holder": "tray",
    "table": "table",
}


class Abort(Exception):
    pass


class ArmCommander(Node):
    def __init__(self):
        super().__init__("nora_arm_commander")
        scene_file = self.declare_parameter("scene_file", "").value
        with open(scene_file, encoding="utf-8") as f:
            scene = json.load(f)
        self.catalogue = scene["catalogue"]
        self.zones = scene["zones"]

        group = ReentrantCallbackGroup()
        self.move = ActionClient(self, MoveGroup, "/move_action", callback_group=group)
        self.execute = ActionClient(self, ExecuteTrajectory, "/execute_trajectory", callback_group=group)
        self.gripper = ActionClient(self, GripperCommand, "/gripper_controller/gripper_cmd", callback_group=group)
        self.cartesian = self.create_client(GetCartesianPath, "/compute_cartesian_path", callback_group=group)
        self.nlu = None
        try:
            from nora_interfaces.srv import ParseCommand

            self.ParseCommand = ParseCommand
            self.nlu = self.create_client(ParseCommand, "/nora/parse_command", callback_group=group)
        except ImportError:
            self.get_logger().warn("nora_interfaces is not built: English commands are off, direct commands still work.")

        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.status_pub = self.create_publisher(String, "/nora/status", latched)
        self.marker_pub = self.create_publisher(MarkerArray, "/nora/scene_markers", 1)
        self.scene_pub = self.create_publisher(PlanningScene, "/planning_scene", 1)
        self.create_subscription(Detection3DArray, "/nora/perception/detections", self.on_detections, 1, callback_group=group)
        self.create_subscription(String, "/nora/command", self.on_command, 10, callback_group=group)
        self.create_timer(0.5, self.publish_markers, callback_group=group)

        self.seen = (0.0, [])   # (stamp, objects) of the latest camera result
        self.fresh = threading.Condition()
        self.belief = []        # [{"class", "x", "y"}]: what the robot thinks is on the table
        self.held = None        # class of the object in the gripper
        self.busy = threading.Lock()
        threading.Thread(target=self.setup, daemon=True).start()

    # ------------------------------------------------------------------ helpers
    def say(self, text, error=False):
        (self.get_logger().error if error else self.get_logger().info)(text)
        self.status_pub.publish(String(data=text))

    def wait(self, future, timeout, what):
        done = threading.Event()
        future.add_done_callback(lambda _: done.set())
        if not done.wait(timeout):
            raise Abort(f"{what}: no answer after {timeout:.0f} s")
        return future.result()

    def run_action(self, client, goal, timeout, what):
        if not client.wait_for_server(timeout_sec=5.0):
            raise Abort(f"{what}: action server is not running")
        handle = self.wait(client.send_goal_async(goal), 10.0, what)
        if not handle.accepted:
            raise Abort(f"{what}: goal rejected")
        return self.wait(handle.get_result_async(), timeout, what).result

    def now(self):
        return self.get_clock().now().nanoseconds / 1e9

    # ------------------------------------------------------------------ startup
    def setup(self):
        self.say("Waiting for MoveIt...")
        if not self.move.wait_for_server(timeout_sec=120.0):
            self.say("MoveIt /move_action never appeared: the arm cannot be moved.", error=True)
            return
        self.add_table()
        self.say('Ready. Publish a command on /nora/command, e.g. "I am thirsty" or "clean the table".')

    def add_table(self):
        table = CollisionObject()
        table.header.frame_id = FRAME
        table.id = "table"
        table.primitives = [SolidPrimitive(type=SolidPrimitive.BOX, dimensions=[TABLE["size"][0], TABLE["size"][1], 0.05])]
        pose = Pose()
        pose.position.x, pose.position.y, pose.position.z = TABLE["center"][0], TABLE["center"][1], -0.027
        pose.orientation.w = 1.0
        table.primitive_poses = [pose]
        table.operation = CollisionObject.ADD
        scene = PlanningScene(is_diff=True)
        scene.world.collision_objects = [table]
        for _ in range(3):  # the topic is not latched; repeat in case move_group subscribed late
            self.scene_pub.publish(scene)
            threading.Event().wait(0.5)

    # ------------------------------------------------------------------ object knowledge (by class, not by position)
    @staticmethod
    def height(obj):
        return obj["size"][2] if obj["shape"] == "box" else obj["height"] if obj["shape"] == "cylinder" else 2 * obj["radius"]

    @staticmethod
    def width(obj):
        """Extent along X, the axis the fingers close on ("width" in the catalogue overrides the shape, e.g. a mug handle)."""
        return obj.get("width") or (obj["size"][0] if obj["shape"] == "box" else 2 * obj["radius"])

    def grasp_height(self, obj):
        h = self.height(obj)
        return max(h / 2, h - 0.025, MIN_GRASP_Z)  # middle of the object, but keep the finger rail clear of tall ones

    def zone_of(self, x, y):
        for name, zone in self.zones.items():
            if abs(x - zone["center"][0]) <= zone["size"][0] / 2 + 0.02 and abs(y - zone["center"][1]) <= zone["size"][1] / 2 + 0.02:
                return name
        return "table"

    def free_spot(self, zone):
        if zone == "table":
            spots = [s for s in TABLE_SPOTS if self.zone_of(*s) == "table"]
            clearance = 0.10
        else:
            cx, cy = self.zones[zone]["center"]
            spots = [(cx + dx, cy + dy) for dx, dy in ZONE_SLOTS]
            clearance = 0.07
        for x, y in spots:
            if all(math.hypot(x - b["x"], y - b["y"]) > clearance for b in self.belief):
                return x, y
        raise Abort(f"No free space left in the {zone}.")

    # ------------------------------------------------------------------ camera
    def on_detections(self, msg):
        objects = []
        for d in msg.detections:
            if d.results:
                p = d.results[0].pose.pose.position
                objects.append({"class": d.results[0].hypothesis.class_id, "x": p.x, "y": p.y, "z": p.z})
        with self.fresh:
            self.seen = (msg.header.stamp.sec + msg.header.stamp.nanosec / 1e9, objects)
            self.fresh.notify_all()

    def observe(self):
        """Scene objects the camera sees on the table now: waits for an image taken after the arm has stopped."""
        threading.Event().wait(0.6)
        start = self.now()
        with self.fresh:
            if not self.fresh.wait_for(lambda: self.seen[0] > start, timeout=10.0):
                raise Abort("No camera detections arrived. Is nora_perception running and is Gazebo rendering the camera?")
            objects = list(self.seen[1])
        found = []
        for o in objects:
            obj = self.catalogue.get(o["class"])
            if obj is None or o["z"] > self.height(obj) + 0.03:
                continue  # not an object of this scene, or held above the table
            # The detector reports a point on the surface facing the camera: follow the camera ray to the centre height.
            t = (o["z"] - self.height(obj) / 2) / (CAMERA[2] - o["z"])
            found.append({"class": o["class"], "x": o["x"] + t * (o["x"] - CAMERA[0]), "y": o["y"] + t * (o["y"] - CAMERA[1])})
        return found

    def remember(self, objects):
        for o in objects:
            for b in self.belief:
                if b["class"] == o["class"] and math.hypot(b["x"] - o["x"], b["y"] - o["y"]) < 0.04:
                    b["x"], b["y"] = o["x"], o["y"]
                    break
            else:
                self.belief.append({"class": o["class"], "x": o["x"], "y": o["y"]})

    def scan(self):
        self.say("Looking over the table with the overhead camera.")
        self.rest()  # out of the camera's view of the table
        self.belief = []
        self.remember(self.observe())
        listing = ", ".join(f"{b['class']} ({self.zone_of(b['x'], b['y'])})" for b in self.belief) or "nothing"
        self.say(f"I see: {listing}.")

    def find(self, kind, avoid=None):
        """A believed object of this class that is not already in the 'avoid' zone; scans once if there is none."""
        for attempt in range(2):
            for b in self.belief:
                if b["class"] == kind and self.zone_of(b["x"], b["y"]) != avoid:
                    return b
            if attempt == 0:
                self.scan()
        name = kind.replace("_", " ")
        if any(b["class"] == kind for b in self.belief):
            raise Abort(f"The {name} is already in the {avoid}.")
        raise Abort(f"I looked with the camera and did not see a {name}.")

    def publish_markers(self):
        now = self.get_clock().now().to_msg()
        markers = [Marker(action=Marker.DELETEALL)]

        def marker(i, kind, x, y, z, scale, color, alpha=1.0):
            mk = Marker()
            mk.header.frame_id, mk.header.stamp = FRAME, now
            mk.ns, mk.id, mk.type, mk.action = "nora_scene", i, kind, Marker.ADD
            mk.pose.position.x, mk.pose.position.y, mk.pose.position.z = float(x), float(y), float(z)
            mk.pose.orientation.w = 1.0
            mk.scale.x, mk.scale.y, mk.scale.z = (float(s) for s in scale)
            mk.color.r, mk.color.g, mk.color.b, mk.color.a = float(color[0]), float(color[1]), float(color[2]), alpha
            markers.append(mk)

        marker(0, Marker.CUBE, TABLE["center"][0], TABLE["center"][1], -0.025, (TABLE["size"][0], TABLE["size"][1], 0.05), (0.55, 0.4, 0.25))
        for i, zone in enumerate(self.zones.values(), start=1):
            marker(i, Marker.CUBE, zone["center"][0], zone["center"][1], 0.001, (zone["size"][0], zone["size"][1], 0.002), zone["color"])
        for i, b in enumerate(list(self.belief), start=10):
            obj = self.catalogue[b["class"]]
            h = self.height(obj)
            if obj["shape"] == "box":
                marker(i, Marker.CUBE, b["x"], b["y"], h / 2, obj["size"], obj["color"])
            elif obj["shape"] == "cylinder":
                marker(i, Marker.CYLINDER, b["x"], b["y"], h / 2, (2 * obj["radius"], 2 * obj["radius"], h), obj["color"])
            else:
                marker(i, Marker.SPHERE, b["x"], b["y"], h / 2, (h, h, h), obj["color"])
        self.marker_pub.publish(MarkerArray(markers=markers))

    # ------------------------------------------------------------------ motion primitives
    def go_home(self):
        goal = MoveGroup.Goal()
        req = goal.request
        req.group_name = "arm"
        req.num_planning_attempts = 5
        req.allowed_planning_time = 5.0
        req.max_velocity_scaling_factor = 1.0
        req.max_acceleration_scaling_factor = 1.0
        req.goal_constraints = [
            Constraints(
                joint_constraints=[
                    JointConstraint(joint_name=j, position=p, tolerance_above=0.001, tolerance_below=0.001, weight=1.0)
                    for j, p in zip(ARM_JOINTS, HOME)
                ]
            )
        ]
        goal.planning_options.plan_only = False
        goal.planning_options.planning_scene_diff.is_diff = True
        goal.planning_options.planning_scene_diff.robot_state.is_diff = True
        result = self.run_action(self.move, goal, 60.0, "move home")
        if result.error_code.val != 1:
            raise Abort(f"MoveIt could not move home (error code {result.error_code.val})")

    def line_to(self, x, y, z, what):
        """Straight-line move of the grasp point, gripper pointing down."""
        if not self.cartesian.wait_for_service(timeout_sec=5.0):
            raise Abort("MoveIt /compute_cartesian_path is not running")
        req = GetCartesianPath.Request()
        req.header.frame_id = FRAME
        req.start_state.is_diff = True
        req.group_name = "arm"
        req.link_name = TIP
        pose = Pose()
        pose.position.x, pose.position.y, pose.position.z = float(x), float(y), float(z)
        pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w = DOWN
        req.waypoints = [pose]
        req.max_step = 0.01
        req.jump_threshold = 5.0
        req.avoid_collisions = True
        res = self.wait(self.cartesian.call_async(req), 20.0, what)
        if res.fraction < 0.99:
            raise Abort(f"{what}: only {res.fraction * 100:.0f}% of the path is reachable and collision-free")
        if len(res.solution.joint_trajectory.points) < 2:
            return  # already there
        result = self.run_action(self.execute, ExecuteTrajectory.Goal(trajectory=res.solution), 60.0, what)
        if result.error_code.val != 1:
            raise Abort(f"{what}: execution failed (error code {result.error_code.val})")

    def set_gripper(self, travel, what):
        goal = GripperCommand.Goal()
        goal.command.position = float(travel)
        goal.command.max_effort = 50.0
        result = self.run_action(self.gripper, goal, 15.0, what)
        if not (result.reached_goal or result.stalled):
            raise Abort(f"{what}: gripper did not reach {travel:.3f} m")

    # ------------------------------------------------------------------ skills
    def pick(self, target):
        if self.held:
            raise Abort(f"Already holding a {self.held}. Place it first.")
        kind = target["class"]
        obj = self.catalogue[kind]
        if self.width(obj) > OPEN - 0.006:
            raise Abort(f"A {kind} is too wide for the gripper.")
        self.say(f"Picking the {kind} at ({target['x']:.2f}, {target['y']:.2f}).")
        self.set_gripper(OPEN, "open gripper")

        # Fresh look with the arm out of the view: confirms the object is still there.
        self.rest()
        near = [o for o in self.observe() if o["class"] == kind and math.hypot(o["x"] - target["x"], o["y"] - target["y"]) < 0.06]
        if not near:
            self.belief.remove(target)
            raise Abort(f"The {kind} is no longer where I saw it.")
        x, y = near[0]["x"], near[0]["y"]
        target["x"], target["y"] = x, y
        self.line_to(x, y, HOVER_Z, "move above the object")
        self.line_to(x, y, self.grasp_height(obj), "descend")
        self.set_gripper(self.width(obj) - 2 * SQUEEZE, "close gripper")
        self.line_to(x, y, HOVER_Z, "lift")

        # Camera check from the rest pose: if the object is still on the table, the grasp failed.
        self.rest()
        if any(o["class"] == kind and math.hypot(o["x"] - x, o["y"] - y) < 0.05 for o in self.observe()):
            self.set_gripper(OPEN, "open gripper")
            raise Abort(f"Grasp failed: the camera still sees the {kind} on the table.")
        self.belief.remove(target)
        self.held = kind
        self.say(f"Holding the {kind}.")

    def place(self, zone):
        if not self.held:
            raise Abort("Nothing in the gripper to place.")
        x, y = self.free_spot(zone)
        release_z = self.grasp_height(self.catalogue[self.held]) + 0.004
        self.say(f"Placing the {self.held} in the {zone} at ({x:.2f}, {y:.2f}).")
        self.line_to(x, y, HOVER_Z, "move above the place position")
        self.line_to(x, y, release_z, "descend")
        self.set_gripper(OPEN, "open gripper")
        self.line_to(x, y, HOVER_Z, "retreat")
        self.belief.append({"class": self.held, "x": x, "y": y})
        self.held = None

    def rest(self):
        self.line_to(REST[0], REST[1], REST[2], "return to rest")

    def move_all(self, source, destination, limit=None):
        """Every object the camera finds in the source zone goes to the destination zone."""
        self.scan()
        items = [b for b in self.belief if self.zone_of(b["x"], b["y"]) == source][:limit]
        if not items:
            self.say(f"Nothing to move: the camera sees no objects in the {source}.")
            return
        moved, failed = 0, []
        for item in items:
            try:
                self.pick(item)
                self.place(destination)
                moved += 1
            except Abort as exc:
                failed.append(item["class"])
                self.say(f"Skipping the {item['class']}: {exc}", error=True)
                if self.held:
                    raise
        self.rest()
        if failed:
            raise Abort(f"Moved {moved} of {len(items)} objects to the {destination}. Could not move: {', '.join(failed)}.")
        self.say(f"Moved {moved} objects from the {source} to the {destination}.")

    # ------------------------------------------------------------------ command handling
    def match_class(self, text):
        key = text.strip().lower().replace(" ", "_")
        if not key:
            raise Abort("The command does not say which object.")
        for name, obj in self.catalogue.items():
            if key == name or key in obj.get("aliases", []):
                return name
        hits = [n for n in self.catalogue if key in n or n in key]
        if len(hits) == 1:
            return hits[0]
        raise Abort(f"There is no '{text}' in this scene. Objects I know: {', '.join(self.catalogue)}.")

    def match_zone(self, text, default):
        key = text.strip().lower().replace(" ", "_")
        if not key:
            return default
        for name, zone in LOCATIONS.items():
            if name == key or name in key.split("_"):
                return zone
        raise Abort(f"Unknown place '{text}'. I know: tray, user, table.")

    def parse(self, text):
        """Returns (action, object class or None, zone or None, parameters)."""
        words = text.strip().lower().split()
        if len(words) == 1 and words[0] in ("home", "open", "close", "scan"):
            return words[0], None, None, {}
        if len(words) == 2 and words[0] == "pick" and words[1] in self.catalogue:
            return "pick", words[1], None, {}
        if len(words) == 2 and words[0] == "place" and words[1] in ("tray", "user", "table"):
            return "place", None, words[1], {}

        if self.nlu is None or not self.nlu.wait_for_service(timeout_sec=2.0):
            raise Abort(f"The NLU node (/nora/parse_command) is not running, and this is not a direct command: '{text}'")
        res = self.wait(self.nlu.call_async(self.ParseCommand.Request(raw_text=text)), 15.0, "NLU")
        intent = res.intent
        if intent.action == "explicit_blocked":
            raise Abort("I will not act on that language.")
        if not res.success:
            raise Abort(f"I did not understand '{text}'. {res.error_msg}")
        self.say(
            f"NLU: action={intent.action} object={intent.target_object or '-'} "
            f"location={intent.target_location or '-'} confidence={intent.confidence:.2f}"
        )
        try:
            params = json.loads(intent.parameters_json or "{}")
        except ValueError:
            params = {}
        action = {"go_home": "home", "open_gripper": "open", "close_gripper": "close"}.get(intent.action, intent.action)
        if action in ("home", "open", "close"):
            return action, None, None, params
        if action in ("clean_table", "rerack_table", "loop_task"):
            return action, None, self.match_zone(params.get("destination", ""), "tray"), params
        if action == "pick":
            zone = self.match_zone(intent.target_location, "") if intent.target_location else None
            return "pick", self.match_class(intent.target_object), zone, params
        if action == "place":
            kind = self.match_class(intent.target_object) if intent.target_object else None
            return "place", kind, self.match_zone(intent.target_location, "tray"), params
        raise Abort(f"I have no skill for '{intent.action}'.")

    def run(self, action, kind, zone, params):
        if action == "home":
            self.say("Moving home.")
            self.go_home()
        elif action == "open":
            self.set_gripper(OPEN, "open gripper")
            self.held = None
        elif action == "close":
            self.set_gripper(0.0, "close gripper")
        elif action == "scan":
            self.scan()
        elif action == "clean_table":
            self.move_all("table", zone if zone != "table" else "tray")
        elif action == "rerack_table":
            self.move_all("tray", "table")
        elif action == "loop_task":
            source = "tray" if params.get("source") == "tray" else "table"
            self.move_all(source, zone if zone != source else "tray", limit=int(params.get("loop_count", 3)))
        elif action == "pick":
            self.pick(self.find(kind, zone))
            if zone:  # "bring me ...", "I am thirsty": deliver it
                self.place(zone)
                self.rest()
        elif action == "place":
            if kind and self.held != kind:  # "throw away the can": fetch it first
                if self.held:
                    raise Abort(f"Holding a {self.held}, not a {kind}. Place it first.")
                self.pick(self.find(kind, zone))
            self.place(zone)
            self.rest()

    def on_command(self, msg):
        threading.Thread(target=self.handle, args=(msg.data,), daemon=True).start()

    def handle(self, text):
        if not self.busy.acquire(blocking=False):
            self.say(f"Busy, ignored: '{text}'", error=True)
            return
        try:
            self.say(f"Command: {text}")
            self.run(*self.parse(text))
            self.say(f"Done: {text}")
        except Abort as exc:
            self.say(f"FAILED: {exc}", error=True)
        except Exception as exc:  # report instead of dying silently in a worker thread
            self.say(f"FAILED ({type(exc).__name__}): {exc}", error=True)
        finally:
            self.busy.release()


def main():
    rclpy.init()
    node = ArmCommander()
    executor = MultiThreadedExecutor(num_threads=4)
    executor.add_node(node)
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        rclpy.shutdown()


if __name__ == "__main__":
    main()
