cmake_minimum_required(VERSION 3.8)
project(nora_isaac)

find_package(ament_cmake REQUIRED)

# --------------------------------------------------------------------------
# Install stub assets
# --------------------------------------------------------------------------
install(DIRECTORY
  usd/
  DESTINATION share/${PROJECT_NAME}/usd
)

install(DIRECTORY
  config/
  DESTINATION share/${PROJECT_NAME}/config
)

install(PROGRAMS
  scripts/isaac_bridge_stub.py
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
