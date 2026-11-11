#!/usr/bin/env python3
"""
camera_perception.py: finds the objects on the table from the wrist RGB-D camera.

For every depth image:
  1. Every pixel is turned into a 3D point in the world frame (camera intrinsics + TF of the camera).
  2. Points more than 12 mm above the table and further than 15 cm from the camera (so not the fingers or
     a held object) are kept. Everything else is table.
  3. The kept points are grouped into objects by position on the table (5 mm grid, touching cells = one object).
  4. Each object's class is the catalogue entry with the closest colour hue. Its position is the centre of its
     top surface; its height is the height of that surface.

Publishes /nora/perception/detections (std_msgs/String, JSON):
  {"stamp": <sim seconds of the image>, "objects": [{"class", "x", "y", "height", "partial", "pixels"}]}
"partial" means the object touches the image border, so its position is unreliable.

Parameter "source": "camera" (default) or "ground_truth". ground_truth reads the poses from Gazebo instead of
the camera. It exists only to test the rest of the system on a machine that cannot render the camera.
"""
import colorsys
import json

import numpy as np
import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from rclpy.time import Time
from sensor_msgs.msg import CameraInfo, Image
from std_msgs.msg import String
from tf2_ros import Buffer, TransformException, TransformListener

MIN_RANGE = 0.15       # m from the camera; nearer is the gripper or what it holds
MIN_HEIGHT = 0.012     # m above the table
MAX_HEIGHT = 0.30
CELL = 0.005           # m, clustering grid
MIN_PIXELS = 40
MAX_HUE_ERROR = 30.0   # degrees
STRIDE = 2             # use every 2nd pixel


def rotation(q):
    x, y, z, w = q.x, q.y, q.z, q.w
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


class CameraPerception(Node):
    def __init__(self):
        super().__init__("nora_camera_perception")
        scene_file = self.declare_parameter("scene_file", "").value
        self.source = self.declare_parameter("source", "camera").value
        self.optical_frame = self.declare_parameter("optical_frame", "camera_sim_optical_frame").value
        rgb_topic = self.declare_parameter("rgb_topic", "/camera/color/image_raw").value
        depth_topic = self.declare_parameter("depth_topic", "/camera/color/depth/image_raw").value
        info_topic = self.declare_parameter("info_topic", "/camera/color/camera_info").value
        with open(scene_file, encoding="utf-8") as f:
            self.catalogue = json.load(f)["catalogue"]
        self.hues = {name: colorsys.rgb_to_hsv(*c["color"])[0] * 360.0 for name, c in self.catalogue.items()}

        self.pub = self.create_publisher(String, "/nora/perception/detections", 1)
        self.rgb = self.info = None
        self.warned = 0.0
        if self.source == "ground_truth":
            from gazebo_msgs.msg import ModelStates

            self.create_subscription(ModelStates, "/gazebo/model_states", self.on_models, 1)
            self.get_logger().warn("source=ground_truth: object positions come from Gazebo, NOT from the camera.")
        else:
            self.tf = Buffer()
            self.tf_listener = TransformListener(self.tf, self)
            self.create_subscription(Image, rgb_topic, self.on_rgb, qos_profile_sensor_data)
            self.create_subscription(CameraInfo, info_topic, self.on_info, qos_profile_sensor_data)
            self.create_subscription(Image, depth_topic, self.on_depth, qos_profile_sensor_data)
            self.create_timer(5.0, self.check_alive)
            self.last_depth = None

    # ------------------------------------------------------------------ inputs
    def on_rgb(self, msg):
        if msg.encoding not in ("rgb8", "bgr8"):
            self.complain(f"Unsupported colour encoding '{msg.encoding}' (need rgb8 or bgr8).")
            return
        image = np.frombuffer(msg.data, np.uint8).reshape(msg.height, msg.step)[:, : msg.width * 3]
        image = image.reshape(msg.height, msg.width, 3)
        self.rgb = image[:, :, ::-1] if msg.encoding == "bgr8" else image

    def on_info(self, msg):
        self.info = msg

    def check_alive(self):
        if self.last_depth is None:
            self.complain("No depth images yet. Is Gazebo rendering the camera (launch with camera:=true, needs OpenGL)?")

    def complain(self, text):
        now = self.get_clock().now().nanoseconds / 1e9
        if now - self.warned > 5.0 or now < self.warned:
            self.warned = now
            self.get_logger().warn(text)

    def publish(self, stamp, objects):
        self.pub.publish(String(data=json.dumps({"stamp": stamp, "objects": objects})))

    # ------------------------------------------------------------------ camera pipeline
    def on_depth(self, msg):
        self.last_depth = msg.header.stamp
        if self.rgb is None or self.info is None:
            return
        if msg.encoding == "32FC1":
            depth = np.frombuffer(msg.data, np.float32).reshape(msg.height, msg.width)
        elif msg.encoding == "16UC1":
            depth = np.frombuffer(msg.data, np.uint16).reshape(msg.height, msg.width).astype(np.float32) / 1000.0
        else:
            self.complain(f"Unsupported depth encoding '{msg.encoding}' (need 32FC1 or 16UC1).")
            return
        if self.rgb.shape[:2] != depth.shape:
            self.complain("Colour and depth images have different sizes.")
            return
        try:
            tf = self.tf.lookup_transform("world", self.optical_frame, Time())
        except TransformException as exc:
            self.complain(f"No transform world <- {self.optical_frame}: {exc}")
            return
        stamp = msg.header.stamp.sec + msg.header.stamp.nanosec / 1e9
        self.publish(stamp, self.detect(depth, self.rgb, tf.transform))

    def detect(self, depth, rgb, transform):
        height, width = depth.shape
        fx, fy, cx, cy = self.info.k[0], self.info.k[4], self.info.k[2], self.info.k[5]
        v, u = np.mgrid[0:height:STRIDE, 0:width:STRIDE]
        z = depth[::STRIDE, ::STRIDE]
        ok = np.isfinite(z) & (z > MIN_RANGE) & (z < 2.0)
        u, v, z = u[ok], v[ok], z[ok]
        colours = rgb[::STRIDE, ::STRIDE][ok]
        camera = np.stack([(u - cx) * z / fx, (v - cy) * z / fy, z], axis=1)
        t = transform.translation
        world = camera @ rotation(transform.rotation).T + np.array([t.x, t.y, t.z])

        above = (world[:, 2] > MIN_HEIGHT) & (world[:, 2] < MAX_HEIGHT)
        world, colours, u, v = world[above], colours[above], u[above], v[above]
        if len(world) < MIN_PIXELS:
            return []

        # Group by position on the table: occupied 5 mm cells that touch each other are one object.
        cells = np.floor(world[:, :2] / CELL).astype(np.int64)
        unique, inverse = np.unique(cells, axis=0, return_inverse=True)
        inverse = inverse.reshape(-1)
        index = {(int(c[0]), int(c[1])): i for i, c in enumerate(unique)}
        label = np.full(len(unique), -1, dtype=np.int64)
        groups = 0
        for start in range(len(unique)):
            if label[start] != -1:
                continue
            label[start] = groups
            stack = [start]
            while stack:
                cx_, cy_ = (int(n) for n in unique[stack.pop()])
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        j = index.get((cx_ + dx, cy_ + dy))
                        if j is not None and label[j] == -1:
                            label[j] = groups
                            stack.append(j)
            groups += 1
        labels = label[inverse]

        objects = []
        for g in range(groups):
            mask = labels == g
            count = int(mask.sum())
            if count < MIN_PIXELS:
                continue
            points = world[mask]
            top = float(np.percentile(points[:, 2], 90))
            surface = points[points[:, 2] > top - 0.008]
            centre = (surface if len(surface) >= 10 else points)[:, :2].mean(axis=0)
            red, green, blue = (float(c) / 255.0 for c in np.median(colours[mask], axis=0))
            hue, saturation, _ = colorsys.rgb_to_hsv(red, green, blue)
            name = "unknown"
            if saturation > 0.25:
                errors = {n: abs((hue * 360.0 - h + 180.0) % 360.0 - 180.0) for n, h in self.hues.items()}
                best = min(errors, key=errors.get)
                if errors[best] < MAX_HUE_ERROR:
                    name = best
            uu, vv = u[mask], v[mask]
            partial = bool(uu.min() < 4 or vv.min() < 4 or uu.max() > width - 5 or vv.max() > height - 5)
            objects.append(
                {
                    "class": name,
                    "x": round(float(centre[0]), 4),
                    "y": round(float(centre[1]), 4),
                    "height": round(top, 4),
                    "partial": partial,
                    "pixels": count,
                }
            )
        return objects

    # ------------------------------------------------------------------ test-only fallback
    def on_models(self, msg):
        objects = []
        for name, pose in zip(msg.name, msg.pose):
            kind = name.rsplit("_", 1)[0]
            if kind in self.catalogue and pose.position.z > -0.05:
                objects.append(
                    {"class": kind, "x": round(pose.position.x, 4), "y": round(pose.position.y, 4),
                     "height": round(pose.position.z, 4), "partial": False, "pixels": 0}
                )
        self.publish(self.get_clock().now().nanoseconds / 1e9, objects)


def main():
    rclpy.init()
    try:
        rclpy.spin(CameraPerception())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
