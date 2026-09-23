#pragma once

#include <memory>
#include <string>
#include <functional>

#include "rclcpp/rclcpp.hpp"
#include "rclcpp_action/rclcpp_action.hpp"
#include "nora_interfaces/action/execute_skill.hpp"
#include "nora_interfaces/msg/skill_call.hpp"

namespace nora_skills_cpp
{

class BaseSkill
{
public:
  using ExecuteSkill = nora_interfaces::action::ExecuteSkill;
  using GoalHandleExecuteSkill = rclcpp_action::ServerGoalHandle<ExecuteSkill>;

  BaseSkill(
    const rclcpp::Node::SharedPtr & node,
    const std::string & skill_name,
    const std::string & action_topic_name);

  virtual ~BaseSkill() = default;

  const std::string & get_skill_name() const { return skill_name_; }
  const std::string & get_action_topic() const { return action_topic_; }

protected:
  // Hook for concrete skills to implement actual motion execution
  virtual bool execute(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle) = 0;

  // Optional pre-condition check
  virtual bool check_preconditions(const ExecuteSkill::Goal & goal);

  // Helper method to publish feedback status string
  void publish_feedback(
    const std::shared_ptr<GoalHandleExecuteSkill> & goal_handle,
    const std::string & status);

  // ROS node handle and configuration
  rclcpp::Node::SharedPtr node_;
  std::string skill_name_;
  std::string action_topic_;

  rclcpp::CallbackGroup::SharedPtr cb_group_;
  rclcpp_action::Server<ExecuteSkill>::SharedPtr action_server_;

private:
  rclcpp_action::GoalResponse handle_goal(
    const rclcpp_action::GoalUUID & uuid,
    std::shared_ptr<const ExecuteSkill::Goal> goal);

  rclcpp_action::CancelResponse handle_cancel(
    const std::shared_ptr<GoalHandleExecuteSkill> goal_handle);

  void handle_accepted(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle);
};

}  // namespace nora_skills_cpp

