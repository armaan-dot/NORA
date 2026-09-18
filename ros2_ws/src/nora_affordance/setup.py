from setuptools import find_packages, setup
from glob import glob

package_name = "nora_affordance"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml"]),
        (f"share/{package_name}/config", glob("config/*.yaml")),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="NORA Team",
    maintainer_email="nora@example.com",
    description="SayCan-inspired affordance scoring pipeline.",
    license="Apache-2.0",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "nora_affordance_node = nora_affordance.affordance_node:main",
        ],
    },
)
