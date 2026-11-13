"""World-model node: keeps a persistent scene graph of the robot's environment.

Subscriptions:
    <detections_topic>          (vision_msgs/Detection3DArray)  one message per camera frame
Publishers:
    /nora/world_model/state     (nora_interfaces/WorldState, latched)
    /tf                         nora/objects/<id> for every object with a usable pose
Services:
    /nora/world_model/query     (nora_interfaces/QueryWorld)
    /nora/world_model/update    (nora_interfaces/UpdateWorld)
"""

from __future__ import annotations

import os
import time

import rclpy
from geometry_msgs.msg import PoseStamped, TransformStamped
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile
from rclpy.time import Time
from tf2_geometry_msgs import do_transform_pose_stamped
from tf2_ros import Buffer, TransformBroadcaster, TransformException, TransformListener
from vision_msgs.msg import Detection3DArray

from nora_interfaces.msg import WorldObject, WorldState
from nora_interfaces.srv import QueryWorld, UpdateWorld
from nora_world_model.scene_graph import SceneGraph


def _stamp(epoch: float):
    return Time(nanoseconds=int(epoch * 1e9)).to_msg()


class WorldModelNode(Node):
    def __init__(self) -> None:
        super().__init__("nora_world_model")
        p = self.declare_parameter
        self._path = p("storage_path", "").value or os.environ.get(
            "NORA_WORLD_MODEL_PATH", os.path.expanduser("~/.ros/nora_world_model.json")
        )
        self._world_frame = p("world_frame", "base_link").value
        self._ee_frame = p("ee_frame", "tcp").value
        self._graph = SceneGraph(
            visibility_timeout=p("visibility_timeout_sec", 1.0).value,
            half_life=p("confidence_half_life_sec", 60.0).value,
            stale_after=p("stale_after_sec", 300.0).value,
            moved_threshold=p("moved_threshold_m", 0.05).value,
        )
        try:
            count = self._graph.load(self._path)
            self.get_logger().info(f"Loaded {count} remembered object(s) from {self._path}")
        except (OSError, ValueError) as exc:
            self.get_logger().error(f"Could not read {self._path}: {exc}; starting empty")

        self._tf_buffer = Buffer()
        self._tf_listener = TransformListener(self._tf_buffer, self)
        self._tf_broadcaster = TransformBroadcaster(self)

        latched = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self._state_pub = self.create_publisher(WorldState, "/nora/world_model/state", latched)
        self.create_subscription(
            Detection3DArray,
            p("detections_topic", "/nora/perception/detections").value,
            self._on_detections,
            10,
        )
        self.create_service(QueryWorld, "/nora/world_model/query", self._on_query)
        self.create_service(UpdateWorld, "/nora/world_model/update", self._on_update)
        self.create_timer(1.0 / p("publish_rate_hz", 2.0).value, self._on_timer)

    # -- inputs ------------------------------------------------------------

    def _on_detections(self, msg: Detection3DArray) -> None:
        detections = []
        for det in msg.detections:
            hyp = det.results[0] if det.results else None
            label = hyp.hypothesis.class_id if hyp else ""
            pose = PoseStamped()
            pose.header.frame_id = det.header.frame_id or msg.header.frame_id or self._world_frame
            pose.pose = hyp.pose.pose if hyp else det.bbox.center
            if pose.header.frame_id != self._world_frame:
                try:
                    tf = self._tf_buffer.lookup_transform(
                        self._world_frame, pose.header.frame_id, Time()
                    )
                except TransformException as exc:
                    # An untransformable frame says nothing about what is visible.
                    self.get_logger().warn(
                        f"Dropping detections: {exc}", throttle_duration_sec=5.0
                    )
                    return
                pose = do_transform_pose_stamped(pose, tf)
            pos, rot = pose.pose.position, pose.pose.orientation
            detections.append({
                "id": det.id or label,
                "label": label,
                "position": [pos.x, pos.y, pos.z],
                "orientation": [rot.x, rot.y, rot.z, rot.w],
                "score": hyp.hypothesis.score if hyp else 1.0,
            })
        self._graph.observe(detections, self._world_frame, time.time())
        self._publish()

    def _ee_pose(self):
        try:
            t = self._tf_buffer.lookup_transform(self._world_frame, self._ee_frame, Time()).transform
        except TransformException:
            return None, None
        return ([t.translation.x, t.translation.y, t.translation.z],
                [t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w])

    def _on_update(self, request, response):
        position, orientation = (None, None)
        if request.state in ("grasped", "moved", "placed"):
            position, orientation = self._ee_pose()
        try:
            obj = self._graph.update(
                request.object_id, request.state, request.location, time.time(),
                frame=self._world_frame if position else "",
                position=position, orientation=orientation,
            )
        except ValueError as exc:
            response.success = False
            response.message = str(exc)
            return response
        response.success = True
        response.message = "" if position or request.state in ("missing", "unknown") else (
            f"no transform {self._world_frame} -> {self._ee_frame}; pose left unchanged"
        )
        response.object = self._to_msg(obj, time.time())
        self._save()
        self._publish()
        return response

    def _on_query(self, request, response):
        now = time.time()
        response.success, response.answer, objects = self._graph.query(
            request.query, request.object_id, now
        )
        response.objects = [self._to_msg(o, now) for o in objects]
        return response

    # -- outputs -----------------------------------------------------------

    def _on_timer(self) -> None:
        now = time.time()
        self._graph.refresh(now)
        held = [o["id"] for o in self._graph.objects.values() if o["state"] == "grasped"]
        if held:
            position, orientation = self._ee_pose()
            if position:
                for oid in held:
                    self._graph.set_pose(oid, self._world_frame, position, orientation, now)
        if self._graph.dirty:
            self._save()
        self._publish()

    def _save(self) -> None:
        try:
            self._graph.save(self._path)
        except OSError as exc:
            self.get_logger().error(
                f"Could not write {self._path}: {exc}", throttle_duration_sec=30.0
            )

    def _to_msg(self, obj: dict, now: float) -> WorldObject:
        msg = WorldObject()
        msg.id = obj["id"]
        msg.label = obj["label"]
        msg.pose.header.frame_id = obj["frame"]
        msg.pose.header.stamp = _stamp(obj["stamp"])
        p, q = msg.pose.pose.position, msg.pose.pose.orientation
        p.x, p.y, p.z = obj["position"]
        q.x, q.y, q.z, q.w = obj["orientation"]
        msg.state = obj["state"]
        msg.location = obj["location"]
        msg.visible = obj["visible"]
        msg.last_seen = _stamp(obj["last_seen"])
        msg.confidence = float(self._graph.confidence(obj, now))
        return msg

    def _publish(self) -> None:
        now = time.time()
        state = WorldState()
        state.stamp = _stamp(now)
        state.objects = [self._to_msg(o, now) for o in self._graph.objects.values()]
        self._state_pub.publish(state)

        transforms = []
        for obj in state.objects:
            # Skills look objects up by TF; only offer poses that are still believed.
            if obj.state in ("missing", "unknown") or not obj.pose.header.frame_id:
                continue
            tf = TransformStamped()
            tf.header.stamp = self.get_clock().now().to_msg()
            tf.header.frame_id = obj.pose.header.frame_id
            tf.child_frame_id = f"nora/objects/{obj.id}"
            t, p = tf.transform.translation, obj.pose.pose.position
            t.x, t.y, t.z = p.x, p.y, p.z
            tf.transform.rotation = obj.pose.pose.orientation
            transforms.append(tf)
        if transforms:
            self._tf_broadcaster.sendTransform(transforms)


def main(args=None) -> None:
    rclpy.init(args=args)
    node = WorldModelNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node._save()
        node.destroy_node()
        rclpy.try_shutdown()
