cmake_minimum_required(VERSION 3.8)
project(nora_bringup)

find_package(ament_cmake REQUIRED)

# --------------------------------------------------------------------------
# Install launch scripts and configuration
# --------------------------------------------------------------------------
install(DIRECTORY
  launch/
  DESTINATION share/${PROJECT_NAME}/launch
)

install(DIRECTORY
  foxglove/
  DESTINATION share/${PROJECT_NAME}/foxglove
)

install(DIRECTORY
  config/
  DESTINATION share/${PROJECT_NAME}/config
)

# The arm description is the web simulator's own URDF, so Foxglove and MoveIt use exactly the same arm.
install(FILES
  ${CMAKE_CURRENT_SOURCE_DIR}/../../../frontend/public/nora_arm.urdf
  DESTINATION share/${PROJECT_NAME}/urdf
)

install(PROGRAMS
  scripts/scene_loader.py
  scripts/arm_commander.py
  scripts/camera_perception.py
  DESTINATION lib/${PROJECT_NAME}
)

# --------------------------------------------------------------------------
# Testing
# --------------------------------------------------------------------------
if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  ament_lint_auto_find_test_dependencies()
endif()

ament_package()

