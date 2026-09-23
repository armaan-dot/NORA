#include "nora_skills_cpp/place_skill.hpp"
#include <regex>
#include <chrono>
#include <thread>

namespace nora_skills_cpp
{

PlaceSkill::PlaceSkill(
  const rclcpp::Node::SharedPtr & node,
  const std::shared_ptr<MoveToPoseSkill> & move_to_pose_skill,
  const std::shared_ptr<GripperSkill> & open_gripper_skill,
  const std::string & action_topic_name)
: BaseSkill(node, "place", action_topic_name),
  move_to_pose_skill_(move_to_pose_skill),
  open_gripper_skill_(open_gripper_skill)
{
  tf_buffer_ = std::make_shared<tf2_ros::Buffer>(node_->get_clock());
  tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*tf_buffer_);
}

bool PlaceSkill::parse_place_pose(
  const std::string & json_str,
  geometry_msgs::msg::Pose & out_pose)
{
  // Default place location on tabletop
  out_pose.position.x = 0.2;
  out_pose.position.y = 0.3;
  out_pose.position.z = 0.15;
  out_pose.orientation.w = 1.0;

  if (json_str.empty()) {
    return true;
  }

  // Look for target location or container frame in params, e.g. "target_location": "tray"
  std::regex loc_reg(R"foo("(?:target_location|location|destination)"\s*:\s*"([^"]+)")foo");
  std::smatch loc_match;
  if (std::regex_search(json_str, loc_match, loc_reg) && loc_match.size() > 1) {
    std::string loc_frame = std::string("nora/objects/") + loc_match.str(1);
    try {
      if (tf_buffer_->canTransform("base_link", loc_frame, tf2::TimePointZero, tf2::durationFromSec(0.2))) {
        auto tf = tf_buffer_->lookupTransform("base_link", loc_frame, tf2::TimePointZero);
        out_pose.position.x = tf.transform.translation.x;
        out_pose.position.y = tf.transform.translation.y;
        out_pose.position.z = tf.transform.translation.z;
        out_pose.orientation = tf.transform.rotation;
        RCLCPP_INFO(node_->get_logger(), "[PlaceSkill] Found TF pose for '%s'", loc_frame.c_str());
        return true;
      }
    } catch (const tf2::TransformException & ex) {
      RCLCPP_WARN(node_->get_logger(), "[PlaceSkill] TF lookup failed for '%s': %s", loc_frame.c_str(), ex.what());
    }
  }

  // Fallback to coordinates
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

bool PlaceSkill::execute(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle)
{
  const auto & goal = goal_handle->get_goal();
  geometry_msgs::msg::Pose place_pose;
  parse_place_pose(goal->skill_call.params_json, place_pose);

  RCLCPP_INFO(
    node_->get_logger(),
    "[PlaceSkill] Starting place sequence at target pose [x=%.3f, y=%.3f, z=%.3f]",
    place_pose.position.x, place_pose.position.y, place_pose.position.z);

  // 1. Move to pre-place approach pose (15 cm above target)
  publish_feedback(goal_handle, "APPROACHING_PRE_PLACE");
  geometry_msgs::msg::Pose pre_place_pose = place_pose;
  pre_place_pose.position.z += 0.15;
  if (move_to_pose_skill_) {
    if (!move_to_pose_skill_->moveToTargetPose(pre_place_pose)) {
      RCLCPP_ERROR(node_->get_logger(), "[PlaceSkill] Failed to reach pre-place pose");
      return false;
    }
  }

  // 2. Descend to place surface
  publish_feedback(goal_handle, "LOWERING_OBJECT");
  if (move_to_pose_skill_) {
    if (!move_to_pose_skill_->moveToTargetPose(place_pose)) {
      RCLCPP_ERROR(node_->get_logger(), "[PlaceSkill] Failed to descend to place pose");
      return false;
    }
  }

  // 3. Open gripper to release
  publish_feedback(goal_handle, "RELEASING_OBJECT");
  if (open_gripper_skill_) {
    open_gripper_skill_->actuate(true);
  }

  // 4. Retract arm upward
  publish_feedback(goal_handle, "RETRACTING_ARM");
  if (move_to_pose_skill_) {
    if (!move_to_pose_skill_->moveToTargetPose(pre_place_pose)) {
      RCLCPP_ERROR(node_->get_logger(), "[PlaceSkill] Failed to retract arm");
      return false;
    }
  }

  publish_feedback(goal_handle, "PLACE_COMPLETED");
  RCLCPP_INFO(node_->get_logger(), "[PlaceSkill] Place sequence completed successfully");
  return true;
}

}  // namespace nora_skills_cpp

