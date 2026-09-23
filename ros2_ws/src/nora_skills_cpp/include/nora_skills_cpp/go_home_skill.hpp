#pragma once

#include "nora_skills_cpp/base_skill.hpp"

#if NORA_HAVE_MOVEIT
#include <moveit/move_group_interface/move_group_interface.h>
#endif

namespace nora_skills_cpp
{

class GoHomeSkill : public BaseSkill
{
public:
  GoHomeSkill(
    const rclcpp::Node::SharedPtr & node,
    const std::string & action_topic_name = "/nora/skills/go_home");

  bool returnToHome();

protected:
  bool execute(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle) override;

private:
  std::string planning_group_;

#if NORA_HAVE_MOVEIT
  std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;
#endif
};

}  // namespace nora_skills_cpp

