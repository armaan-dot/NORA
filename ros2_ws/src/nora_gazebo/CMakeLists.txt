cmake_minimum_required(VERSION 3.8)
project(nora_gazebo)

find_package(ament_cmake REQUIRED)

# --------------------------------------------------------------------------
# Install all data directories
# --------------------------------------------------------------------------
install(DIRECTORY
  worlds/
  DESTINATION share/${PROJECT_NAME}/worlds
)

install(DIRECTORY
  models/
  DESTINATION share/${PROJECT_NAME}/models
)

install(DIRECTORY
  launch/
  DESTINATION share/${PROJECT_NAME}/launch
)

install(DIRECTORY
  config/
  DESTINATION share/${PROJECT_NAME}/config
)

# --------------------------------------------------------------------------
# Testing
# --------------------------------------------------------------------------
if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  ament_lint_auto_find_test_dependencies()
endif()

ament_package()
