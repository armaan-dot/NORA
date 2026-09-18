cmake_minimum_required(VERSION 3.8)
project(nora_interfaces)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# --------------------------------------------------------------------------
# Dependencies
# --------------------------------------------------------------------------
find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(action_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(builtin_interfaces REQUIRED)

# --------------------------------------------------------------------------
# Interface generation
# --------------------------------------------------------------------------
rosidl_generate_interfaces(${PROJECT_NAME}
  # Messages
  "msg/Intent.msg"
  "msg/SkillCall.msg"
  "msg/AffordanceScore.msg"

  # Services
  "srv/ParseCommand.srv"
  "srv/ScoreAffordances.srv"

  # Actions
  "action/ExecuteIntent.action"
  "action/ExecuteSkill.action"

  DEPENDENCIES
    builtin_interfaces
    std_msgs
    geometry_msgs
    action_msgs
)

# --------------------------------------------------------------------------
# Testing
# --------------------------------------------------------------------------
if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  ament_lint_auto_find_test_dependencies()

  find_package(ament_cmake_pytest REQUIRED)
  ament_add_pytest_test(test_interfaces test/test_interfaces.py)
endif()

ament_package()
