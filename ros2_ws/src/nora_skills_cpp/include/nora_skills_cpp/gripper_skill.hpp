#pragma once

#include "nora_skills_cpp/base_skill.hpp"
#include "control_msgs/action/gripper_command.hpp"

#if NORA_HAVE_MOVEIT
#include <moveit/move_group_interface/move_group_interface.h>
#endif

namespace nora_skills_cpp
{

class GripperSkill : public BaseSkill
{
public:
  using GripperCommand = control_msgs::action::GripperCommand;

  GripperSkill(
    const rclcpp::Node::SharedPtr & node,
    bool is_open_action,
    const std::string & action_topic_name);

  bool actuate(bool open);

protected:
  bool execute(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle) override;

private:
  bool is_open_action_;
  std::string gripper_group_;
  rclcpp_action::Client<GripperCommand>::SharedPtr gripper_action_client_;

#if NORA_HAVE_MOVEIT
  std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;
#endif
};

}  // namespace nora_skills_cpp

