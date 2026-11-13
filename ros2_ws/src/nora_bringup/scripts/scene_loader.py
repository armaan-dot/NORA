#!/usr/bin/env python3
"""Publishes the scene JSON file on /nora/scene: when the simulator connects and whenever the file is saved."""
import json
import os

import rclpy
from rclpy.node import Node
from std_msgs.msg import String


class SceneLoader(Node):
    def __init__(self):
        super().__init__("nora_scene_loader")
        self.path = self.declare_parameter("scene_file", "").value
        self.pub = self.create_publisher(String, "/nora/scene", 1)
        self.mtime = 0.0
        self.subs = 0
        self.create_timer(1.0, self.tick)

    def tick(self):
        subs = self.pub.get_subscription_count()
        mtime = os.path.getmtime(self.path)
        if subs and (mtime != self.mtime or subs > self.subs):
            try:
                with open(self.path, encoding="utf-8") as f:
                    text = f.read()
                count = len(json.loads(text)["objects"])
            except (ValueError, KeyError) as exc:
                self.get_logger().error(f"{self.path}: {exc}")
            else:
                self.pub.publish(String(data=text))
                self.get_logger().info(f"Sent {count} objects from {self.path}")
            self.mtime = mtime
        self.subs = subs


def main():
    rclpy.init()
    rclpy.spin(SceneLoader())


if __name__ == "__main__":
    main()
