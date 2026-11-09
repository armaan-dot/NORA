# NORA: Natural Language Orchestrated Robotics Agent

> **SayCan-inspired 6-DOF robotic manipulator driven by natural language and affordance scoring.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-armnora.netlify.app-00f0ff?style=flat-square&logo=netlify)](https://armnora.netlify.app)
[![ROS 2 Humble](https://img.shields.io/badge/ROS%202-Humble-blue?style=flat-square&logo=ros)](https://docs.ros.org/en/humble/)
[![UR5e Compatible](https://img.shields.io/badge/Hardware-UR5e%20%7C%206--DOF-orange?style=flat-square)](https://www.universal-robots.com/)
[![Foxglove Studio](https://img.shields.io/badge/Telemetry-Foxglove%20Studio-purple?style=flat-square)](https://foxglove.dev/)
[![Simulation](https://img.shields.io/badge/Simulation-Gazebo%20%7C%20NVIDIA%20Isaac%20(Under%20Process)-yellow?style=flat-square)](https://developer.nvidia.com/isaac-sim)

🔗 **Live Interactive Demo:** [https://armnora.netlify.app](https://armnora.netlify.app)

---

## What is NORA?

NORA translates everyday spoken English into physically verified robotic skills for tabletop arms and industrial manipulators like the **Universal Robots UR5e**:

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
- **Object Grounding Guardrail**: If an item is missing from the table, motion is interlocked ($V < 0.30$) and prompts 1-click placement. "Missing" means the wrist camera swept the table and did not see it.
- **Kinematic Reachability Limit**: Blocks targets the UR5e-style arm cannot reach. Checked by running IK and then forward kinematics and comparing; about 0.92 m from the base for a top-down grasp at table height.
- **Collision Approach Check**: Plans home → pre-grasp → grasp with a collision-aware planner. A target wedged against another object, with no room for the gripper, scores near zero.
- **Physical Action Filter**: Blocks impossible human bodily requests (e.g., `dance`, `fly`, `jump`).
- **Safety Interlock**: Immediate rejection of explicit or dangerous language.

---

## Language Model (NLU)

A small statistical model: TF-IDF unigram + bigram features, a Naive Bayes action classifier, plus commonsense and slot rules. It lives in [`ml/`](ml/README.md) and is trained by `python ml/train.py`.

- **One model, two runtimes.** The ROS NLU node runs it in Python. The web app runs a TypeScript port of the same inference code against the same weights ([`frontend/src/services/nluModel.ts`](frontend/src/services/nluModel.ts)). `npm run dev` and `npm run build` regenerate the browser copy from `ml/`.
- **540 known objects**, 4,914 learned features, about 0.05 ms per parse in the browser, 210 KB gzipped.
- **What is measured.** The built-in cases in `ml/evaluate.py` pass 15/16 with the TypeScript port, and the 32-example seed set gets 31/32 on action. `python ml/train.py` also prints a validation accuracy, but that is a held-out split of the same synthetic generator: it shows fit to the generator, not accuracy on real speech. There is no real-world benchmark yet.
- Simulator controls (clean table, scatter, delete, loops) are handled by explicit rules in the web app, not by the model.

---

## Web Simulator (digital twin)

Open the live demo, or run it locally:

```bash
cd frontend && npm install && npm run dev
```

Everything below runs in the browser (Three.js) with no ROS needed:

- **Arm and scene.** UR5e-style 6-DOF arm (UR5e link lengths and joint layout, parallel-jaw gripper) on a bench with a tote and a handover mat. The table starts with a water glass, a tennis ball and a coffee mug; add or remove as many objects as you like.
- **Kinematics.** Closed-form top-down IK, checked against forward kinematics built from the URDF.
- **Motion planning.** RRT-Connect in joint space with shortcut smoothing. The arm is a capsule model checked against the table, tote, objects and itself, and the planned TCP path is drawn in the 3D view. This is the same algorithm family as MoveIt's OMPL planner, not MoveIt itself.
- **Wrist camera and object recognition.** An eye-in-hand RGB-D camera (69° × 42°) renders the scene from the sensor pose and returns only what a real RGB-D camera would: a colour image and metric depth. Objects are found and named from those two images alone:
  1. Depth is back-projected into the world and pixels standing above the table are kept (the gripper's own view and the robot base are excluded).
  2. **OpenCV.js** cleans the mask (morphological opening), splits it into regions (connected components), splits blobs that are really several touching objects (distance transform: two cores joined by a narrow neck become two objects, e.g. balls side by side in the tote), and measures each one (contours, moments, convex hull, minimum-area rectangle, Laplacian texture, HSV colour).
  3. A **k-NN classifier trained on simulator renders** names each region from 15 features: real-world footprint and height, roundness, solidity, flat-top fraction, texture, highlights and colour. It includes a "background" class so fixtures such as the tote walls are rejected, and an "unknown" outcome for regions unlike anything it has seen.
  4. The camera names things ("red cube", "yellow tennis ball"); matching a detection to an entry in the object database is a separate step based on kind, colour and last-seen position.

  Objects out of frame or hidden by the arm are genuinely not seen, so the arm sweeps several viewpoints to look. The object-ID render pass is used **only** to label training data and to score accuracy, never by the robot at run time. This is a small classical-vision model, not a deep detector: it recognises the 14 kinds of object it was trained on, round look-alikes (orange vs apple) are its main confusion, and transparent or metallic items rely on shape rather than colour.
  - **Measured:** 90.7% of 996 held-out regions named correctly (from 125 scenes never used for training; this includes partial views cut off by the image edge, which are the hardest). Using only fully visible objects the same model family reached 96.9%. Without the texture and colour cues, accuracy dropped to about 94%.
  - **Measured end to end (fresh random scenes, full pipeline including association):** 30 fresh random scenes (127 visible objects): 97.6% found, 87.6% named correctly (90.5% at the level of look-alike groups), 89.1% matched to the right entry in the object database. Fully visible objects: 90.0% named, 91.3% matched; partial views: 84.2% named, 86.0% matched. Object position error: median 7.1 mm, p90 42 mm (the large errors come from partial views). The model was trained before the tote walls were masked out of the segmentation; retraining with `npm run train:vision` should recover a few points.
  - **After adding touching-object splitting and stricter association** (40 fresh scenes, 169 detections): 96.9% found, 87.6% named, 87.6% matched, 0 false positives. Association now refuses a look-alike match from a cropped view or one that would make an object jump more than 15 cm; the robot looks again from another viewpoint instead of guessing, which costs about one point of matching on single frames.
  - **Cost:** OpenCV.js is ~11 MB (3.5 MB gzipped), loaded lazily the first time the camera is used. Recognition takes about 20 ms per frame in the browser.
  - **Retrain:** `npm run build && npx vite preview --port 4799`, then `npm run train:vision`. It renders scenes in the real app, measures held-out accuracy and rewrites `public/vision_model.json`.
- **Closed-loop control: the robot only knows what it senses.** The simulator holds the physical world; the robot's control code never reads it.
  - **Belief.** The camera runs continuously. Every frame updates the robot's belief about where objects are, and an object it believes is somewhere the camera can clearly see, but where the camera sees bare table, is forgotten after two frames. The Sensors tab shows this belief live. Target positions, collision obstacles, reachability and affordance are all computed from it.
  - **Physical grasps with feedback.** Closing the gripper is a physical act: the world checks the tool position and finger opening against the real objects. The robot only gets the finger stroke back. A stroke of 0 mm means it closed on nothing; a stroke of the wrong width means it grabbed the wrong object. Either way it looks again and retries (up to 3 attempts). With a deliberate 5 cm perception error, the first grasp missed, the robot re-looked, and the second succeeded.
  - **Real release.** Opening the gripper drops the object to the surface below (table, handover mat or tote), or on top of whatever is already there. Objects are not moved by flags.
  - **Live changes.** Objects can be added or removed at any time, in any number, including while the arm is working: new ones are seen by the next sweep, removed ones are noticed when the camera looks and sees nothing.
  - **Every multi-object command is camera-driven.** Clean table, "put all the balls in the tray", "bring me both cups" and re-rack all start with a camera survey. The robot queues only what it sees in the source area (table or tote), looks at each object again before reaching, skips anything that has gone, and re-checks at the end for anything missed or newly added. Re-rack carries each object to a free table spot chosen from the belief.
  - What is *not* sensed: the robot has an object database (names, kinds, colours of everything it has been told about). The database never says where an object is or whether it is still there; a removed object stays in it, and only the camera decides it is gone. The arm also knows where it just put something it carried.
- **Clean table is driven by the camera, not by memory.** "Clean table" plans only *look, then park*. The survey queues a pick-and-place sequence for each object the camera actually saw; before reaching for each one the arm looks at it again and skips it if it has gone; and a final sweep confirms nothing is left. An empty table is discovered by looking. The storage tote is masked out of the segmentation as a known fixture, so an object resting against its wall is still seen.
- **Inspection panels (Foxglove-style).** *Sensors* (RGB, depth, segmentation, detections), *Topics* (ROS-style topic list with rates and a raw-message viewer: `/joint_states`, `/tf`, `/camera/*`, `/move_group/display_planned_path`, `/nora/*`) and *Plots* (joint trajectories). These topics are produced inside the simulator. Open the app with `?debug` to expose `window.__nora` for scripting.
- **WebAssembly is used for exactly one thing: OpenCV.js**, and only because OpenCV is distributed that way. Everything written for this project is plain TypeScript, which is fast enough: an NLU parse takes about 0.05 ms, an approach plan with collision checks about 0.7 ms, and the OpenCV step about 20 ms per frame. The camera render is GPU work. WebAssembly would also make sense for a physics engine or a neural detector.
- **Not included: SLAM and Nav2.** The arm is table-mounted, so there is no map to build and nowhere to navigate.

## ROS 2 stack (work in progress)

ROS 2 Humble packages exist for NLU, orchestration, skills, MoveIt 2 config, ros2_control and Gazebo, plus an Isaac Sim stub. Treat them as scaffolding:

- The affordance node's scorers are placeholders: collision `0.85`, reachability `0.9`, object state `0.95`, and a mocked usefulness scorer. The real kinematic and collision checks currently live in the web simulator, not in ROS.
- The affordance node publishes `/nora/affordance_score` (Float32) so Foxglove or `rqt_plot` can chart it. The web app publishes `/nora/task_affordance` and `/nora/affordance_score` as well when it is connected to a rosbridge.
- The ROS arm description does not yet match the web simulator's UR5e-style model, and there is no point-cloud publisher. Gazebo and Isaac Sim integration are in progress.

---

Try the deployed web app: **[https://armnora.netlify.app](https://armnora.netlify.app)**
