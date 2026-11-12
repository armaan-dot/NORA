cmake_minimum_required(VERSION 3.8)
project(nora_bt_executor)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_action REQUIRED)
find_package(std_msgs REQUIRED)
find_package(nora_interfaces REQUIRED)
find_package(behaviortree_cpp REQUIRED)

add_executable(bt_executor_node src/bt_executor_node.cpp)
ament_target_dependencies(bt_executor_node
  rclcpp
  rclcpp_action
  std_msgs
  nora_interfaces
  behaviortree_cpp
)

install(TARGETS bt_executor_node
  RUNTIME DESTINATION lib/${PROJECT_NAME}
)

install(DIRECTORY config
  DESTINATION share/${PROJECT_NAME}
)

ament_package()
