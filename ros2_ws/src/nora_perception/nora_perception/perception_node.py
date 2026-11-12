"""Perception node: object detection from an RGB-D camera.

Objects are found by a COCO-trained YOLOX model (cup, bottle, apple, book, ...)
and, for plain primitives COCO has no class for, by configured colours.

Subscriptions:
    <color_topic>        (sensor_msgs/Image)       colour image
    <depth_topic>        (sensor_msgs/Image)       depth aligned to the colour image
    <camera_info_topic>  (sensor_msgs/CameraInfo)  colour intrinsics
Publishers:
    <detections_topic>   (vision_msgs/Detection3DArray)  one message per camera frame,
                         positions in <output_frame>; empty when nothing is in view
"""

from __future__ import annotations

import os
import urllib.request

import message_filters
import numpy as np
import rclpy
from cv_bridge import CvBridge
from geometry_msgs.msg import PointStamped
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from rclpy.time import Time
from sensor_msgs.msg import CameraInfo, Image
from tf2_geometry_msgs import do_transform_point
from tf2_ros import Buffer, TransformException, TransformListener
from vision_msgs.msg import Detection3D, Detection3DArray, ObjectHypothesisWithPose

from nora_perception.detector import (
    COCO_CLASSES, YoloxDetector, assign_ids, detect, locate_boxes, merge,
)


class PerceptionNode(Node):
    def __init__(self) -> None:
        super().__init__("nora_perception")
        p = self.declare_parameter
        labels = p("labels", ["red_cube", "blue_cylinder", "green_sphere"]).value
        hue_min = p("hue_min", [170, 100, 45]).value
        hue_max = p("hue_max", [6, 130, 85]).value
        if not len(labels) == len(hue_min) == len(hue_max):
            raise ValueError("labels, hue_min and hue_max must have the same length")
        self._specs = list(zip(labels, hue_min, hue_max))
        self._min_saturation = p("min_saturation", 80).value
        self._min_value = p("min_value", 40).value
        self._min_area = p("min_area_px", 150).value
        self._frame = p("output_frame", "base_link").value
        self._score_threshold = p("score_threshold", 0.35).value
        self._nms_threshold = p("nms_threshold", 0.45).value
        classes = set(p("classes", list(COCO_CLASSES)).value)
        unknown = classes - set(COCO_CLASSES)
        if unknown:
            raise ValueError(f"not COCO classes: {sorted(unknown)}")
        self._classes = classes
        self._yolox = self._load_model(
            os.path.expanduser(p("model_path", "~/.ros/nora/yolox_tiny.onnx").value),
            p("model_url", "").value,
            p("input_size", 416).value,
        )
        self._tracks: dict[str, tuple[str, tuple]] = {}

        self._bridge = CvBridge()
        self._info = None
        self._tf_buffer = Buffer()
        self._tf_listener = TransformListener(self._tf_buffer, self)

        self._pub = self.create_publisher(
            Detection3DArray, p("detections_topic", "/nora/perception/detections").value, 10
        )
        self.create_subscription(
            CameraInfo,
            p("camera_info_topic", "/camera/color/camera_info").value,
            lambda msg: setattr(self, "_info", msg),
            qos_profile_sensor_data,
        )
        color = message_filters.Subscriber(
            self, Image, p("color_topic", "/camera/color/image_raw").value,
            qos_profile=qos_profile_sensor_data,
        )
        depth = message_filters.Subscriber(
            self, Image, p("depth_topic", "/camera/aligned_depth_to_color/image_raw").value,
            qos_profile=qos_profile_sensor_data,
        )
        self._sync = message_filters.ApproximateTimeSynchronizer([color, depth], 5, 0.1)
        self._sync.registerCallback(self._on_frame)

    def _load_model(self, path: str, url: str, input_size: int):
        if not os.path.exists(path) and url:
            self.get_logger().info(f"Downloading {url} to {path}")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            try:
                urllib.request.urlretrieve(url, path + ".part")
                os.replace(path + ".part", path)
            except OSError as exc:
                self.get_logger().error(f"Model download failed: {exc}")
        try:
            detector = YoloxDetector(path, input_size)
        except Exception as exc:  # missing file, missing onnxruntime, bad model
            self.get_logger().error(
                f"YOLOX model unavailable ({exc}); detecting configured colours only. "
                "Install onnxruntime and check model_path / model_url."
            )
            return None
        self.get_logger().info(f"Loaded YOLOX model {path}")
        return detector

    def _on_frame(self, color: Image, depth: Image) -> None:
        if self._info is None:
            return
        bgr = self._bridge.imgmsg_to_cv2(color, "bgr8")
        depth_m = self._bridge.imgmsg_to_cv2(depth, "passthrough").astype(np.float32)
        if depth.encoding == "16UC1":  # millimetres (RealSense); Gazebo publishes 32FC1 metres
            depth_m /= 1000.0
        if depth_m.shape != bgr.shape[:2]:
            self.get_logger().warn(
                "Depth and colour images differ in size; depth must be aligned to colour.",
                throttle_duration_sec=5.0,
            )
            return

        k = self._info.k
        intrinsics = (k[0], k[4], k[2], k[5])
        found = detect(
            bgr, depth_m, *intrinsics, self._specs,
            self._min_saturation, self._min_value, self._min_area,
        )
        if self._yolox is not None:
            boxes = self._yolox.boxes(bgr, self._score_threshold, self._nms_threshold,
                                      self._classes)
            found = merge(found, locate_boxes(boxes, depth_m, *intrinsics))

        out = Detection3DArray()
        out.header.stamp = color.header.stamp
        out.header.frame_id = self._frame
        if found:
            camera_frame = color.header.frame_id or self._info.header.frame_id
            try:
                tf = self._tf_buffer.lookup_transform(self._frame, camera_frame, Time())
            except TransformException as exc:
                self.get_logger().warn(f"No camera transform: {exc}", throttle_duration_sec=5.0)
                return
        positions = []
        for item in found:
            point = PointStamped()
            point.point.x, point.point.y, point.point.z = item["position"]
            positions.append(do_transform_point(point, tf).point)
            item["position"] = (positions[-1].x, positions[-1].y, positions[-1].z)
        ids = assign_ids(found, self._tracks)
        self._tracks = {i: (d["label"], d["position"]) for i, d in zip(ids, found)}
        for item, position, object_id in zip(found, positions, ids):
            hypothesis = ObjectHypothesisWithPose()
            hypothesis.hypothesis.class_id = item["label"]
            hypothesis.hypothesis.score = item["score"]
            hypothesis.pose.pose.position = position
            detection = Detection3D()
            detection.header = out.header
            detection.id = object_id
            detection.results.append(hypothesis)
            detection.bbox.center.position = position
            detection.bbox.size.x, detection.bbox.size.y = item["size"]
            out.detections.append(detection)
        self._pub.publish(out)


def main(args=None) -> None:
    rclpy.init(args=args)
    node = PerceptionNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()
