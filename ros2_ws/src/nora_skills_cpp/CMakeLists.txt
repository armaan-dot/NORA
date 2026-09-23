cmake_minimum_required(VERSION 3.8)
project(nora_skills_cpp)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# -----------------------------------------------------------------------------
# Dependencies
# -----------------------------------------------------------------------------
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_action REQUIRED)
find_package(nora_interfaces REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(trajectory_msgs REQUIRED)
find_package(control_msgs REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(tf2 REQUIRED)
find_package(tf2_ros REQUIRED)
find_package(tf2_geometry_msgs REQUIRED)

# MoveIt 2 is optional at compile-time to allow building on systems without full MoveIt installed
find_package(moveit_ros_planning_interface QUIET)
find_package(moveit_msgs QUIET)

# -----------------------------------------------------------------------------
# Include Directories & Definitions
# -----------------------------------------------------------------------------
include_directories(
  include
)

set(DEPENDENCY_PACKAGES
  rclcpp
  rclcpp_action
  nora_interfaces
  geometry_msgs
  trajectory_msgs
  control_msgs
  sensor_msgs
  tf2
  tf2_ros
  tf2_geometry_msgs
)

# -----------------------------------------------------------------------------
# Library & Executable
# -----------------------------------------------------------------------------
set(SOURCE_FILES
  src/base_skill.cpp
  src/move_to_pose_skill.cpp
  src/pick_skill.cpp
  src/place_skill.cpp
  src/go_home_skill.cpp
  src/gripper_skill.cpp
)

add_library(${PROJECT_NAME}_lib SHARED
  ${SOURCE_FILES}
)

target_include_directories(${PROJECT_NAME}_lib PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
)

ament_target_dependencies(${PROJECT_NAME}_lib
  ${DEPENDENCY_PACKAGES}
)

if(moveit_ros_planning_interface_FOUND AND moveit_msgs_FOUND)
  target_compile_definitions(${PROJECT_NAME}_lib PUBLIC NORA_HAVE_MOVEIT=1)
  ament_target_dependencies(${PROJECT_NAME}_lib
    moveit_ros_planning_interface
    moveit_msgs
  )
else()
  target_compile_definitions(${PROJECT_NAME}_lib PUBLIC NORA_HAVE_MOVEIT=0)
  message(STATUS "MoveIt 2 not found; building nora_skills_cpp in standalone simulation/mock mode")
endif()

add_executable(nora_skills_cpp_node
  src/skills_main.cpp
)

target_link_libraries(nora_skills_cpp_node
  ${PROJECT_NAME}_lib
)

ament_target_dependencies(nora_skills_cpp_node
  ${DEPENDENCY_PACKAGES}
)

# -----------------------------------------------------------------------------
# Installation
# -----------------------------------------------------------------------------
install(TARGETS
  ${PROJECT_NAME}_lib
  nora_skills_cpp_node
  ARCHIVE DESTINATION lib
  LIBRARY DESTINATION lib
  RUNTIME DESTINATION lib/${PROJECT_NAME}
)

install(DIRECTORY include/
  DESTINATION include
)

install(DIRECTORY launch/
  DESTINATION share/${PROJECT_NAME}/launch
  OPTIONAL
)

install(DIRECTORY config/
  DESTINATION share/${PROJECT_NAME}/config
  OPTIONAL
)

# -----------------------------------------------------------------------------
# Testing
# -----------------------------------------------------------------------------
if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  ament_lint_auto_find_test_dependencies()
endif()

ament_export_include_directories(include)
ament_export_libraries(${PROJECT_NAME}_lib)
ament_export_dependencies(${DEPENDENCY_PACKAGES})
ament_package()

