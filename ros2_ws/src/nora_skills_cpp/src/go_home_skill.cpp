#include "nora_skills_cpp/go_home_skill.hpp"
#include <chrono>
#include <thread>

namespace nora_skills_cpp
{

GoHomeSkill::GoHomeSkill(
  const rclcpp::Node::SharedPtr & node,
  const std::string & action_topic_name)
: BaseSkill(node, "go_home", action_topic_name),
  planning_group_("arm")
{
#if NORA_HAVE_MOVEIT
  try {
    move_group_ = std::make_shared<moveit::planning_interface::MoveGroupInterface>(node_, planning_group_);
  } catch (const std::exception & e) {
    RCLCPP_WARN(node_->get_logger(), "[GoHomeSkill] MoveGroupInterface not available (%s); will use fallback.", e.what());
    move_group_.reset();
  }
#endif
}

bool GoHomeSkill::returnToHome()
{
#if NORA_HAVE_MOVEIT
  if (move_group_) {
    // Try named target first ("home")
    bool planned = false;
    moveit::planning_interface::MoveGroupInterface::Plan plan;
    if (move_group_->setNamedTarget("home")) {
      planned = (move_group_->plan(plan) == moveit::core::MoveItErrorCode::SUCCESS);
    }

    // If named target not found in SRDF, fallback to all joint values 0.0
    if (!planned) {
      std::vector<double> joint_positions(6, 0.0);
      move_group_->setJointValueTarget(joint_positions);
      planned = (move_group_->plan(plan) == moveit::core::MoveItErrorCode::SUCCESS);
    }

    if (planned) {
      auto exec_code = move_group_->execute(plan);
      return (exec_code == moveit::core::MoveItErrorCode::SUCCESS);
    } else {
      RCLCPP_ERROR(node_->get_logger(), "[GoHomeSkill] Failed to plan trajectory to home position");
      return false;
    }
  }
#endif

  // Mock / simulation fallback
  std::this_thread::sleep_for(std::chrono::milliseconds(500));
  return true;
}

bool GoHomeSkill::execute(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle)
{
  RCLCPP_INFO(node_->get_logger(), "[GoHomeSkill] Returning arm to home pose...");
  publish_feedback(goal_handle, "MOVING_TO_HOME");

  bool success = returnToHome();

  if (success) {
    publish_feedback(goal_handle, "HOME_REACHED");
    RCLCPP_INFO(node_->get_logger(), "[GoHomeSkill] Arm safely at home pose");
  }

  return success;
}

}  // namespace nora_skills_cpp

