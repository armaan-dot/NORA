// Copyright 2026 NORA Team
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

// Runs a planner-generated skill sequence as a BehaviorTree.CPP tree.
//
//   Action server  /nora/execute_plan        (nora_interfaces/ExecutePlan)
//   Action clients /nora/skills/<skill>      (nora_interfaces/ExecuteSkill)
//   Subscriptions  /nora/world_model/state   (nora_interfaces/WorldState)
//                  /nora/estop               (std_msgs/Bool)
//   Service client /nora/world_model/update  (nora_interfaces/UpdateWorld)
//   Publisher      /nora/bt_executor/status  (std_msgs/String: IDLE|RUNNING|SUCCESS|FAILURE)
//
// The tree is ticked from a timer on a single-threaded executor, so skill
// actions never block and no locking is needed.

#include <algorithm>
#include <cctype>
#include <chrono>
#include <map>
#include <memory>
#include <regex>
#include <sstream>
#include <string>
#include <vector>

#include "behaviortree_cpp/bt_factory.h"
#include "nora_interfaces/action/execute_plan.hpp"
#include "nora_interfaces/action/execute_skill.hpp"
#include "nora_interfaces/msg/world_state.hpp"
#include "nora_interfaces/srv/update_world.hpp"
#include "rclcpp/rclcpp.hpp"
#include "rclcpp_action/rclcpp_action.hpp"
#include "std_msgs/msg/bool.hpp"
#include "std_msgs/msg/string.hpp"

namespace nora_bt_executor
{

using ExecutePlan = nora_interfaces::action::ExecutePlan;
using ExecuteSkill = nora_interfaces::action::ExecuteSkill;
using PlanGoalHandle = rclcpp_action::ServerGoalHandle<ExecutePlan>;
using SkillClient = rclcpp_action::Client<ExecuteSkill>;
using SkillGoalHandle = rclcpp_action::ClientGoalHandle<ExecuteSkill>;
using UpdateWorld = nora_interfaces::srv::UpdateWorld;
using WorldObject = nora_interfaces::msg::WorldObject;
using WorldState = nora_interfaces::msg::WorldState;
using Clock = std::chrono::steady_clock;

struct Step
{
  nora_interfaces::msg::SkillCall call;
  std::string object;
  std::string location;
};

// State of one attempt at a skill goal. Shared with the action-client
// callbacks so a late callback from a halted attempt cannot touch a newer one.
struct Attempt
{
  SkillGoalHandle::SharedPtr handle;
  bool responded = false;
  bool halted = false;
  bool done = false;
  bool success = false;
  bool world_updated = false;
  std::string message;
};

static std::string json_string(const std::string & json, const std::string & keys)
{
  std::smatch match;
  const std::regex re("\"(?:" + keys + ")\"\\s*:\\s*\"([^\"]+)\"");
  return std::regex_search(json, match, re) ? match.str(1) : "";
}

static double seconds_since(Clock::time_point t)
{
  return std::chrono::duration<double>(Clock::now() - t).count();
}

class BtExecutor : public rclcpp::Node
{
public:
  BtExecutor();

  BT::NodeStatus fail(int index, const std::string & code, const std::string & reason);
  const WorldObject * find_object(const std::string & name) const;
  SkillClient::SharedPtr skill_client(const std::string & skill);
  bool update_world(const Step & step, const std::shared_ptr<Attempt> & attempt);

  std::vector<Step> steps_;
  std::vector<nora_interfaces::msg::SkillCall> executed_;
  std::vector<WorldObject> world_;
  int current_ = -1;
  bool fatal_ = false;
  double skill_timeout_;
  double server_wait_;
  double world_update_timeout_;
  std::string inject_skill_;
  int inject_count_;

private:
  void start(std::shared_ptr<PlanGoalHandle> goal);
  std::string build_xml() const;
  void tick();
  void finish(bool success, bool canceled = false);
  void set_status(const std::string & status);

  BT::BehaviorTreeFactory factory_;
  BT::Tree tree_;
  std::shared_ptr<PlanGoalHandle> goal_;
  int failure_index_ = -1;
  std::string failure_code_;
  std::string failure_reason_;
  int feedback_index_ = -1;
  int attempts_;
  bool estop_ = false;

  std::map<std::string, SkillClient::SharedPtr> skill_clients_;
  rclcpp_action::Server<ExecutePlan>::SharedPtr server_;
  rclcpp::Client<UpdateWorld>::SharedPtr update_client_;
  rclcpp::Subscription<WorldState>::SharedPtr world_sub_;
  rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr estop_sub_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr status_pub_;
  rclcpp::TimerBase::SharedPtr timer_;
};

// Action leaf: sends one ExecuteSkill goal and stays RUNNING until it resolves.
class SkillAction : public BT::StatefulActionNode
{
public:
  SkillAction(const std::string & name, const BT::NodeConfig & config, BtExecutor * exec)
  : BT::StatefulActionNode(name, config), exec_(exec) {}

  static BT::PortsList providedPorts() {return {BT::InputPort<int>("index")};}

  BT::NodeStatus onStart() override
  {
    index_ = getInput<int>("index").value();
    exec_->current_ = index_;
    if (exec_->fatal_) {
      return BT::NodeStatus::FAILURE;
    }
    const Step & step = exec_->steps_[index_];
    if (step.call.skill_name == exec_->inject_skill_ && exec_->inject_count_ > 0) {
      --exec_->inject_count_;
      return exec_->fail(index_, "SKILL_ABORTED", "injected failure (inject_failure_skill)");
    }
    try {
      client_ = exec_->skill_client(step.call.skill_name);
    } catch (const std::exception & e) {
      return exec_->fail(index_, "INVALID_PLAN", e.what());
    }
    attempt_ = std::make_shared<Attempt>();
    sent_ = false;
    updating_ = false;
    started_ = Clock::now();
    return onRunning();
  }

  BT::NodeStatus onRunning() override
  {
    const Step & step = exec_->steps_[index_];
    const std::string & skill = step.call.skill_name;
    if (!sent_) {
      if (!client_->action_server_is_ready()) {
        if (seconds_since(started_) > exec_->server_wait_) {
          return exec_->fail(
            index_, "SERVER_UNAVAILABLE", "no action server at /nora/skills/" + skill);
        }
        return BT::NodeStatus::RUNNING;
      }
      send_goal(step);
      return BT::NodeStatus::RUNNING;
    }
    if (attempt_->responded && !attempt_->handle) {
      return exec_->fail(
        index_, "GOAL_REJECTED", "skill '" + skill + "' rejected the goal (precondition check)");
    }
    if (!attempt_->done) {
      if (seconds_since(started_) > exec_->skill_timeout_) {
        onHalted();
        return exec_->fail(index_, "TIMEOUT", "skill '" + skill + "' did not finish in time");
      }
      return BT::NodeStatus::RUNNING;
    }
    if (!attempt_->success) {
      const bool internal = attempt_->message.rfind("Internal error", 0) == 0;
      return exec_->fail(
        index_, internal ? "INTERNAL_ERROR" : "SKILL_ABORTED",
        "skill '" + skill + "': " + attempt_->message);
    }
    if (!updating_) {
      updating_ = exec_->update_world(step, attempt_);
      started_ = Clock::now();
    }
    if (updating_ && !attempt_->world_updated &&
      seconds_since(started_) < exec_->world_update_timeout_)
    {
      return BT::NodeStatus::RUNNING;
    }
    exec_->executed_.push_back(step.call);
    return BT::NodeStatus::SUCCESS;
  }

  void onHalted() override
  {
    if (!attempt_ || attempt_->done) {
      return;
    }
    attempt_->halted = true;  // cancels on acceptance if the goal is still in flight
    if (attempt_->handle) {
      try {
        client_->async_cancel_goal(attempt_->handle);
      } catch (const std::exception &) {
      }
    }
  }

private:
  void send_goal(const Step & step)
  {
    ExecuteSkill::Goal goal;
    goal.skill_call = step.call;
    goal.skill_call.timestamp = exec_->now();

    auto attempt = attempt_;
    auto client = client_;
    SkillClient::SendGoalOptions options;
    options.goal_response_callback = [attempt, client](SkillGoalHandle::SharedPtr handle) {
        attempt->responded = true;
        attempt->handle = handle;
        if (handle && attempt->halted) {
          client->async_cancel_goal(handle);
        }
      };
    options.result_callback = [attempt](const SkillGoalHandle::WrappedResult & wrapped) {
        attempt->done = true;
        attempt->success = wrapped.code == rclcpp_action::ResultCode::SUCCEEDED &&
          wrapped.result && wrapped.result->success;
        attempt->message = wrapped.result ? wrapped.result->message : "no result";
      };
    client_->async_send_goal(goal, options);
    sent_ = true;
    started_ = Clock::now();
  }

  BtExecutor * exec_;
  SkillClient::SharedPtr client_;
  std::shared_ptr<Attempt> attempt_;
  int index_ = -1;
  bool sent_ = false;
  bool updating_ = false;
  Clock::time_point started_;
};

// Condition leaf over the cached world model. state="known" means the object
// is in the scene graph and not missing/unknown. With required="true" a failed
// check is reported as the plan's failure; otherwise it only steers a Fallback.
class ObjectInState : public BT::ConditionNode
{
public:
  ObjectInState(const std::string & name, const BT::NodeConfig & config, BtExecutor * exec)
  : BT::ConditionNode(name, config), exec_(exec) {}

  static BT::PortsList providedPorts()
  {
    return {
      BT::InputPort<int>("index"), BT::InputPort<std::string>("state"),
      BT::InputPort<bool>("required")};
  }

  BT::NodeStatus tick() override
  {
    const int index = getInput<int>("index").value();
    const std::string state = getInput<std::string>("state").value();
    const std::string & name = exec_->steps_[index].object;
    const WorldObject * obj = exec_->find_object(name);
    const bool ok = state == "known" ?
      obj && obj->state != "missing" && obj->state != "unknown" :
      obj && obj->state == state;
    if (ok) {
      return BT::NodeStatus::SUCCESS;
    }
    if (!getInput<bool>("required").value()) {
      return BT::NodeStatus::FAILURE;
    }
    exec_->current_ = index;
    return exec_->fail(
      index, "PRECONDITION",
      "object '" + name + "' is " + (obj ? obj->state : "not in the world model") +
      ", expected " + state);
  }

private:
  BtExecutor * exec_;
};

BtExecutor::BtExecutor()
: rclcpp::Node("nora_bt_executor")
{
  attempts_ = 1 + std::max<int>(0, declare_parameter("max_action_retries", 2));
  skill_timeout_ = declare_parameter("skill_timeout_sec", 60.0);
  server_wait_ = declare_parameter("server_wait_sec", 5.0);
  world_update_timeout_ = declare_parameter("world_update_timeout_sec", 1.0);
  inject_skill_ = declare_parameter("inject_failure_skill", std::string());
  inject_count_ = declare_parameter("inject_failure_count", 0);
  const int tick_ms = declare_parameter("tick_period_ms", 20);

  factory_.registerBuilder<SkillAction>(
    "ExecuteSkill", [this](const std::string & name, const BT::NodeConfig & config) {
      return std::make_unique<SkillAction>(name, config, this);
    });
  factory_.registerBuilder<ObjectInState>(
    "ObjectInState", [this](const std::string & name, const BT::NodeConfig & config) {
      return std::make_unique<ObjectInState>(name, config, this);
    });

  status_pub_ = create_publisher<std_msgs::msg::String>(
    "/nora/bt_executor/status", rclcpp::QoS(1).transient_local());
  world_sub_ = create_subscription<WorldState>(
    "/nora/world_model/state", rclcpp::QoS(1).transient_local(),
    [this](WorldState::ConstSharedPtr msg) {world_ = msg->objects;});
  estop_sub_ = create_subscription<std_msgs::msg::Bool>(
    "/nora/estop", 10, [this](std_msgs::msg::Bool::ConstSharedPtr msg) {
      if (msg->data != estop_) {
        RCLCPP_WARN(get_logger(), "Emergency stop %s", msg->data ? "ENGAGED" : "released");
      }
      estop_ = msg->data;
    });
  update_client_ = create_client<UpdateWorld>("/nora/world_model/update");

  server_ = rclcpp_action::create_server<ExecutePlan>(
    this, "/nora/execute_plan",
    [this](const rclcpp_action::GoalUUID &, std::shared_ptr<const ExecutePlan::Goal> goal) {
      if (estop_ || goal_ || goal->plan.empty()) {
        RCLCPP_WARN(
          get_logger(), "Rejecting plan: %s",
          estop_ ? "emergency stop engaged" : goal_ ? "a plan is already running" : "empty plan");
        return rclcpp_action::GoalResponse::REJECT;
      }
      return rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;
    },
    [](std::shared_ptr<PlanGoalHandle>) {return rclcpp_action::CancelResponse::ACCEPT;},
    [this](std::shared_ptr<PlanGoalHandle> goal) {start(goal);});

  timer_ = create_wall_timer(std::chrono::milliseconds(tick_ms), [this]() {tick();});
  set_status("IDLE");
}

BT::NodeStatus BtExecutor::fail(int index, const std::string & code, const std::string & reason)
{
  failure_index_ = index;
  failure_code_ = code;
  failure_reason_ = reason;
  // Anything that retrying or replanning cannot fix ends in a safe stop.
  fatal_ = code == "ESTOP" || code == "CANCELED" || code == "SERVER_UNAVAILABLE" ||
    code == "INTERNAL_ERROR" || code == "INVALID_PLAN";
  RCLCPP_WARN(get_logger(), "Step %d failed [%s]: %s", index, code.c_str(), reason.c_str());
  return BT::NodeStatus::FAILURE;
}

const WorldObject * BtExecutor::find_object(const std::string & name) const
{
  std::string key = name;
  std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) {
      return c == ' ' ? '_' : std::tolower(c);
    });
  if (key.empty()) {
    return nullptr;
  }
  for (const auto & obj : world_) {
    if (obj.id == key || obj.label == key) {
      return &obj;
    }
  }
  for (const auto & obj : world_) {
    if (obj.id.find(key) != std::string::npos || key.find(obj.id) != std::string::npos) {
      return &obj;
    }
  }
  return nullptr;
}

SkillClient::SharedPtr BtExecutor::skill_client(const std::string & skill)
{
  auto & client = skill_clients_[skill];
  if (!client) {
    client = rclcpp_action::create_client<ExecuteSkill>(this, "/nora/skills/" + skill);
  }
  return client;
}

// Tells the world model what a successful pick/place changed. Returns false
// when there is nothing to report or nobody to report it to.
bool BtExecutor::update_world(const Step & step, const std::shared_ptr<Attempt> & attempt)
{
  const std::string & skill = step.call.skill_name;
  if ((skill != "pick" && skill != "place") || !update_client_->service_is_ready()) {
    return false;
  }
  auto request = std::make_shared<UpdateWorld::Request>();
  request->object_id = step.object;
  if (skill == "pick") {
    request->state = "grasped";
  } else {
    request->state = "placed";
    request->location = step.location;
    if (request->object_id.empty()) {
      for (const auto & obj : world_) {
        if (obj.state == "grasped") {
          request->object_id = obj.id;
        }
      }
    }
  }
  if (request->object_id.empty()) {
    return false;
  }
  update_client_->async_send_request(
    request, [this, attempt](rclcpp::Client<UpdateWorld>::SharedFuture future) {
      const auto response = future.get();
      if (response->success) {
        auto it = std::find_if(world_.begin(), world_.end(), [&](const WorldObject & obj) {
            return obj.id == response->object.id;
          });
        if (it == world_.end()) {
          world_.push_back(response->object);
        } else {
          *it = response->object;
        }
      }
      attempt->world_updated = true;
    });
  return true;
}

void BtExecutor::start(std::shared_ptr<PlanGoalHandle> goal)
{
  goal_ = goal;
  steps_.clear();
  executed_.clear();
  current_ = feedback_index_ = failure_index_ = -1;
  failure_code_.clear();
  failure_reason_.clear();
  fatal_ = false;
  for (const auto & call : goal->get_goal()->plan) {
    steps_.push_back(
      {call, json_string(call.params_json, "target_object|object"),
        json_string(call.params_json, "target_location")});
  }
  try {
    tree_ = factory_.createTreeFromText(build_xml());
  } catch (const std::exception & e) {
    fail(-1, "INVALID_PLAN", e.what());
    finish(false);
    return;
  }
  RCLCPP_INFO(get_logger(), "Executing plan with %zu step(s)", steps_.size());
  set_status("RUNNING");
}

// Sequence of steps. Each skill is wrapped in a retry; when the world model
// has content, picks are skipped if the object is already held and guarded by
// "object is known", and places are guarded by "object is held".
std::string BtExecutor::build_xml() const
{
  std::ostringstream xml;
  xml << "<root BTCPP_format=\"4\"><BehaviorTree ID=\"Plan\"><Sequence>";
  for (size_t i = 0; i < steps_.size(); ++i) {
    const std::string index = " index=\"" + std::to_string(i) + "\"";
    const std::string action = "<RetryUntilSuccessful num_attempts=\"" +
      std::to_string(attempts_) + "\"><ExecuteSkill" + index + "/></RetryUntilSuccessful>";
    const std::string & skill = steps_[i].call.skill_name;
    const bool guarded = !world_.empty() && !steps_[i].object.empty();
    if (guarded && skill == "pick") {
      xml << "<Fallback><ObjectInState" << index << " state=\"grasped\" required=\"false\"/>"
          << "<Sequence><ObjectInState" << index << " state=\"known\" required=\"true\"/>"
          << action << "</Sequence></Fallback>";
    } else if (guarded && skill == "place") {
      xml << "<Sequence><ObjectInState" << index << " state=\"grasped\" required=\"true\"/>"
          << action << "</Sequence>";
    } else {
      xml << action;
    }
  }
  xml << "</Sequence></BehaviorTree></root>";
  return xml.str();
}

void BtExecutor::tick()
{
  if (!goal_) {
    return;
  }
  if (estop_) {
    fail(current_, "ESTOP", "emergency stop engaged");
    finish(false);
    return;
  }
  if (goal_->is_canceling()) {
    fail(current_, "CANCELED", "canceled by client");
    finish(false, true);
    return;
  }
  BT::NodeStatus status;
  try {
    status = tree_.tickOnce();
  } catch (const std::exception & e) {
    fail(current_, "INTERNAL_ERROR", e.what());
    status = BT::NodeStatus::FAILURE;
  }
  if (current_ != feedback_index_ && current_ >= 0) {
    feedback_index_ = current_;
    auto feedback = std::make_shared<ExecutePlan::Feedback>();
    feedback->status = "RUNNING";
    feedback->current_index = current_;
    feedback->current_skill = steps_[current_].call.skill_name;
    feedback->progress = static_cast<float>(executed_.size()) / steps_.size();
    goal_->publish_feedback(feedback);
  }
  if (status != BT::NodeStatus::RUNNING) {
    finish(status == BT::NodeStatus::SUCCESS);
  }
}

void BtExecutor::finish(bool success, bool canceled)
{
  if (tree_.rootNode()) {
    tree_.haltTree();  // cancels a skill goal that is still running
  }
  auto result = std::make_shared<ExecutePlan::Result>();
  result->success = success;
  result->executed_skills = executed_;
  result->world_state = world_;
  result->failed_index = -1;
  result->message = "plan completed";
  if (!success) {
    result->failed_index = failure_index_;
    if (failure_index_ >= 0) {
      result->failed_skill = steps_[failure_index_].call.skill_name;
    }
    result->failure_code = failure_code_;
    result->failure_reason = failure_reason_;
    result->recoverable = !fatal_;
    result->message = failure_code_ + ": " + failure_reason_;
  }
  if (canceled) {
    goal_->canceled(result);
  } else if (success) {
    goal_->succeed(result);
  } else {
    goal_->abort(result);
  }
  goal_.reset();
  set_status(success ? "SUCCESS" : "FAILURE");
}

void BtExecutor::set_status(const std::string & status)
{
  std_msgs::msg::String msg;
  msg.data = status;
  status_pub_->publish(msg);
}

}  // namespace nora_bt_executor

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<nora_bt_executor::BtExecutor>());
  rclcpp::shutdown();
  return 0;
}
