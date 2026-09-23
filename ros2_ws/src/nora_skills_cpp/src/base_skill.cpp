#include "nora_skills_cpp/base_skill.hpp"
#include <thread>

namespace nora_skills_cpp
{

BaseSkill::BaseSkill(
  const rclcpp::Node::SharedPtr & node,
  const std::string & skill_name,
  const std::string & action_topic_name)
: node_(node),
  skill_name_(skill_name),
  action_topic_(action_topic_name)
{
  cb_group_ = node_->create_callback_group(rclcpp::CallbackGroupType::Reentrant);

  action_server_ = rclcpp_action::create_server<ExecuteSkill>(
    node_,
    action_topic_,
    std::bind(&BaseSkill::handle_goal, this, std::placeholders::_1, std::placeholders::_2),
    std::bind(&BaseSkill::handle_cancel, this, std::placeholders::_1),
    std::bind(&BaseSkill::handle_accepted, this, std::placeholders::_1),
    rcl_action_server_get_default_options(),
    cb_group_);

  RCLCPP_INFO(
    node_->get_logger(),
    "[Skill: %s] Action server started on topic '%s'",
    skill_name_.c_str(),
    action_topic_.c_str());
}

bool BaseSkill::check_preconditions(const ExecuteSkill::Goal & /*goal*/)
{
  // Default: always valid
  return true;
}

void BaseSkill::publish_feedback(
  const std::shared_ptr<GoalHandleExecuteSkill> & goal_handle,
  const std::string & status)
{
  if (!goal_handle || !goal_handle->is_active()) {
    return;
  }
  auto feedback = std::make_shared<ExecuteSkill::Feedback>();
  feedback->status = status;
  goal_handle->publish_feedback(feedback);
}

rclcpp_action::GoalResponse BaseSkill::handle_goal(
  const rclcpp_action::GoalUUID & /*uuid*/,
  std::shared_ptr<const ExecuteSkill::Goal> goal)
{
  RCLCPP_INFO(
    node_->get_logger(),
    "[Skill: %s] Received goal for intent '%s'",
    skill_name_.c_str(),
    goal->skill_call.intent_id.c_str());

  if (!check_preconditions(*goal)) {
    RCLCPP_WARN(
      node_->get_logger(),
      "[Skill: %s] Precondition check failed; rejecting goal",
      skill_name_.c_str());
    return rclcpp_action::GoalResponse::REJECT;
  }

  return rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;
}

rclcpp_action::CancelResponse BaseSkill::handle_cancel(
  const std::shared_ptr<GoalHandleExecuteSkill> /*goal_handle*/)
{
  RCLCPP_INFO(
    node_->get_logger(),
    "[Skill: %s] Goal cancellation requested",
    skill_name_.c_str());
  return rclcpp_action::CancelResponse::ACCEPT;
}

void BaseSkill::handle_accepted(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle)
{
  // Run execution in a separate worker thread so executor thread is not blocked
  std::thread{
    [this, goal_handle]() {
      auto result = std::make_shared<ExecuteSkill::Result>();
      try {
        publish_feedback(goal_handle, "EXECUTING");
        bool success = this->execute(goal_handle);

        if (goal_handle->is_canceling()) {
          result->success = false;
          result->message = "Skill execution canceled by client";
          goal_handle->canceled(result);
          RCLCPP_WARN(
            node_->get_logger(),
            "[Skill: %s] Execution canceled",
            skill_name_.c_str());
          return;
        }

        result->success = success;
        result->message = success ? "Skill execution succeeded" : "Skill execution failed";

        if (success) {
          publish_feedback(goal_handle, "SUCCEEDED");
          goal_handle->succeed(result);
          RCLCPP_INFO(
            node_->get_logger(),
            "[Skill: %s] Execution succeeded",
            skill_name_.c_str());
        } else {
          publish_feedback(goal_handle, "ABORTED");
          goal_handle->abort(result);
          RCLCPP_ERROR(
            node_->get_logger(),
            "[Skill: %s] Execution aborted",
            skill_name_.c_str());
        }
      } catch (const std::exception & e) {
        RCLCPP_ERROR(
          node_->get_logger(),
          "[Skill: %s] Exception during execution: %s",
          skill_name_.c_str(),
          e.what());
        result->success = false;
        result->message = std::string("Internal error: ") + e.what();
        goal_handle->abort(result);
      }
    }
  }.detach();
}

}  // namespace nora_skills_cpp

