#include <memory>
#include <string>

#include "rclcpp/rclcpp.hpp"
#include "nora_skills_cpp/move_to_pose_skill.hpp"
#include "nora_skills_cpp/gripper_skill.hpp"
#include "nora_skills_cpp/pick_skill.hpp"
#include "nora_skills_cpp/place_skill.hpp"
#include "nora_skills_cpp/go_home_skill.hpp"

namespace nora_skills_cpp
{

class UnifiedSkillDispatcher : public BaseSkill
{
public:
  UnifiedSkillDispatcher(
    const rclcpp::Node::SharedPtr & node,
    const std::shared_ptr<MoveToPoseSkill> & move_to_pose_skill,
    const std::shared_ptr<GripperSkill> & open_gripper_skill,
    const std::shared_ptr<GripperSkill> & close_gripper_skill,
    const std::shared_ptr<PickSkill> & pick_skill,
    const std::shared_ptr<PlaceSkill> & place_skill,
    const std::shared_ptr<GoHomeSkill> & go_home_skill)
  : BaseSkill(node, "unified_dispatcher", "/nora/skills/execute"),
    move_to_pose_skill_(move_to_pose_skill),
    open_gripper_skill_(open_gripper_skill),
    close_gripper_skill_(close_gripper_skill),
    pick_skill_(pick_skill),
    place_skill_(place_skill),
    go_home_skill_(go_home_skill)
  {
  }

protected:
  bool execute(const std::shared_ptr<GoalHandleExecuteSkill> goal_handle) override
  {
    const auto & goal = goal_handle->get_goal();
    const std::string & skill = goal->skill_call.skill_name;
    RCLCPP_INFO(
      node_->get_logger(),
      "[UnifiedSkillDispatcher] Dispatching skill '%s'",
      skill.c_str());

    if (skill == "move_to_pose") {
      return move_to_pose_skill_->execute(goal_handle);
    } else if (skill == "pick") {
      return pick_skill_->execute(goal_handle);
    } else if (skill == "place") {
      return place_skill_->execute(goal_handle);
    } else if (skill == "open_gripper") {
      return open_gripper_skill_->execute(goal_handle);
    } else if (skill == "close_gripper") {
      return close_gripper_skill_->execute(goal_handle);
    } else if (skill == "go_home") {
      return go_home_skill_->execute(goal_handle);
    } else {
      RCLCPP_ERROR(
        node_->get_logger(),
        "[UnifiedSkillDispatcher] Unknown skill name '%s'",
        skill.c_str());
      return false;
    }
  }

private:
  std::shared_ptr<MoveToPoseSkill> move_to_pose_skill_;
  std::shared_ptr<GripperSkill> open_gripper_skill_;
  std::shared_ptr<GripperSkill> close_gripper_skill_;
  std::shared_ptr<PickSkill> pick_skill_;
  std::shared_ptr<PlaceSkill> place_skill_;
  std::shared_ptr<GoHomeSkill> go_home_skill_;
};

}  // namespace nora_skills_cpp

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);

  rclcpp::NodeOptions options;
  options.automatically_declare_parameters_from_overrides(true);
  auto node = std::make_shared<rclcpp::Node>("nora_skills_cpp_node", options);

  RCLCPP_INFO(node->get_logger(), "Initializing NORA C++ Movement Skills...");

  // Instantiate individual skills
  auto move_to_pose_skill = std::make_shared<nora_skills_cpp::MoveToPoseSkill>(
    node, "/nora/skills/move_to_pose");

  auto open_gripper_skill = std::make_shared<nora_skills_cpp::GripperSkill>(
    node, true, "/nora/skills/open_gripper");

  auto close_gripper_skill = std::make_shared<nora_skills_cpp::GripperSkill>(
    node, false, "/nora/skills/close_gripper");

  auto pick_skill = std::make_shared<nora_skills_cpp::PickSkill>(
    node, move_to_pose_skill, open_gripper_skill, close_gripper_skill, "/nora/skills/pick");

  auto place_skill = std::make_shared<nora_skills_cpp::PlaceSkill>(
    node, move_to_pose_skill, open_gripper_skill, "/nora/skills/place");

  auto go_home_skill = std::make_shared<nora_skills_cpp::GoHomeSkill>(
    node, "/nora/skills/go_home");

  // Also instantiate unified dispatcher on /nora/skills/execute
  auto unified_dispatcher = std::make_shared<nora_skills_cpp::UnifiedSkillDispatcher>(
    node, move_to_pose_skill, open_gripper_skill, close_gripper_skill,
    pick_skill, place_skill, go_home_skill);

  RCLCPP_INFO(node->get_logger(), "All NORA C++ Movement Skills are running and ready.");

  rclcpp::executors::MultiThreadedExecutor executor(
    rclcpp::ExecutorOptions(), 4);
  executor.add_node(node);
  executor.spin();

  rclcpp::shutdown();
  return 0;
}

