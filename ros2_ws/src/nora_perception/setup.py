from setuptools import find_packages, setup
from glob import glob

PACKAGE_NAME = "nora_perception"

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
    description="Perception node for NORA (mock + real).",
    license="Apache-2.0",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "nora_perception = nora_perception.perception_node:main",
        ],
    },
)
