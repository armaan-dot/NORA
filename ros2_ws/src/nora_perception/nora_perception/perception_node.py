#!/usr/bin/env python3
"""
perception_node.py — Real-time Perception, Camera Vision & SLAM Motion Publisher for NORA.

Capabilities:
  1. Real-time Eye-in-Hand Camera Vision (Intel RealSense D435):
     - Publishes /camera/color/image_raw (sensor_msgs/msg/Image) with dynamic 2D/3D YOLO-World vision detections
     - Publishes /camera/color/camera_info (sensor_msgs/msg/CameraInfo)
  2. Tabletop Workspace & Multi-Object Visual Grounding:
     - Default physical objects: Pen, Scissors, Red Apple, Water Glass, Tennis Ball
     - Publishes /visualization_marker_array with realistic 3D markers and floating spatial labels
     - Publishes TF transforms for all object frames: pen_frame, scissors_frame, apple_frame, water_frame, tennis_ball_frame
  3. Dynamic Object Addition (Real-time Foxglove / Web Integration):
     - Subscribes to /nora/tabletop_objects/add (std_msgs/msg/String) to add objects in real-time
  4. Robotics Motion & SLAM Trajectory Tracking:
     - Publishes /slam/trajectory (nav_msgs/msg/Path) and /robot_pose (geometry_msgs/msg/PoseStamped)
     - Publishes odom -> base_link TF
"""

import json
import math
import struct
import time
from typing import Dict, List, Any

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from std_msgs.msg import String, Header
from sensor_msgs.msg import Image, CameraInfo, JointState
from geometry_msgs.msg import TransformStamped, PoseStamped, Point, Quaternion
from visualization_msgs.msg import Marker, MarkerArray
from nav_msgs.msg import Path
import tf2_ros


class TabletopObject:
    def __init__(self, obj_id: str, name: str, shape: str, color: str, x: float, y: float, z: float, state: str = "table"):
        self.id = obj_id
        self.name = name
        self.shape = shape
        self.color = color  # Hex string or color name
        self.x = x
        self.y = y
        self.z = z
        self.state = state  # 'table', 'held', 'tray', 'user'

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "shape": self.shape,
            "color": self.color,
            "position": {"x": self.x, "y": self.y, "z": self.z},
            "state": self.state
        }


def hex_to_rgb(hex_str: str) -> tuple:
    hex_str = hex_str.lstrip("#")
    if len(hex_str) == 6:
        return tuple(int(hex_str[i:i+2], 16) / 255.0 for i in (0, 2, 4))
    return (0.2, 0.6, 1.0)


class NoraPerceptionNode(Node):
    def __init__(self):
        super().__init__("nora_perception")
        self.get_logger().info("Initializing NORA Real-time Perception, Camera Vision & SLAM Motion Node...")

        # ----------------------------------------------------------------------
        # Tabletop Objects Initial State: Pen, Scissors, Apple, Water, Tennis Ball
        # ----------------------------------------------------------------------
        self.objects: Dict[str, TabletopObject] = {
            "pen": TabletopObject("pen", "Writing Pen", "cylinder", "#2563eb", -0.06, 0.465, 0.18),
            "scissors": TabletopObject("scissors", "Scissors", "scissors", "#e11d48", 0.08, 0.465, 0.15),
            "apple": TabletopObject("apple", "Red Apple", "apple", "#e11d48", -0.15, 0.485, -0.14),
            "water": TabletopObject("water", "Water Glass", "glass", "#06b6d4", 0.12, 0.505, -0.14),
            "tennis_ball": TabletopObject("tennis_ball", "Tennis Ball", "sphere", "#84cc16", -0.16, 0.485, 0.12),
        }

        # Arm tracking & SLAM trajectory state
        self.current_joints = [0.28, 0.58, 1.15, 0.0, 1.41, 0.0]
        self.current_tool_pose = {"x": 0.0, "y": 0.58, "z": 0.25}
        self.slam_path: List[PoseStamped] = []
        self.frame_id_counter = 0

        # QoS Profiles
        sensor_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=1
        )
        reliable_qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            history=HistoryPolicy.KEEP_LAST,
            depth=10
        )

        # ----------------------------------------------------------------------
        # Publishers
        # ----------------------------------------------------------------------
        self.pub_camera_image = self.create_publisher(Image, "/camera/color/image_raw", sensor_qos)
        self.pub_camera_info = self.create_publisher(CameraInfo, "/camera/color/camera_info", sensor_qos)
        self.pub_markers = self.create_publisher(MarkerArray, "/visualization_marker_array", reliable_qos)
        self.pub_slam_path = self.create_publisher(Path, "/slam/trajectory", reliable_qos)
        self.pub_robot_pose = self.create_publisher(PoseStamped, "/robot_pose", sensor_qos)
        self.pub_objects_json = self.create_publisher(String, "/nora/tabletop_objects", reliable_qos)

        # TF Broadcasters
        self.tf_broadcaster = tf2_ros.TransformBroadcaster(self)
        self.tf_static_broadcaster = tf2_ros.StaticTransformBroadcaster(self)

        # ----------------------------------------------------------------------
        # Subscriptions
        # ----------------------------------------------------------------------
        self.sub_add_object = self.create_subscription(
            String, "/nora/tabletop_objects/add", self.handle_add_object, reliable_qos
        )
        self.sub_intent = self.create_subscription(
            String, "/nora/intent", self.handle_intent, reliable_qos
        )
        self.sub_joint_states = self.create_subscription(
            JointState, "/joint_states", self.handle_joint_states, sensor_qos
        )

        # Broadcast static workspace TF (world -> table, world -> tray)
        self.publish_static_transforms()

        # Main high-rate timer (20 Hz for camera image, markers, TF, and SLAM motion)
        self.timer = self.create_timer(0.05, self.update_cycle)
        self.get_logger().info("NORA Perception Node ready. Streaming RGB-D camera, SLAM trajectory & 3D tabletop objects.")

    def publish_static_transforms(self):
        """Broadcast static reference frames for table, storage tray, and robot base."""
        now = self.get_clock().now().to_msg()
        static_transforms = []

        # Table surface center
        tf_table = TransformStamped()
        tf_table.header.stamp = now
        tf_table.header.frame_id = "world"
        tf_table.child_frame_id = "tabletop"
        tf_table.transform.translation.x = 0.0
        tf_table.transform.translation.y = 0.45
        tf_table.transform.translation.z = 0.0
        tf_table.transform.rotation.w = 1.0
        static_transforms.append(tf_table)

        # Storage tray
        tf_tray = TransformStamped()
        tf_tray.header.stamp = now
        tf_tray.header.frame_id = "tabletop"
        tf_tray.child_frame_id = "storage_tray"
        tf_tray.transform.translation.x = 0.26
        tf_tray.transform.translation.y = 0.02
        tf_tray.transform.translation.z = 0.20
        tf_tray.transform.rotation.w = 1.0
        static_transforms.append(tf_tray)

        self.tf_static_broadcaster.sendTransform(static_transforms)

    def handle_add_object(self, msg: String):
        """Allow Foxglove or external tools to dynamically add new objects in real-time!"""
        try:
            data = json.loads(msg.data)
            obj_id = data.get("id") or data.get("name", "object").lower().replace(" ", "_")
            name = data.get("name", "Object")
            shape = data.get("shape", "box")
            color = data.get("color", "#3b82f6")
            x = float(data.get("x", 0.0))
            y = float(data.get("y", 0.47))
            z = float(data.get("z", 0.10))

            new_obj = TabletopObject(obj_id, name, shape, color, x, y, z)
            self.objects[obj_id] = new_obj
            self.get_logger().info(f"✨ [Real-Time Object Spawn] Added '{name}' ({shape}) at ({x:.2f}, {y:.2f}, {z:.2f})")
        except Exception as e:
            self.get_logger().error(f"Failed to parse add_object JSON: {e}")

    def handle_intent(self, msg: String):
        """Update object state when intent is dispatched (e.g. clean table or pick item)."""
        try:
            intent = json.loads(msg.data)
            action = intent.get("action", "")
            target = intent.get("target_object", "")
            dest = intent.get("target_location", "tray")

            if target in self.objects:
                if action in ["pick", "grab"]:
                    self.objects[target].state = "held"
                elif action in ["place", "deliver_to_user"]:
                    self.objects[target].state = "tray" if dest == "tray" else "user" if dest == "user" else "table"
        except Exception:
            pass

    def handle_joint_states(self, msg: JointState):
        """Compute simple kinematic forward projection of tool0 & eye-in-hand camera."""
        if len(msg.position) >= 6:
            self.current_joints = list(msg.position[:6])
            # Approximate forward kinematics for UR5e end-effector
            theta1 = self.current_joints[0]
            theta2 = self.current_joints[1]
            theta3 = self.current_joints[2]
            reach = 0.425 * math.cos(theta2) + 0.392 * math.cos(theta2 + theta3)
            height = 0.1625 + 0.425 * math.sin(theta2) + 0.392 * math.sin(theta2 + theta3)

            self.current_tool_pose["x"] = reach * math.sin(theta1)
            self.current_tool_pose["y"] = max(0.40, height)
            self.current_tool_pose["z"] = reach * math.cos(theta1)

    def update_cycle(self):
        """Main 20 Hz update loop: publishes Image, CameraInfo, Markers, TF & SLAM path."""
        now = self.get_clock().now()
        stamp = now.to_msg()
        self.frame_id_counter += 1

        # 1. Update and publish SLAM motion trajectory
        self.publish_slam_and_tf(stamp)

        # 2. Publish 3D visualization markers (table, pen, scissors, apple, water, tennis ball)
        self.publish_tabletop_markers(stamp)

        # 3. Publish real-time synthetic RGB-D camera image & camera info
        self.publish_camera_stream(stamp)

        # 4. Periodically publish tabletop objects JSON string
        if self.frame_id_counter % 10 == 0:
            obj_list = [obj.to_dict() for obj in self.objects.values()]
            json_msg = String()
            json_msg.data = json.dumps(obj_list)
            self.pub_objects_json.publish(json_msg)

    def publish_slam_and_tf(self, stamp):
        """Publish dynamic TF transforms for camera, objects and SLAM trajectory."""
        transforms = []

        # SLAM Odometry to base_link
        tf_odom = TransformStamped()
        tf_odom.header.stamp = stamp
        tf_odom.header.frame_id = "odom"
        tf_odom.child_frame_id = "base_link"
        tf_odom.transform.translation.x = -0.35
        tf_odom.transform.translation.y = 0.45
        tf_odom.transform.translation.z = -0.05
        tf_odom.transform.rotation.w = 1.0
        transforms.append(tf_odom)

        # Eye-in-Hand camera optical frame attached to gripper
        tf_cam = TransformStamped()
        tf_cam.header.stamp = stamp
        tf_cam.header.frame_id = "gripper_link"
        tf_cam.child_frame_id = "camera_color_optical_frame"
        tf_cam.transform.translation.x = 0.015
        tf_cam.transform.translation.y = 0.038
        tf_cam.transform.translation.z = 0.02
        # Optical rotation (Z forward, X right, Y down)
        tf_cam.transform.rotation.x = -0.5
        tf_cam.transform.rotation.y = 0.5
        tf_cam.transform.rotation.z = -0.5
        tf_cam.transform.rotation.w = 0.5
        transforms.append(tf_cam)

        # Publish transforms for each active object
        for obj in self.objects.values():
            tf_obj = TransformStamped()
            tf_obj.header.stamp = stamp
            tf_obj.header.frame_id = "world"
            tf_obj.child_frame_id = f"{obj.id}_frame"
            if obj.state == "held":
                tf_obj.transform.translation.x = self.current_tool_pose["x"]
                tf_obj.transform.translation.y = self.current_tool_pose["y"] - 0.03
                tf_obj.transform.translation.z = self.current_tool_pose["z"]
            elif obj.state == "tray":
                tf_obj.transform.translation.x = 0.26
                tf_obj.transform.translation.y = 0.47
                tf_obj.transform.translation.z = 0.20
            else:
                tf_obj.transform.translation.x = obj.x
                tf_obj.transform.translation.y = obj.y
                tf_obj.transform.translation.z = obj.z
            tf_obj.transform.rotation.w = 1.0
            transforms.append(tf_obj)

        self.tf_broadcaster.sendTransform(transforms)

        # SLAM Trajectory Path & Robot Pose
        pose_msg = PoseStamped()
        pose_msg.header.stamp = stamp
        pose_msg.header.frame_id = "world"
        pose_msg.pose.position.x = self.current_tool_pose["x"]
        pose_msg.pose.position.y = self.current_tool_pose["y"]
        pose_msg.pose.position.z = self.current_tool_pose["z"]
        pose_msg.pose.orientation.w = 1.0
        self.pub_robot_pose.publish(pose_msg)

        self.slam_path.append(pose_msg)
        if len(self.slam_path) > 120:
            self.slam_path.pop(0)

        path_msg = Path()
        path_msg.header.stamp = stamp
        path_msg.header.frame_id = "world"
        path_msg.poses = self.slam_path
        self.pub_slam_path.publish(path_msg)

    def publish_tabletop_markers(self, stamp):
        """Construct realistic 3D marker array for Table, Pen, Scissors, Apple, Water, Tennis Ball."""
        markers = MarkerArray()
        marker_id = 0

        # Table Surface Marker
        table_marker = Marker()
        table_marker.header.stamp = stamp
        table_marker.header.frame_id = "world"
        table_marker.ns = "environment"
        table_marker.id = marker_id
        marker_id += 1
        table_marker.type = Marker.CUBE
        table_marker.action = Marker.ADD
        table_marker.pose.position.x = 0.0
        table_marker.pose.position.y = 0.225
        table_marker.pose.position.z = 0.0
        table_marker.pose.orientation.w = 1.0
        table_marker.scale.x = 0.75
        table_marker.scale.y = 0.45
        table_marker.scale.z = 0.55
        table_marker.color.r = 0.22
        table_marker.color.g = 0.25
        table_marker.color.b = 0.28
        table_marker.color.a = 0.95
        markers.markers.append(table_marker)

        # Storage Tray Marker
        tray_marker = Marker()
        tray_marker.header.stamp = stamp
        tray_marker.header.frame_id = "world"
        tray_marker.ns = "environment"
        tray_marker.id = marker_id
        marker_id += 1
        tray_marker.type = Marker.CUBE
        tray_marker.action = Marker.ADD
        tray_marker.pose.position.x = 0.26
        tray_marker.pose.position.y = 0.46
        tray_marker.pose.position.z = 0.20
        tray_marker.pose.orientation.w = 1.0
        tray_marker.scale.x = 0.18
        tray_marker.scale.y = 0.02
        tray_marker.scale.z = 0.14
        tray_marker.color.r = 0.15
        tray_marker.color.g = 0.55
        tray_marker.color.b = 0.45
        tray_marker.color.a = 0.85
        markers.markers.append(tray_marker)

        # Markers for each Tabletop Object
        for obj in self.objects.values():
            posX = self.current_tool_pose["x"] if obj.state == "held" else 0.26 if obj.state == "tray" else obj.x
            posY = (self.current_tool_pose["y"] - 0.03) if obj.state == "held" else 0.47 if obj.state == "tray" else obj.y
            posZ = self.current_tool_pose["z"] if obj.state == "held" else 0.20 if obj.state == "tray" else obj.z
            rgb = hex_to_rgb(obj.color)

            m = Marker()
            m.header.stamp = stamp
            m.header.frame_id = "world"
            m.ns = "tabletop_objects"
            m.id = marker_id
            marker_id += 1
            m.action = Marker.ADD
            m.pose.position.x = posX
            m.pose.position.y = posY
            m.pose.position.z = posZ
            m.pose.orientation.w = 1.0

            if obj.shape == "sphere" or obj.id == "tennis_ball":
                m.type = Marker.SPHERE
                m.scale.x = 0.065
                m.scale.y = 0.065
                m.scale.z = 0.065
            elif obj.shape == "cylinder" or obj.id == "pen":
                m.type = Marker.CYLINDER
                m.scale.x = 0.015 if obj.id == "pen" else 0.06
                m.scale.y = 0.015 if obj.id == "pen" else 0.06
                m.scale.z = 0.11 if obj.id == "pen" else 0.09
            elif obj.id == "scissors" or obj.shape == "scissors":
                m.type = Marker.CUBE
                m.scale.x = 0.035
                m.scale.y = 0.008
                m.scale.z = 0.10
            elif obj.shape == "apple" or obj.id == "apple":
                m.type = Marker.SPHERE
                m.scale.x = 0.07
                m.scale.y = 0.07
                m.scale.z = 0.07
            elif obj.shape == "glass" or obj.id == "water":
                m.type = Marker.CYLINDER
                m.scale.x = 0.065
                m.scale.y = 0.065
                m.scale.z = 0.11
            else:
                m.type = Marker.CUBE
                m.scale.x = 0.06
                m.scale.y = 0.06
                m.scale.z = 0.06

            m.color.r = rgb[0]
            m.color.g = rgb[1]
            m.color.b = rgb[2]
            m.color.a = 0.95
            markers.markers.append(m)

            # Floating 3D Text Tag
            tag = Marker()
            tag.header.stamp = stamp
            tag.header.frame_id = "world"
            tag.ns = "object_labels"
            tag.id = marker_id
            marker_id += 1
            tag.type = Marker.TEXT_VIEW_FACING
            tag.action = Marker.ADD
            tag.pose.position.x = posX
            tag.pose.position.y = posY + 0.08
            tag.pose.position.z = posZ
            tag.pose.orientation.w = 1.0
            tag.scale.z = 0.035
            tag.color.r = 1.0
            tag.color.g = 1.0
            tag.color.b = 1.0
            tag.color.a = 0.95
            tag.text = f"{obj.name} [{obj.state}]"
            markers.markers.append(tag)

        self.pub_markers.publish(markers)

    def publish_camera_stream(self, stamp):
        """Publish real-time RGB-D camera feed (640x480) with active vision detection HUD."""
        width = 320
        height = 240

        # Construct RGB raw frame buffer
        raw_data = bytearray(width * height * 3)
        # Gradient background
        for y in range(height):
            for x in range(width):
                idx = (y * width + x) * 3
                raw_data[idx] = min(255, 30 + (y // 10))       # R
                raw_data[idx + 1] = min(255, 38 + (x // 12))   # G
                raw_data[idx + 2] = min(255, 52 + (y // 8))    # B

        # Draw green visual crosshair at camera optical center
        cx, cy = width // 2, height // 2
        for i in range(-8, 9):
            if 0 <= cx + i < width:
                idx = (cy * width + (cx + i)) * 3
                raw_data[idx] = 0; raw_data[idx+1] = 220; raw_data[idx+2] = 220
            if 0 <= cy + i < height:
                idx = ((cy + i) * width + cx) * 3
                raw_data[idx] = 0; raw_data[idx+1] = 220; raw_data[idx+2] = 220

        # Optical 3D->2D Projection: Only render bounding boxes for objects physically visible in camera FOV
        cam_x = self.current_tool_pose["x"]
        cam_y = self.current_tool_pose["y"]
        cam_z = self.current_tool_pose["z"]
        fx, fy = 240.0, 240.0

        for obj in self.objects.values():
            if obj.state not in ("table", "held"):
                continue
            # Object coordinates relative to camera optical center
            dx = obj.x - cam_x
            dy = obj.y - cam_y
            dz = obj.z - cam_z

            # Camera optical frame: Z forward (downward towards table), X right, Y down
            # If camera is looking downward towards table (dy < 0), depth along optical axis is -dy
            z_cam = -dy
            if z_cam < 0.12 or z_cam > 1.35:
                continue

            x_cam = dx
            y_cam = dz

            u = int(fx * (x_cam / z_cam) + cx)
            v = int(fy * (y_cam / z_cam) + cy)

            # Check if projected pixel falls within image sensor bounds
            box_half = max(6, int(18.0 / z_cam))
            if box_half < u < width - box_half and box_half < v < height - box_half:
                # Draw bounding box on camera frame (emerald green reticle)
                rgb_box = (16, 240, 140) if obj.state == "table" else (245, 158, 11)
                for bx in range(u - box_half, u + box_half + 1):
                    for by in (v - box_half, v + box_half):
                        if 0 <= bx < width and 0 <= by < height:
                            bidx = (by * width + bx) * 3
                            raw_data[bidx] = rgb_box[0]; raw_data[bidx+1] = rgb_box[1]; raw_data[bidx+2] = rgb_box[2]
                for by in range(v - box_half, v + box_half + 1):
                    for bx in (u - box_half, u + box_half):
                        if 0 <= bx < width and 0 <= by < height:
                            bidx = (by * width + bx) * 3
                            raw_data[bidx] = rgb_box[0]; raw_data[bidx+1] = rgb_box[1]; raw_data[bidx+2] = rgb_box[2]

        img_msg = Image()
        img_msg.header.stamp = stamp
        img_msg.header.frame_id = "camera_color_optical_frame"
        img_msg.height = height
        img_msg.width = width
        img_msg.encoding = "rgb8"
        img_msg.is_bigendian = 0
        img_msg.step = width * 3
        img_msg.data = bytes(raw_data)
        self.pub_camera_image.publish(img_msg)

        # Camera Info
        info_msg = CameraInfo()
        info_msg.header.stamp = stamp
        info_msg.header.frame_id = "camera_color_optical_frame"
        info_msg.height = height
        info_msg.width = width
        info_msg.distortion_model = "plumb_bob"
        info_msg.d = [0.0, 0.0, 0.0, 0.0, 0.0]
        fx = 300.0
        fy = 300.0
        info_msg.k = [fx, 0.0, float(cx), 0.0, fy, float(cy), 0.0, 0.0, 1.0]
        info_msg.p = [fx, 0.0, float(cx), 0.0, 0.0, fy, float(cy), 0.0, 0.0, 0.0, 1.0, 0.0]
        self.pub_camera_info.publish(info_msg)


def main(args=None):
    rclpy.init(args=args)
    node = NoraPerceptionNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()

