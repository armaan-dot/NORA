# NORA: Natural Language Orchestrated Robotics Agent
NORA translates everyday spoken English into physically verified robotic skills for tabletop arms and industrial manipulators like the Universal Robots UR5e:

> **SayCan-inspired 6-DOF robotic manipulator driven by natural language and affordance scoring.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-armnora.netlify.app-00f0ff?style=flat-square&logo=netlify)](https://armnora.netlify.app)
[![ROS 2 Humble](https://img.shields.io/badge/ROS%202-Humble-blue?style=flat-square&logo=ros)](https://docs.ros.org/en/humble/)
[![UR5e Compatible](https://img.shields.io/badge/Hardware-UR5e%20%7C%206--DOF-orange?style=flat-square)](https://www.universal-robots.com/)
[![Foxglove Studio](https://img.shields.io/badge/Telemetry-Foxglove%20Studio-purple?style=flat-square)](https://foxglove.dev/)
[![Simulation](https://img.shields.io/badge/Simulation-Gazebo%20%7C%20NVIDIA%20Isaac%20(Under%20Process)-yellow?style=flat-square)](https://developer.nvidia.com/isaac-sim)

🔗 **Live Interactive Demo:** [https://armnora.netlify.app](https://armnora.netlify.app)

---

```text
User: "I am thirsty"
NORA: Resolves intent → Hydration need identified (Water Glass)
      Checks SayCan feasibility → Active vision camera sweep detects glass on table
      Plans trajectory → [search_object → move_to_pose → pick → deliver_to_user]
      Result: Grasps the glass and delivers/pours water for the user.
```

---

## SayCan Affordances & Safety Guardrails

Every skill candidate is evaluated against language usefulness and real-world physical feasibility before motion begins:

$$\text{Combined Score} = (\text{Usefulness})^{0.6} \times (\text{Feasibility})^{0.4}$$

- **Usefulness**: Semantic alignment between the user's intent and candidate skill.
- **Feasibility**: Closed-form IK reachability, collision checking, and tabletop object state.

### Guardrail Blocks (Threshold: 0.300)
- **Object Grounding Guardrail**: If an item is missing from the table, motion is interlocked ($V < 0.30$) and prompts 1-click placement.
- **Kinematic Reachability Limit**: Blocks targets beyond the physical manipulation envelope ($>0.64\text{m}$).
- **Physical Action Filter**: Blocks impossible human bodily requests (e.g., `dance`, `fly`, `jump`).
- **Safety Interlock**: Immediate rejection of explicit or dangerous language.

---

## ML Dataset & Training Numbers

- **15,000+ Training Samples**: Synthetic and real-world commands for hydration, hunger, play, stationery, and tabletop manipulation.
- **540+ Known Objects**: Drinks, foods, stationery (pens, rulers, notebooks), tools, games, and geometry primitives.
- **99.77% Validation Accuracy**: Fast statistical intent parser with $<1\text{ms}$ inference latency.

---

## Digital Twin, UR5e & Foxglove Studio

- **Universal Robots UR5e & Tabletop Arm**: ROS 2 Humble control via MoveIt 2 and `joint_trajectory_controller`.
- **Foxglove Studio Telemetry**: Live streaming of `/joint_states`, `/nora/affordance_score`, RGB-D camera pointclouds, and reticle scans.
- **Interactive 3D Web Twin**: Three.js WebGL simulation featuring closed-form IK, collision avoidance, and draggable tabletop objects.
- **Gazebo & NVIDIA Isaac Sim**: High-fidelity physics simulations, digital twin environments, and sensor pipelines are currently under process.

---


Try the deployed web app: **[https://armnora.netlify.app](https://armnora.netlify.app)**
