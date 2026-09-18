from setuptools import find_packages, setup
import os
from glob import glob

package_name = "nora_nlu_node"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml"]),
        # Install config files
        (f"share/{package_name}/config", glob("config/*.yaml")),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="NORA Team",
    maintainer_email="nora@example.com",
    description="NLU node — converts text commands into structured Intent messages.",
    license="Apache-2.0",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "nora_nlu_node = nora_nlu_node.nlu_node:main",
        ],
    },
)
