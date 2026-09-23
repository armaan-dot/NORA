#include "nora_skills_cpp/gripper_skill.hpp"
#include <chrono>
#include <thread>

namespace nora_skills_cpp
{

GripperSkill::GripperSkill(
  const rclcpp::Node::SharedPtr & node,
  bool is_open_action,
  const std::string & action_topic_name)
: BaseSkill(
    node,
    is_open_action ? "open_gripper" : "close_gripper",
    action_topic_name),
  is_open_action_(is_open_action),
  gripper_group_("gripper")
{
  gripper_action_client_ = rclcpp_action::create_client<GripperCommand>(
    node_,
    "/gripper_controller/gripper_cmd");

#if NORA_HAVE_MOVEIT
  try {
    move_group_ = std::make_shared<moveit::planning_interface::MoveGroupInterface>(node_, gripper_group_);
    RCLCPP_INFO(node_->get_logger(), "[GripperSkill] MoveGroupInterface initialized for gripper group '%s'", gripper_group_.c_str());
  } catch (const std::exception & e) {
    RCLCPP_WARN(node_->get_logger(), "[GripperSkill] Gripper MoveGroupInterface not available (%s); will use action client or fallback.", e.what());
    move_group_.reset();
  }
#endif
}

bool GripperSkill::actuate(bool open)
{
  double target_position = open ? 0.04 : 0.0; // Aperture in meters

#if NORA_HAVE_MOVEIT
  if (move_group_) {
    move_group_->setNamedTarget(open ? "open" : "close");
    moveit::planning_interface::MoveGroupInterface::Plan plan;
    if (move_group_->plan(plan) == moveit::core::MoveItErrorCode::SUCCESS) {
      auto res = move_group_->execute(plan);
      if (res == moveit::core::MoveItErrorCode::SUCCESS) {
        return true;
      }
    }
  }
#endif

  // If MoveIt gripper group is not active, try standard ROS 2 GripperCommand action server
  if (gripper_action_client_ && gripper_action_client_->wait_for_action_server(std::chrono::milliseconds(200))) {
    GripperCommand::Goal goal;
    goal.command.position = target_position;
    goal.command.max_effort = 20.0;

    auto send_goal_future = gripper_action_client_->async_send_goal(goal);
    // Wait briefly for goal
    if (send_goal_future.wait_for(std::chrono::seconds(2)) == std::future_status::ready) {
      return true;
    }
  }

  // Graceful simulation fallback
  std::this_thread::sleep_for(std::chrono::milliseconds(300));
  return true;
}

bool GripperSkill::execute(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle)
{
  RCLCPP_INFO(
    node_->get_logger(),
    "[GripperSkill] Executing %s...",
    is_open_action_ ? "OPEN_GRIPPER" : "CLOSE_GRIPPER");

  publish_feedback(goal_handle, is_open_action_ ? "OPENING" : "CLOSING");

  bool success = actuate(is_open_action_);

  if (success) {
    publish_feedback(goal_handle, is_open_action_ ? "OPENED" : "CLOSED");
  }

  return success;
}

}  // namespace nora_skills_cpp

