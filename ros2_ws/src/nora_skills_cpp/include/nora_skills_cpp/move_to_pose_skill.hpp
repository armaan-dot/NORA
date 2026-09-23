#pragma once

#include "nora_skills_cpp/base_skill.hpp"
#include "geometry_msgs/msg/pose_stamped.hpp"
#include "tf2_ros/buffer.h"
#include "tf2_ros/transform_listener.h"

#if NORA_HAVE_MOVEIT
#include <moveit/move_group_interface/move_group_interface.h>
#endif

namespace nora_skills_cpp
{

class MoveToPoseSkill : public BaseSkill
{
public:
  MoveToPoseSkill(
    const rclcpp::Node::SharedPtr & node,
    const std::string & action_topic_name = "/nora/skills/move_to_pose");

  bool moveToTargetPose(const geometry_msgs::msg::Pose & target_pose);

protected:
  bool execute(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle) override;

private:
  bool parse_pose_from_json(
    const std::string & json_str,
    geometry_msgs::msg::Pose & out_pose);

  std::string planning_group_;
  double velocity_scaling_;
  double acceleration_scaling_;

  std::shared_ptr<tf2_ros::Buffer> tf_buffer_;
  std::shared_ptr<tf2_ros::TransformListener> tf_listener_;

#if NORA_HAVE_MOVEIT
  std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;
#endif
};

}  // namespace nora_skills_cpp

