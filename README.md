# NORA
NORA - Natural Language Orchestrated Robotic Agent

# NORA — Natural-Language Orchestrated Robotic Agent

> An embodied AI system that allows robots to understand natural human language, plan multi-step tasks, interact with their environment, and autonomously execute those tasks through ROS 2.

## Overview

NORA is an AI-powered robotics framework designed to bridge the gap between **human language and physical robot actions**.

Instead of requiring users to provide low-level commands such as:

```text
navigate_to(2.4, 1.8)
```

the user can give the robot a natural instruction:

> **"Get me the cup of water."**

NORA interprets the instruction, determines the required sequence of actions, uses perception to understand the environment, and executes the resulting plan through ROS 2.

The long-term goal is to create a general-purpose **language-to-action interface for autonomous robots**.

---

## Example

### User

```text
Get me the cup of water.
```

### NORA

```text
1. Locate the cup
2. Locate the water source
3. Navigate to the cup
4. Grasp the cup
5. Navigate to the water source
6. Fill the cup
7. Navigate back to the user
8. Hand the cup to the user
```

### Execution

```text
Natural Language
       ↓
      LLM
       ↓
Task Decomposition
       ↓
Action Planner
       ↓
Perception ────────┐
Navigation ────────┤
Manipulation ──────┤
       ↓            │
      ROS 2 ◄───────┘
       ↓
     Robot
```

---

## Key Features

### Natural Language Understanding

NORA accepts unrestricted, human-style instructions rather than predefined robot commands.

Examples:

```text
"Bring me the red cup."

"Can you get me some water?"

"I'm thirsty. Get me a glass of water."

"Take the box from the table and put it near the door."
```

The system converts these instructions into structured robot tasks.

### Task Decomposition

Complex instructions are broken into smaller executable actions.

```text
High-Level Goal
      ↓
Task Planner
      ↓
Subtasks
      ↓
ROS 2 Actions
```

### Environmental Grounding

The robot does not simply assume that objects exist.

NORA can query perception systems to determine:

* What objects are present
* Where objects are located
* Where the robot is
* Where the user is
* Whether an action succeeded

### Closed-Loop Execution

NORA continuously monitors execution and can re-plan when something goes wrong.

```text
Plan
 ↓
Execute
 ↓
Observe
 ↓
Success?
 ├── Yes → Continue
 └── No  → Re-plan
```

For example:

```text
Attempt to grasp cup
        ↓
Grasp failed
        ↓
Perception detects failure
        ↓
Planner generates new approach
        ↓
Retry
```

### Memory

The system can maintain useful information about the environment and previous interactions.

Examples:

```text
"The cups are usually in the kitchen."

"The water dispenser is beside the refrigerator."

"The user prefers the blue cup."
```

### Safety Layer

The LLM does not directly control motors.

All generated actions pass through a validation and safety layer before reaching the robot.

```text
LLM
 ↓
Structured Action
 ↓
Validation / Safety
 ↓
ROS 2
 ↓
Robot
```

---

# System Architecture

```text
                    ┌──────────────┐
                    │    USER      │
                    └──────┬───────┘
                           │
                    Natural Language
                           │
                           ▼
                 ┌──────────────────┐
                 │   Language Model │
                 │                  │
                 │ Intent           │
                 │ Reasoning        │
                 │ Planning         │
                 └────────┬─────────┘
                          │
                    Task Plan
                          │
                          ▼
                 ┌──────────────────┐
                 │  Action Planner  │
                 └────────┬─────────┘
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
   ┌────────────┐  ┌────────────┐  ┌──────────────┐
   │ Perception │  │ Navigation │  │ Manipulation │
   │            │  │            │  │              │
   │ Vision/VLM │  │   Nav2     │  │   MoveIt 2   │
   └─────┬──────┘  └─────┬──────┘  └──────┬───────┘
         │               │                │
         └───────────────┼────────────────┘
                         ▼
                    ┌─────────┐
                    │  ROS 2  │
                    └────┬────┘
                         │
                         ▼
                       Robot
```

---

# Technology Stack

## AI

* Python
* PyTorch
* Hugging Face Transformers
* Open-source LLM
* LoRA / QLoRA
* Vision-Language Models

## Robotics

* ROS 2
* Nav2
* MoveIt 2
* TF2
* ROS 2 Actions
* ROS 2 Services
* ROS 2 Topics

## Simulation

* Gazebo
* Isaac Sim
* RViz
* Foxglove

## Hardware

The system is initially designed to operate in simulation but can eventually be deployed to a physical mobile manipulator or humanoid robot.

---

# Project Roadmap

## Phase 1 — Language → Structured Actions

Build the basic language interface.

```text
"Move forward two meters"
            ↓
{
  "action": "move",
  "distance": 2.0
}
```

Support basic actions such as:

* Move
* Rotate
* Stop
* Navigate
* Pick
* Place

---

## Phase 2 — ROS 2 Integration

Connect structured actions to ROS 2.

```text
LLM
 ↓
JSON Action
 ↓
ROS 2 Node
 ↓
/cmd_vel
/Nav2
/MoveIt
```

---

## Phase 3 — Task Planning

Allow the model to decompose complex instructions.

```text
"Take the red box to the table."

        ↓

Find red box
        ↓
Navigate to box
        ↓
Grasp box
        ↓
Navigate to table
        ↓
Place box
```

---

## Phase 4 — Perception

Integrate computer vision and object detection.

```text
Camera
  ↓
Vision Model
  ↓
Object Detection
  ↓
World State
  ↓
LLM Planner
```

The planner can now reason about the actual environment.

---

## Phase 5 — Closed-Loop Autonomy

Introduce feedback and recovery.

```text
Plan
 ↓
Execute
 ↓
Observe
 ↓
Evaluate
 ↓
Re-plan if necessary
```

---

## Phase 6 — Custom Robot Language Model

Fine-tune an open-source model using a custom dataset containing:

```text
Natural Language
        ↓
Intent
        ↓
Task Plan
        ↓
Structured Robot Actions
```

Example:

```json
{
  "instruction": "Bring me the red cup",
  "plan": [
    "find_object(red_cup)",
    "navigate_to(red_cup)",
    "grasp(red_cup)",
    "navigate_to(user)",
    "hand_over(red_cup)"
  ]
}
```

---

# Research Questions

The project will investigate:

* How effectively can an LLM convert natural language into executable robot plans?
* How well does a specialized model perform compared with a general-purpose LLM?
* How can ambiguous instructions be resolved?
* How can language models use real-time environmental information?
* How should failed actions be detected and recovered from?
* How can LLM-generated actions be safely validated before execution?
* How much can model size be reduced while maintaining reliable robot control?

---

# Evaluation

The system will be evaluated using:

### Language Understanding

* Intent accuracy
* Parameter extraction accuracy
* Ambiguity detection

### Planning

* Task decomposition accuracy
* Valid action sequences
* Number of unnecessary actions

### Robotics

* Task completion rate
* Navigation success
* Manipulation success
* Recovery success

### AI Performance

* Inference latency
* Model size
* GPU/CPU requirements
* Fine-tuned vs. base-model performance

---

# Repository Structure

```text
NORA/
│
├── llm/
│   ├── models/
│   ├── prompts/
│   ├── training/
│   └── inference/
│
├── planner/
│   ├── task_planner/
│   ├── action_validator/
│   └── memory/
│
├── perception/
│   ├── object_detection/
│   └── vision/
│
├── ros2/
│   ├── nodes/
│   ├── actions/
│   ├── services/
│   └── interfaces/
│
├── simulation/
│   ├── gazebo/
│   └── isaac_sim/
│
├── datasets/
│
├── experiments/
│
├── tests/
│
└── README.md
```

---

# Long-Term Vision

The ultimate goal of NORA is to move from:

```text
Human
  ↓
Predefined Commands
  ↓
Robot
```

to:

```text
Human
  ↓
Natural Language
  ↓
AI Reasoning
  ↓
World Understanding
  ↓
Task Planning
  ↓
ROS 2
  ↓
Autonomous Robot
```

NORA aims to provide a general interface through which humans can communicate with robots **the same way they communicate with other people**.
