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

# --------------------------------------------------------------------------
# Testing
# --------------------------------------------------------------------------
if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  ament_lint_auto_find_test_dependencies()
endif()

ament_package()

