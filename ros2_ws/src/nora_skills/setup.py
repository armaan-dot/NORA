from setuptools import find_packages, setup
import os
from glob import glob

PACKAGE_NAME = "nora_skills"

setup(
    name=PACKAGE_NAME,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{PACKAGE_NAME}"]),
        (f"share/{PACKAGE_NAME}", ["package.xml"]),
        (f"share/{PACKAGE_NAME}/config", glob("config/*.yaml")),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="NORA Team",
    maintainer_email="nora@example.com",
    description="Primitive skill action servers for NORA.",
    license="Apache-2.0",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "nora_move_to_pose = nora_skills.skills.move_to_pose:main",
            "nora_pick         = nora_skills.skills.pick:main",
            "nora_place        = nora_skills.skills.place:main",
            "nora_open_gripper = nora_skills.skills.open_gripper:main",
            "nora_close_gripper = nora_skills.skills.close_gripper:main",
            "nora_go_home      = nora_skills.skills.go_home:main",
        ],
    },
)
