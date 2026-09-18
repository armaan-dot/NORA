# =============================================================================
# NORA – Makefile
# Usage: make <target>
# =============================================================================

.PHONY: help lint format test-core test-ml test build-ros test-ros check demo-mock clean

# Source directories checked by static analysis tools
SRC_DIRS := core/ ml/

# ROS 2 workspace directory
ROS_WS := ros2_ws

# ROS 2 setup script
ROS_SETUP := /opt/ros/humble/setup.bash

# ---------------------------------------------------------------------------
# help – print available targets
# ---------------------------------------------------------------------------
help:
	@echo ""
	@echo "NORA – available make targets"
	@echo "────────────────────────────────────────────────"
	@echo "  help        Print this help message"
	@echo "  lint        Run ruff check + black --check + mypy"
	@echo "  format      Auto-fix with ruff --fix + black"
	@echo "  test-core   Run pytest on core/tests/"
	@echo "  test-ml     Run pytest on ml/tests/"
	@echo "  test        Run test-core and test-ml"
	@echo "  build-ros   colcon build inside $(ROS_WS)/"
	@echo "  test-ros    colcon test inside $(ROS_WS)/"
	@echo "  check       lint + test + build-ros + test-ros"
	@echo "  demo-mock   Run mock demo via scripts/run_demo.sh"
	@echo "  clean       Remove build artefacts and caches"
	@echo "────────────────────────────────────────────────"
	@echo ""

# ---------------------------------------------------------------------------
# lint – static analysis (read-only, CI-safe)
# ---------------------------------------------------------------------------
lint:
	ruff check $(SRC_DIRS)
	black --check $(SRC_DIRS)
	mypy $(SRC_DIRS)

# ---------------------------------------------------------------------------
# format – auto-fix formatting issues
# ---------------------------------------------------------------------------
format:
	ruff check --fix $(SRC_DIRS)
	black $(SRC_DIRS)

# ---------------------------------------------------------------------------
# test-core – unit/integration tests for the core package
# ---------------------------------------------------------------------------
test-core:
	pytest core/tests/ -v

# ---------------------------------------------------------------------------
# test-ml – unit/integration tests for the ml package
# ---------------------------------------------------------------------------
test-ml:
	pytest ml/tests/ -v

# ---------------------------------------------------------------------------
# test – run all Python tests
# ---------------------------------------------------------------------------
test: test-core test-ml

# ---------------------------------------------------------------------------
# build-ros – build the ROS 2 workspace with colcon
# ---------------------------------------------------------------------------
build-ros:
	bash -c "source $(ROS_SETUP) && cd $(ROS_WS) && colcon build \
		--symlink-install \
		--cmake-args -DCMAKE_BUILD_TYPE=Release"

# ---------------------------------------------------------------------------
# test-ros – run ROS 2 colcon tests
# ---------------------------------------------------------------------------
test-ros:
	bash -c "source $(ROS_SETUP) && cd $(ROS_WS) && colcon test"

# ---------------------------------------------------------------------------
# check – full CI gate (lint → test → build-ros → test-ros)
# ---------------------------------------------------------------------------
check: lint test build-ros test-ros

# ---------------------------------------------------------------------------
# demo-mock – run the mock demonstration script
# ---------------------------------------------------------------------------
demo-mock:
	bash scripts/run_demo.sh --mock

# ---------------------------------------------------------------------------
# clean – remove all generated build artefacts and caches
# ---------------------------------------------------------------------------
clean:
	rm -rf build/ install/ log/
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type d -name ".ruff_cache"  -exec rm -rf {} +
