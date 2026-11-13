#!/usr/bin/env python3
"""
ground_truth_perception.py: test-only stand-in for the camera detector (nora_perception).

Publishes the poses Gazebo reports for the scene's objects on /nora/perception/detections, in the same
message type and frame (vision_msgs/Detection3DArray, base_link) as the detector. It exists only to test
the rest of the system on a machine that cannot render the camera or run the detection model.
"""
import json

import rclpy
from gazebo_msgs.msg import ModelStates
from rclpy.node import Node
from vision_msgs.msg import Detection3D, Detection3DArray, ObjectHypothesisWithPose

BASE_Z = 0.45  # height of base_link (the table top) in the Gazebo world: world_to_base in nora_arm.urdf.xacro


class GroundTruthPerception(Node):
    def __init__(self):
        super().__init__("nora_ground_truth_perception")
        with open(self.declare_parameter("scene_file", "").value, encoding="utf-8") as f:
            self.catalogue = json.load(f)["catalogue"]
        self.models = None
        self.pub = self.create_publisher(Detection3DArray, "/nora/perception/detections", 1)
        self.create_subscription(ModelStates, "/gazebo/model_states", lambda msg: setattr(self, "models", msg), 1)
        self.create_timer(0.2, self.publish)
        self.get_logger().warn("Object positions come from Gazebo, NOT from the camera.")

    def publish(self):
        if self.models is None:
            return
        out = Detection3DArray()
        out.header.stamp = self.get_clock().now().to_msg()
        out.header.frame_id = "base_link"
        for name, pose in zip(self.models.name, self.models.pose):
            if name not in self.catalogue or pose.position.z < BASE_Z - 0.05:  # not a scene object, or fell off the table
                continue
            hypothesis = ObjectHypothesisWithPose()
            hypothesis.hypothesis.class_id = name
            hypothesis.hypothesis.score = 1.0
            hypothesis.pose.pose.position.x = pose.position.x
            hypothesis.pose.pose.position.y = pose.position.y
            hypothesis.pose.pose.position.z = pose.position.z - BASE_Z
            detection = Detection3D()
            detection.header = out.header
            detection.id = name
            detection.results.append(hypothesis)
            detection.bbox.center.position = hypothesis.pose.pose.position
            out.detections.append(detection)
        self.pub.publish(out)


def main():
    rclpy.init()
    try:
        rclpy.spin(GroundTruthPerception())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
