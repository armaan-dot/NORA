cmake_minimum_required(VERSION 3.8)
project(nora_description)

find_package(ament_cmake REQUIRED)

# --------------------------------------------------------------------------
# Install all data directories
# --------------------------------------------------------------------------
install(DIRECTORY
  urdf/
  DESTINATION share/${PROJECT_NAME}/urdf
)

install(DIRECTORY
  meshes/
  DESTINATION share/${PROJECT_NAME}/meshes
)

install(DIRECTORY
  config/
  DESTINATION share/${PROJECT_NAME}/config
)

install(DIRECTORY
  launch/
  DESTINATION share/${PROJECT_NAME}/launch
)

install(DIRECTORY
  rviz/
  DESTINATION share/${PROJECT_NAME}/rviz
)

# --------------------------------------------------------------------------
# Testing
# --------------------------------------------------------------------------
if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  ament_lint_auto_find_test_dependencies()
endif()

ament_package()
