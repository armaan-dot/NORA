#!/usr/bin/env python3
"""
arm_commander.py: drives the NORA arm in Gazebo through the same ROS 2 interfaces a real arm would use.

  /nora/command (std_msgs/String)  ->  this node
        arm motion  : MoveIt  /move_action, /compute_cartesian_path, /execute_trajectory
                      -> /arm_controller/follow_joint_trajectory (ros2_control)
        gripper     : /gripper_controller/gripper_cmd (control_msgs/GripperCommand)

Commands (publish a String on /nora/command, e.g. from a Foxglove Publish panel):
  home | open | close
  pick <object>              e.g.  pick red_cube
  place <location>           e.g.  place tray        (locations are in the scene JSON)
  place <x> <y>              e.g.  place 0.5 0.2     (metres, world frame)
Anything else is sent to the NLU node (/nora/parse_command) if it is running.

Also: spawns the objects of the scene JSON into Gazebo, adds the table to the MoveIt planning scene, and
publishes /nora/scene_markers (table + objects at their Gazebo poses) and /nora/status for Foxglove.

Object poses come from Gazebo ground truth (/gazebo/model_states), not from the camera.
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
from gazebo_msgs.msg import ModelStates
from gazebo_msgs.srv import SpawnEntity
from geometry_msgs.msg import Pose
from moveit_msgs.action import ExecuteTrajectory, MoveGroup
from moveit_msgs.msg import CollisionObject, Constraints, JointConstraint, PlanningScene
from moveit_msgs.srv import GetCartesianPath
from shape_msgs.msg import SolidPrimitive
from std_msgs.msg import String
from visualization_msgs.msg import Marker, MarkerArray

ARM_JOINTS = ["shoulder_pan_joint", "shoulder_lift_joint", "elbow_joint", "wrist_1_joint", "wrist_2_joint", "wrist_3_joint"]
HOME = [0.0, 0.5, 1.3, -0.2292, -1.5708, 0.0]  # same as the SRDF "home" state and the URDF initial values
FRAME = "world"
TIP = "grasp_link"
# grasp_link Z pointing straight down, fingers opening along world X (x, y, z, w)
DOWN = (0.70710678, -0.70710678, 0.0, 0.0)

HOVER_Z = 0.20        # travel height of the grasp point above the table
MIN_GRASP_Z = 0.023   # keeps the fingertips 8 mm above the table
OPEN = 0.05           # finger travel when open (0.10 m between the pads)
SQUEEZE = 0.0015      # how far each pad is pressed into the object
TABLE = {"center": (0.6, 0.0), "size": (0.8, 1.4)}


class Abort(Exception):
    pass


class ArmCommander(Node):
    def __init__(self):
        super().__init__("nora_arm_commander")
        scene_file = self.declare_parameter("scene_file", "").value
        with open(scene_file, encoding="utf-8") as f:
            scene = json.load(f)
        self.objects = {o["name"]: o for o in scene["objects"]}
        self.locations = scene.get("locations", {})

        group = ReentrantCallbackGroup()
        self.move = ActionClient(self, MoveGroup, "/move_action", callback_group=group)
        self.execute = ActionClient(self, ExecuteTrajectory, "/execute_trajectory", callback_group=group)
        self.gripper = ActionClient(self, GripperCommand, "/gripper_controller/gripper_cmd", callback_group=group)
        self.cartesian = self.create_client(GetCartesianPath, "/compute_cartesian_path", callback_group=group)
        self.spawn = self.create_client(SpawnEntity, "/spawn_entity", callback_group=group)
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
        self.create_subscription(ModelStates, "/gazebo/model_states", self.on_models, 1, callback_group=group)
        self.create_subscription(String, "/nora/command", self.on_command, 10, callback_group=group)
        self.create_timer(0.2, self.publish_markers, callback_group=group)

        self.poses = {}      # object name -> geometry_msgs/Pose, from Gazebo
        self.held = None     # name of the object in the gripper
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

    # ------------------------------------------------------------------ startup
    def setup(self):
        self.say("Waiting for Gazebo...")
        if not self.spawn.wait_for_service(timeout_sec=120.0):
            self.say("Gazebo /spawn_entity never appeared: no objects spawned.", error=True)
        else:
            for obj in self.objects.values():
                try:
                    res = self.wait(self.spawn.call_async(self.spawn_request(obj)), 20.0, f"spawn {obj['name']}")
                    if not res.success:
                        self.say(f"Gazebo refused to spawn {obj['name']}: {res.status_message}", error=True)
                except Abort as exc:
                    self.say(str(exc), error=True)
        self.say("Waiting for MoveIt...")
        if not self.move.wait_for_server(timeout_sec=120.0):
            self.say("MoveIt /move_action never appeared: the arm cannot be moved.", error=True)
            return
        self.add_table()
        self.say("Ready. Publish a command on /nora/command (home, open, close, pick <object>, place <location>).")

    def spawn_request(self, obj):
        shape, m = obj["shape"], obj["mass"]
        if shape == "box":
            x, y, z = obj["size"]
            geometry = f"<box><size>{x} {y} {z}</size></box>"
            inertia = (m * (y * y + z * z) / 12, m * (x * x + z * z) / 12, m * (x * x + y * y) / 12)
        elif shape == "cylinder":
            r, h = obj["radius"], obj["height"]
            geometry = f"<cylinder><radius>{r}</radius><length>{h}</length></cylinder>"
            side = m * (3 * r * r + h * h) / 12
            inertia = (side, side, m * r * r / 2)
        else:
            r = obj["radius"]
            geometry = f"<sphere><radius>{r}</radius></sphere>"
            inertia = (0.4 * m * r * r,) * 3
        red, green, blue = obj["color"]
        req = SpawnEntity.Request()
        req.name = obj["name"]
        req.xml = f"""<sdf version="1.6"><model name="{obj['name']}"><link name="link">
  <inertial><mass>{m}</mass><inertia><ixx>{inertia[0]}</ixx><iyy>{inertia[1]}</iyy><izz>{inertia[2]}</izz>
    <ixy>0</ixy><ixz>0</ixz><iyz>0</iyz></inertia></inertial>
  <collision name="collision"><geometry>{geometry}</geometry><surface>
    <friction><ode><mu>1.5</mu><mu2>1.5</mu2></ode></friction>
    <contact><ode><kp>100000</kp><kd>100</kd><max_vel>0.1</max_vel><min_depth>0.001</min_depth></ode></contact>
  </surface></collision>
  <visual name="visual"><geometry>{geometry}</geometry>
    <material><ambient>{red} {green} {blue} 1</ambient><diffuse>{red} {green} {blue} 1</diffuse></material></visual>
</link></model></sdf>"""
        req.initial_pose.position.x = float(obj["xy"][0])
        req.initial_pose.position.y = float(obj["xy"][1])
        req.initial_pose.position.z = self.height(obj) / 2 + 0.002
        req.initial_pose.orientation.w = 1.0
        req.reference_frame = "world"
        return req

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

    # ------------------------------------------------------------------ object geometry
    @staticmethod
    def height(obj):
        return obj["size"][2] if obj["shape"] == "box" else obj["height"] if obj["shape"] == "cylinder" else 2 * obj["radius"]

    @staticmethod
    def width(obj):
        """Extent along world X, the axis the fingers close on."""
        return obj["size"][0] if obj["shape"] == "box" else 2 * obj["radius"]

    def on_models(self, msg):
        self.poses = {n: p for n, p in zip(msg.name, msg.pose) if n in self.objects}

    def publish_markers(self):
        now = self.get_clock().now().to_msg()
        markers = []

        def marker(i, kind, pose, scale, color):
            mk = Marker()
            mk.header.frame_id, mk.header.stamp = FRAME, now
            mk.ns, mk.id, mk.type, mk.action = "nora_scene", i, kind, Marker.ADD
            mk.pose = pose
            mk.scale.x, mk.scale.y, mk.scale.z = scale
            mk.color.r, mk.color.g, mk.color.b, mk.color.a = color[0], color[1], color[2], 1.0
            markers.append(mk)

        table = Pose()
        table.position.x, table.position.y, table.position.z = TABLE["center"][0], TABLE["center"][1], -0.025
        table.orientation.w = 1.0
        marker(0, Marker.CUBE, table, (TABLE["size"][0], TABLE["size"][1], 0.05), (0.55, 0.4, 0.25))
        for i, (name, obj) in enumerate(self.objects.items(), start=1):
            pose = self.poses.get(name)
            if pose is None:
                continue
            if obj["shape"] == "box":
                marker(i, Marker.CUBE, pose, tuple(obj["size"]), obj["color"])
            elif obj["shape"] == "cylinder":
                marker(i, Marker.CYLINDER, pose, (2 * obj["radius"], 2 * obj["radius"], obj["height"]), obj["color"])
            else:
                marker(i, Marker.SPHERE, pose, (2 * obj["radius"],) * 3, obj["color"])
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
    def pick(self, name):
        if self.held:
            raise Abort(f"Already holding {self.held}. Place it first.")
        obj = self.objects[name]
        pose = self.poses.get(name)
        if pose is None:
            raise Abort(f"Gazebo is not reporting a pose for {name}.")
        if self.width(obj) > 2 * OPEN - 0.01:
            raise Abort(f"{name} is too wide for the gripper.")
        x, y, start_z = pose.position.x, pose.position.y, pose.position.z
        grasp_z = max(start_z, MIN_GRASP_Z)
        self.say(f"Picking {name} at ({x:.2f}, {y:.2f}).")
        self.set_gripper(OPEN, "open gripper")
        self.line_to(x, y, HOVER_Z, "move above the object")
        self.line_to(x, y, grasp_z, "descend")
        self.set_gripper(self.width(obj) / 2 - SQUEEZE, "close gripper")
        self.line_to(x, y, HOVER_Z, "lift")
        threading.Event().wait(0.5)
        now = self.poses.get(name)
        if now is None or now.position.z < start_z + 0.5 * (HOVER_Z - grasp_z):
            self.set_gripper(OPEN, "open gripper")
            raise Abort(f"Grasp failed: {name} did not leave the table.")
        self.held = name
        self.say(f"Holding {name}.")

    def place(self, x, y):
        if not self.held:
            raise Abort("Nothing in the gripper to place.")
        obj = self.objects[self.held]
        release_z = max(self.height(obj) / 2 + 0.005, MIN_GRASP_Z)
        self.say(f"Placing {self.held} at ({x:.2f}, {y:.2f}).")
        self.line_to(x, y, HOVER_Z, "move above the place position")
        self.line_to(x, y, release_z, "descend")
        self.set_gripper(OPEN, "open gripper")
        self.line_to(x, y, HOVER_Z, "retreat")
        name, self.held = self.held, None
        self.say(f"Placed {name}.")

    # ------------------------------------------------------------------ command handling
    def match_object(self, text):
        key = text.strip().lower().replace(" ", "_")
        if key in self.objects:
            return key
        hits = [n for n in self.objects if key and (key in n or n in key or any(w in n.split("_") for w in key.split("_")))]
        if len(hits) != 1:
            raise Abort(f"Which object is '{text}'? Known objects: {', '.join(self.objects)}.")
        return hits[0]

    def match_location(self, text):
        key = text.strip().lower().replace(" ", "_")
        for name, xy in self.locations.items():
            if name in key or key in name:
                return xy
        raise Abort(f"Unknown location '{text}'. Known locations: {', '.join(self.locations)}.")

    def parse(self, text):
        """Returns (action, argument)."""
        words = text.strip().split()
        verb = words[0].lower() if words else ""
        if len(words) == 1 and verb in ("home", "open", "close"):
            return verb, None
        if verb == "pick" and len(words) >= 2 and "_".join(words[1:]).lower() in self.objects:
            return "pick", "_".join(words[1:]).lower()
        if verb == "place" and len(words) == 3:
            try:
                return "place", (float(words[1]), float(words[2]))
            except ValueError:
                pass
        if verb == "place" and len(words) == 2 and words[1].lower() in self.locations:
            return "place", tuple(self.locations[words[1].lower()])
        return self.parse_english(text)

    def parse_english(self, text):
        if self.nlu is None or not self.nlu.wait_for_service(timeout_sec=2.0):
            raise Abort(f"Not a direct command, and the NLU node (/nora/parse_command) is not running: '{text}'")
        res = self.wait(self.nlu.call_async(self.ParseCommand.Request(raw_text=text)), 15.0, "NLU")
        if not res.success:
            raise Abort(f"NLU could not parse '{text}': {res.error_msg}")
        intent = res.intent
        self.say(f"NLU: action={intent.action} object={intent.target_object or '-'} location={intent.target_location or '-'}")
        if intent.action == "go_home":
            return "home", None
        if intent.action == "open_gripper":
            return "open", None
        if intent.action == "close_gripper":
            return "close", None
        if intent.action == "pick":
            return "pick", self.match_object(intent.target_object)
        if intent.action == "place":
            return "place", tuple(self.match_location(intent.target_location))
        raise Abort(f"No skill for action '{intent.action}'.")

    def on_command(self, msg):
        threading.Thread(target=self.handle, args=(msg.data,), daemon=True).start()

    def handle(self, text):
        if not self.busy.acquire(blocking=False):
            self.say(f"Busy, ignored: '{text}'", error=True)
            return
        try:
            action, arg = self.parse(text)
            if action == "home":
                self.say("Moving home.")
                self.go_home()
            elif action == "open":
                self.set_gripper(OPEN, "open gripper")
                self.held = None
            elif action == "close":
                self.set_gripper(0.0, "close gripper")
            elif action == "pick":
                self.pick(arg)
            elif action == "place":
                if math.hypot(arg[0], arg[1]) > 0.85:
                    raise Abort(f"({arg[0]:.2f}, {arg[1]:.2f}) is out of reach.")
                self.place(arg[0], arg[1])
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
