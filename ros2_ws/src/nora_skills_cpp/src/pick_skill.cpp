#include "nora_skills_cpp/pick_skill.hpp"
#include <regex>
#include <chrono>
#include <thread>

namespace nora_skills_cpp
{

PickSkill::PickSkill(
  const rclcpp::Node::SharedPtr & node,
  const std::shared_ptr<MoveToPoseSkill> & move_to_pose_skill,
  const std::shared_ptr<GripperSkill> & open_gripper_skill,
  const std::shared_ptr<GripperSkill> & close_gripper_skill,
  const std::string & action_topic_name)
: BaseSkill(node, "pick", action_topic_name),
  move_to_pose_skill_(move_to_pose_skill),
  open_gripper_skill_(open_gripper_skill),
  close_gripper_skill_(close_gripper_skill)
{
  tf_buffer_ = std::make_shared<tf2_ros::Buffer>(node_->get_clock());
  tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*tf_buffer_);
}

bool PickSkill::parse_object_pose(
  const std::string & json_str,
  geometry_msgs::msg::Pose & out_pose)
{
  // Default grasp pose on tabletop
  out_pose.position.x = 0.4;
  out_pose.position.y = 0.0;
  out_pose.position.z = 0.15;
  out_pose.orientation.w = 1.0;

  if (json_str.empty()) {
    return true;
  }

  // Look for target object in params, e.g. "target_object": "red_cube" or "object": "red_cube"
  std::regex obj_reg(R"foo("(?:target_object|object)"\s*:\s*"([^"]+)")foo");
  std::smatch obj_match;
  if (std::regex_search(json_str, obj_match, obj_reg) && obj_match.size() > 1) {
    std::string obj_frame = std::string("nora/objects/") + obj_match.str(1);
    try {
      if (tf_buffer_->canTransform("base_link", obj_frame, tf2::TimePointZero, tf2::durationFromSec(0.2))) {
        auto tf = tf_buffer_->lookupTransform("base_link", obj_frame, tf2::TimePointZero);
        out_pose.position.x = tf.transform.translation.x;
        out_pose.position.y = tf.transform.translation.y;
        out_pose.position.z = tf.transform.translation.z;
        out_pose.orientation = tf.transform.rotation;
        RCLCPP_INFO(node_->get_logger(), "[PickSkill] Found TF pose for '%s'", obj_frame.c_str());
        return true;
      }
    } catch (const tf2::TransformException & ex) {
      RCLCPP_WARN(node_->get_logger(), "[PickSkill] TF lookup failed for '%s': %s", obj_frame.c_str(), ex.what());
    }
  }

  // Fallback to explicit x,y,z if present
  auto extract_number = [&](const std::string & key, double & val) {
    std::regex reg(std::string("\"") + key + std::string("\"\\s*:\\s*([-+]?[0-9]*\\.?[0-9]+)"));
    std::smatch match;
    if (std::regex_search(json_str, match, reg) && match.size() > 1) {
      val = std::stod(match.str(1));
      return true;
    }
    return false;
  };
  extract_number("x", out_pose.position.x);
  extract_number("y", out_pose.position.y);
  extract_number("z", out_pose.position.z);

  return true;
}

bool PickSkill::execute(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle)
{
  const auto & goal = goal_handle->get_goal();
  geometry_msgs::msg::Pose grasp_pose;
  parse_object_pose(goal->skill_call.params_json, grasp_pose);

  RCLCPP_INFO(
    node_->get_logger(),
    "[PickSkill] Starting pick sequence at target pose [x=%.3f, y=%.3f, z=%.3f]",
    grasp_pose.position.x, grasp_pose.position.y, grasp_pose.position.z);

  // 1. Open gripper
  publish_feedback(goal_handle, "OPENING_GRIPPER");
  if (open_gripper_skill_) {
    open_gripper_skill_->actuate(true);
  }

  // 2. Pre-grasp approach (10 cm above object)
  publish_feedback(goal_handle, "APPROACHING_PRE_GRASP");
  geometry_msgs::msg::Pose pre_grasp_pose = grasp_pose;
  pre_grasp_pose.position.z += 0.10;
  if (move_to_pose_skill_) {
    if (!move_to_pose_skill_->moveToTargetPose(pre_grasp_pose)) {
      RCLCPP_ERROR(node_->get_logger(), "[PickSkill] Failed to reach pre-grasp pose");
      return false;
    }
  }

  // 3. Descend to grasp pose
  publish_feedback(goal_handle, "DESCENDING_TO_OBJECT");
  if (move_to_pose_skill_) {
    if (!move_to_pose_skill_->moveToTargetPose(grasp_pose)) {
      RCLCPP_ERROR(node_->get_logger(), "[PickSkill] Failed to descend to grasp pose");
      return false;
    }
  }

  // 4. Close gripper (grasp)
  publish_feedback(goal_handle, "CLOSING_GRIPPER");
  if (close_gripper_skill_) {
    close_gripper_skill_->actuate(false);
  }

  // 5. Vertical lift retreat (15 cm above)
  publish_feedback(goal_handle, "LIFTING_OBJECT");
  geometry_msgs::msg::Pose lift_pose = grasp_pose;
  lift_pose.position.z += 0.15;
  if (move_to_pose_skill_) {
    if (!move_to_pose_skill_->moveToTargetPose(lift_pose)) {
      RCLCPP_ERROR(node_->get_logger(), "[PickSkill] Failed to lift object");
      return false;
    }
  }

  publish_feedback(goal_handle, "PICK_COMPLETED");
  RCLCPP_INFO(node_->get_logger(), "[PickSkill] Pick sequence completed successfully");
  return true;
}

}  // namespace nora_skills_cpp

