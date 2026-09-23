#pragma once

#include "nora_skills_cpp/base_skill.hpp"
#include "nora_skills_cpp/move_to_pose_skill.hpp"
#include "nora_skills_cpp/gripper_skill.hpp"

namespace nora_skills_cpp
{

class PlaceSkill : public BaseSkill
{
public:
  PlaceSkill(
    const rclcpp::Node::SharedPtr & node,
    const std::shared_ptr<MoveToPoseSkill> & move_to_pose_skill,
    const std::shared_ptr<GripperSkill> & open_gripper_skill,
    const std::string & action_topic_name = "/nora/skills/place");

protected:
  bool execute(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle) override;

private:
  bool parse_place_pose(
    const std::string & json_str,
    geometry_msgs::msg::Pose & out_pose);

  std::shared_ptr<MoveToPoseSkill> move_to_pose_skill_;
  std::shared_ptr<GripperSkill> open_gripper_skill_;
  std::shared_ptr<tf2_ros::Buffer> tf_buffer_;
  std::shared_ptr<tf2_ros::TransformListener> tf_listener_;
};

}  // namespace nora_skills_cpp

