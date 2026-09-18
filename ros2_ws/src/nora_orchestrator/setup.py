from setuptools import find_packages, setup
from glob import glob

PACKAGE_NAME = "nora_orchestrator"

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
    description="High-level task orchestrator for NORA.",
    license="Apache-2.0",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "nora_orchestrator = nora_orchestrator.orchestrator_node:main",
        ],
    },
)
