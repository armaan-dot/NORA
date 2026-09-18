cmake_minimum_required(VERSION 3.8)
project(nora_moveit_config)

find_package(ament_cmake REQUIRED)

# Install configuration and launch directories so downstream nodes can find them.
install(DIRECTORY config/
  DESTINATION share/${PROJECT_NAME}/config
)

install(DIRECTORY launch/
  DESTINATION share/${PROJECT_NAME}/launch
)

ament_package()
