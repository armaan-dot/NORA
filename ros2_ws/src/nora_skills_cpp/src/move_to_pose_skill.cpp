#include "nora_skills_cpp/move_to_pose_skill.hpp"
#include <regex>
#include <chrono>
#include <thread>

namespace nora_skills_cpp
{

MoveToPoseSkill::MoveToPoseSkill(
  const rclcpp::Node::SharedPtr & node,
  const std::string & action_topic_name)
: BaseSkill(node, "move_to_pose", action_topic_name),
  planning_group_("arm"),
  velocity_scaling_(0.3),
  acceleration_scaling_(0.3)
{
  tf_buffer_ = std::make_shared<tf2_ros::Buffer>(node_->get_clock());
  tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*tf_buffer_);

#if NORA_HAVE_MOVEIT
  try {
    move_group_ = std::make_shared<moveit::planning_interface::MoveGroupInterface>(node_, planning_group_);
    move_group_->setMaxVelocityScalingFactor(velocity_scaling_);
    move_group_->setMaxAccelerationScalingFactor(acceleration_scaling_);
    RCLCPP_INFO(node_->get_logger(), "[MoveToPoseSkill] MoveGroupInterface initialized for group '%s'", planning_group_.c_str());
  } catch (const std::exception & e) {
    RCLCPP_WARN(node_->get_logger(), "[MoveToPoseSkill] MoveGroupInterface could not initialize (%s). Falling back to mock/sim mode.", e.what());
    move_group_.reset();
  }
#endif
}

bool MoveToPoseSkill::parse_pose_from_json(
  const std::string & json_str,
  geometry_msgs::msg::Pose & out_pose)
{
  // Default values
  out_pose.position.x = 0.3;
  out_pose.position.y = 0.0;
  out_pose.position.z = 0.4;
  out_pose.orientation.w = 1.0;

  if (json_str.empty()) {
    return true;
  }

  // Parse simple json fields "x": 0.123, "y": 0.456, "z": 0.789
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
  extract_number("qx", out_pose.orientation.x);
  extract_number("qy", out_pose.orientation.y);
  extract_number("qz", out_pose.orientation.z);
  extract_number("qw", out_pose.orientation.w);

  // Check if target object label is specified, e.g. "object": "red_cube"
  std::regex obj_reg(R"foo("object"\s*:\s*"([^"]+)")foo");
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
        RCLCPP_INFO(node_->get_logger(), "[MoveToPoseSkill] Resolved pose for '%s' via TF", obj_frame.c_str());
      }
    } catch (const tf2::TransformException & ex) {
      RCLCPP_WARN(node_->get_logger(), "[MoveToPoseSkill] TF lookup failed for '%s': %s", obj_frame.c_str(), ex.what());
    }
  }

  return true;
}

bool MoveToPoseSkill::moveToTargetPose(const geometry_msgs::msg::Pose & target_pose)
{
#if NORA_HAVE_MOVEIT
  if (move_group_) {
    move_group_->setPoseTarget(target_pose);
    moveit::planning_interface::MoveGroupInterface::Plan plan;
    bool success = (move_group_->plan(plan) == moveit::core::MoveItErrorCode::SUCCESS);
    if (!success) {
      RCLCPP_ERROR(node_->get_logger(), "[MoveToPoseSkill] MoveIt 2 motion planning failed for target pose");
      return false;
    }
    auto exec_code = move_group_->execute(plan);
    return (exec_code == moveit::core::MoveItErrorCode::SUCCESS);
  }
#endif

  // Mock / simulation fallback
  (void)target_pose;
  std::this_thread::sleep_for(std::chrono::milliseconds(500));
  return true;
}

bool MoveToPoseSkill::execute(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle)
{
  const auto & goal = goal_handle->get_goal();
  geometry_msgs::msg::Pose target_pose;
  parse_pose_from_json(goal->skill_call.params_json, target_pose);

  RCLCPP_INFO(
    node_->get_logger(),
    "[MoveToPoseSkill] Moving to target pose: [x=%.3f, y=%.3f, z=%.3f]",
    target_pose.position.x, target_pose.position.y, target_pose.position.z);

  publish_feedback(goal_handle, "PLANNING_TRAJECTORY");
  std::this_thread::sleep_for(std::chrono::milliseconds(200));

  publish_feedback(goal_handle, "EXECUTING_MOTION");
  bool success = moveToTargetPose(target_pose);

  if (success) {
    publish_feedback(goal_handle, "TARGET_REACHED");
  }

  return success;
}

}  // namespace nora_skills_cpp

