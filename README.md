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
- **Rigid-body physics (Rapier, WebAssembly).** The world is a rigid-body simulation stepped at a fixed 240 Hz (`src/sim/world.ts`). Every object is a dynamic body with collision shapes matching its mesh, a real mass, friction and restitution (`src/sim/objectPhysics.ts`); the table, tote walls, handover mat and floor are static colliders. Nothing is positioned by animation: objects fall, bounce, roll, topple, pile up in the tote and can be knocked off the table.
  - **Gripper.** The two fingers are dynamic bodies on prismatic joints, driven as one mechanism by a position drive with a force limit (25 N per finger, 110 mm/s). They stall on whatever is between them, and a grasp holds only because pad friction resists the object's weight. There is no attach flag or grasp constraint.
  - **Contact and slip readings.** The status box shows pad forces and relative slip speed from the simulation. Carried load is estimated from mass and acceleration while the object touches only the pads. Surface support requires contact below the held body; a side collision does not count. These are simulated sensors, and rigid objects do not model softness or crushing.
  - **Placement.** Delivery includes a slow descent, confirmation of stable surface contact, release, and vertical withdrawal. The robot remembers occupied handover spaces. A failed contact check or a full mat leaves the gripper closed. Run `npm run test:placement` in `frontend` for contact-before-release, three-second drift, load, and weak-grip slip checks.
  - **Arm.** Each joint is a servo axis with UR5e velocity, acceleration and torque ratings (150 N m for base, shoulder and elbow, 28 N m for the wrists). Every step, the drive torque is worked out from the UR5e link masses, the pose, and the load the fingers are actually carrying (read from the finger contacts). It is capped at the rating: a joint that needs more gets only what the rated torque buys, and a load beyond it pulls the arm down. Paths are time-parameterised to stay inside the speed and acceleration limits. The links are collision bodies that push whatever they touch. Approach, lift, set-down and retreat are straight Cartesian lines (IK every 10 mm).
  - **Checked against theory** (`npm run test:physics`, headless, no browser): a 1 m drop lands in 0.454 s (ideal 0.452 s); a tennis ball rebounds to 0.505 m (ideal 0.518 m for e = 0.72); a block pushed at 1 m/s slides 0.101 m (ideal 0.102 m for mu = 0.5). Scripted pick / carry / set-down with perfect perception: 4 of 4 for 13 of the 14 object kinds, 3 of 4 for scissors.
  - **Measured in the real app** (headless Edge, camera in the loop): "clean the table" with eight objects (glass, tennis ball, mug, apple, pen, cube, can, notebook) grasped all eight on the first attempt and carried each to the tote. Six were still in the tote at the end; the tennis ball and the cube were knocked out by later drops into the crowded tote and ended on the floor, which the final table sweep does not look for. With the three default objects, "clean the table", "re-rack the table" and "bring me the coffee mug" run back to back all completed with every object upright where it was meant to go, and four of four separate glass pickups succeeded (grasp point within 1.4 mm of the true centre). The eight-object run was made before the glass and mug collision shapes were changed from faceted hulls to cylinders (the hulls crept across the table at 2-3 mm/s) and has not been repeated since.
  - **Cost.** The engine is a separate 1.6 MB (gzipped) chunk loaded in parallel with the scene. A step costs about 0.1 ms with 17 objects, so 240 Hz uses well under 1 ms per frame. If a device cannot keep up, the simulation runs slower than real time rather than skipping steps; the viewport shows the real-time factor. The **Colliders** button draws the collision shapes the engine is using.
  - **Not simulated:** fluids (the water in the glass is rigid), deformation (pads and objects are rigid, so softness and crushing are not modelled), and contact forces pushing back on the arm links (the links push objects but are not slowed by them).
  - **Failure scenarios** (`npm run test:scenarios`, headless). Each outcome comes out of the simulation; none is scripted:
    - Joint limits: a full-speed move peaked at 87% of rated speed and 66% of rated torque, with no saturation.
    - Falling and collisions: a dropped cube stacked on another (centre 89.8 mm up, 90 mm expected). A tennis ball bounced off a can and slid it 5.3 mm (about 4.6 mm predicted from momentum and friction).
    - Obstacle collision: sweeping the gripper through a can pushed it 197 mm.
    - Failed finger contact: closing over empty table reads a 0 mm gap and no pad contact.
    - Insufficient friction: with worn pads (friction 0.05) the glass needs 33 N per finger. At 25 N it stays down, and slip is sensed at 268 mm/s.
    - Payload beyond the grip: a 15 kg block slides out of a 25 N grip (it needs 46 N per finger).
    - Joint motor saturation: a 22 kg block held hard enough not to slip, 0.83 m from the base, drives the shoulder to its 150 N m limit (elbow 147 N m). The tool ends 19 mm below its target and the controller reports the saturation.
    - Normal payload for comparison: the 330 g mug at the same reach peaks at 47% of rated torque.
  - **Closed-loop scenarios in the real app** (headless Edge, camera in the loop, disturbances applied through the world the way a hand would):
    - "Find the red cube, pick it up, and move it to the right.": found by the camera, grasped, lifted (grip sensor: 24.9 N squeeze, 1.28 N load, 63x margin), set down after surface contact was sensed. The cube moved 158 mm to the right and stayed upright.
    - A 15 kg red cube: the pads slid off it during the lift. The robot reported "Lift failed: … too heavy or too slippery for this grip" and the cube stayed on the table.
    - Cube moved 9 cm after the camera saw it: the fingers closed on nothing (gap 0 mm), the robot looked again and picked it up on the second attempt.
    - Tennis ball pulled out of the gripper while carried to the tote: the robot sensed the gap collapse (66 mm to 0 mm), the re-check survey found the ball on the table and it was picked again. All three objects ended in the tote.
    - Occlusion: a pen behind a 110 mm glass was invisible from a low viewpoint (0 pen pixels, not detected) and detected from overhead.
  - **What is physically simulated and what is approximated:**

    | Behaviour | How | Approximation |
    |---|---|---|
    | Gravity, inertia, collisions, friction, bouncing, stacking, toppling | Rapier rigid bodies, fixed 240 Hz step | Rigid bodies only |
    | Rolling resistance (balls, fruit) | Constant deceleration of Crr x g while rolling on a surface, with spin reduced to match: tennis ball 0.035, rubber ball 0.015, orange 0.06, apple 0.08. A tennis ball nudged at 0.5 m/s stops after 0.35 m (0.36 m predicted) | Rapier contacts have no rolling loss, so it is added per step; coefficients are typical values, not measured |
    | Dragging an object with the mouse | A force-limited hand: the object keeps its real mass and is pulled toward the cursor at up to 0.4 m/s with at most 15 N, orientation held | Before this, a dragged object moved like an infinitely heavy body at 2 m/s, and flicking a glass into the tennis ball launched it 6 m |
    | Holding an object | Pad friction against a force-limited squeeze; no attachment | Pads are rigid boxes with friction 1.6 |
    | Finger contact (left / right), squeeze force | Rapier contact pairs and contact-force events on each pad | Filtered with a 70 ms time constant, like a strain gauge |
    | Carried load | Newton's second law on the pinched body, m(a - g), while only the pads touch it | Rapier does not report the friction part of a contact force, so it is derived, not measured |
    | Slip | Velocity of the object relative to the fingers, perpendicular to the jaw | Derived from body velocities |
    | Surface contact before release | Contact below the held object with a fixture or another object | |
    | Joint torque and saturation | Gravity and inertia of UR5e link masses plus the sensed payload, capped at rated torque | Links are point masses at their centres; Coriolis terms are ignored; gearbox inertia is a typical value, not a published one; the links themselves move kinematically |
    | Gripper opening | Measured from the finger bodies' positions | |
    | Camera | Rendered colour and depth from the sensor pose; occlusion and field of view are real | No lens distortion or sensor noise |

- **Motion planning.** RRT-Connect in joint space with shortcut smoothing. The arm is a capsule model checked against the table, tote, objects and itself, and the planned TCP path is drawn in the 3D view. This is the same algorithm family as MoveIt's OMPL planner, not MoveIt itself (see "MoveIt 2: where it is used" below).
- **Wrist camera and object recognition.** An eye-in-hand RGB-D camera (69° × 42°) renders the scene from the sensor pose and returns only what a real RGB-D camera would: a colour image and metric depth. Objects are found and named from those two images alone:
  1. Depth is back-projected into the world and pixels standing above the table are kept (the gripper's own view and the robot base are excluded).
  2. **OpenCV.js** cleans the mask (morphological opening), splits it into regions (connected components), splits blobs that are really several touching objects (distance transform: two cores joined by a narrow neck become two objects, e.g. balls side by side in the tote), and measures each one (contours, moments, convex hull, minimum-area rectangle, Laplacian texture, HSV colour).
  3. A **k-NN classifier trained on simulator renders** names each region from 15 features: real-world footprint and height, roundness, solidity, flat-top fraction, texture, highlights and colour. It includes a "background" class so fixtures such as the tote walls are rejected, and an "unknown" outcome for regions unlike anything it has seen.
  4. The camera names things ("red cube", "yellow tennis ball"); matching a detection to an entry in the object database is a separate step based on kind, colour and last-seen position.

  Objects out of frame or hidden by the arm are genuinely not seen, so the arm sweeps several viewpoints to look. The object-ID render pass is used **only** to label training data and to score accuracy, never by the robot at run time. This is a small classical-vision model, not a deep detector: it recognises the 14 kinds of object it was trained on, round look-alikes (orange vs apple) are its main confusion, and transparent or metallic items rely on shape rather than colour.
  - **Current model (retrained for the physics world, 300 scenes):** 86.4% of 428 held-out regions named correctly. Training scenes now include cans, glasses and mugs lying on their side, which is harder than the upright-only set the figures below were measured on. Weakest classes: orange 63%, glass 71%, rubber ball 78%. The end-to-end figures below have not been re-measured since this retrain. A straight-down look from 0.45 m locates the centre of an object to about 2 mm (measured per kind, 4 poses each).
  - **Measured:** 90.7% of 996 held-out regions named correctly (from 125 scenes never used for training; this includes partial views cut off by the image edge, which are the hardest). Using only fully visible objects the same model family reached 96.9%. Without the texture and colour cues, accuracy dropped to about 94%.
  - **Measured end to end (fresh random scenes, full pipeline including association):** 30 fresh random scenes (127 visible objects): 97.6% found, 87.6% named correctly (90.5% at the level of look-alike groups), 89.1% matched to the right entry in the object database. Fully visible objects: 90.0% named, 91.3% matched; partial views: 84.2% named, 86.0% matched. Object position error: median 7.1 mm, p90 42 mm (the large errors come from partial views). The model was trained before the tote walls were masked out of the segmentation; retraining with `npm run train:vision` should recover a few points.
  - **After adding touching-object splitting and stricter association** (40 fresh scenes, 169 detections): 96.9% found, 87.6% named, 87.6% matched, 0 false positives. Association now refuses a look-alike match from a cropped view or one that would make an object jump more than 15 cm; the robot looks again from another viewpoint instead of guessing, which costs about one point of matching on single frames.
  - **Cost:** OpenCV.js is ~11 MB (3.5 MB gzipped), loaded lazily the first time the camera is used. Recognition takes about 20 ms per frame in the browser.
  - **Retrain:** `npm run build && npx vite preview --port 4799`, then `npm run train:vision`. It renders scenes in the real app, measures held-out accuracy and rewrites `public/vision_model.json`.
  - **YOLOX second opinion (optional).** The Sensors panel has a "YOLOX (COCO) second opinion" toggle that runs the pretrained YOLOX-Tiny COCO detector (Apache-2.0, ONNX via onnxruntime-web, single-threaded WebAssembly) on the same camera frames at up to about 2 Hz and draws its boxes in amber over the RGB view. The runtime and the 20 MB model are downloaded only when the toggle is turned on (`scripts/fetch-yolox.mjs` puts the model in `public/models/` at dev/build time). It is not used for grasping. The panel keeps a running tally: frames compared, recogniser detections that fall inside a YOLOX box of a compatible COCO class, and YOLOX boxes that match no recogniser detection. Results are published on `/nora/perception/yolox_detections`.
- **Closed-loop control: the robot only knows what it senses.** The simulator holds the physical world; the robot's control code never reads it.
  - **Belief.** The camera runs continuously. Every frame updates the robot's belief about where objects are, and an object it believes is somewhere the camera can clearly see, but where the camera sees bare table, is forgotten after two frames. The Sensors tab shows this belief live. Target positions, collision obstacles, reachability and affordance are all computed from it.
  - **Physical grasps with feedback.** Before reaching, the arm looks straight down at the object and plans the pinch from what the camera measured: tool point over the centre of the outline, jaw turned across the narrow side, as low as the fingers reach without the palm touching the top. An object wider than the 85 mm jaw is refused with that reason. Then it descends, closes, and reads the finger gap. A gap of 0 mm means it closed on nothing; a gap of the wrong width means the wrong object or a bad hold. Either way it backs off, looks again and retries (up to 3 attempts). While carrying, the gap is watched: if it collapses, the object slipped out and the robot says so.
  - **Real release.** Opening the gripper lets go; gravity does the rest. The object lands on whatever is below and may bounce, roll or tip. Over the tote the fingers stay above the rim, so things are dropped the last few centimetres.
  - **Live changes.** Objects can be added or removed at any time, in any number, including while the arm is working: new ones are seen by the next sweep, removed ones are noticed when the camera looks and sees nothing.
  - **Every multi-object command is camera-driven.** Clean table, "put all the balls in the tray", "bring me both cups" and re-rack all start with a camera survey. The robot queues only what it sees in the source area (table or tote), looks at each object again before reaching, skips anything that has gone, and re-checks at the end for anything missed or newly added. Re-rack carries each object to a free table spot chosen from the belief.
  - What is *not* sensed: the robot has an object database (names, kinds, colours of everything it has been told about). The database never says where an object is or whether it is still there; a removed object stays in it, and only the camera decides it is gone. The arm also knows where it just put something it carried.
- **Clean table is driven by the camera, not by memory.** "Clean table" plans only *look, then park*. The survey queues a pick-and-place sequence for each object the camera actually saw; before reaching for each one the arm looks at it again and skips it if it has gone; and a final sweep confirms nothing is left. An empty table is discovered by looking. The storage tote is masked out of the segmentation as a known fixture, so an object resting against its wall is still seen.
- **Inspection panels (Foxglove-style).** *Sensors* (RGB, depth, segmentation, detections), *Topics* (ROS-style topic list with rates and a raw-message viewer: `/joint_states`, `/tf`, `/camera/*`, `/move_group/display_planned_path`, `/nora/*`) and *Plots* (joint trajectories). These topics are produced inside the simulator. Open the app with `?debug` to expose `window.__nora` for scripting.
- **WebAssembly is used for two things: OpenCV.js and the Rapier physics engine**, because both are distributed that way. Everything written for this project is plain TypeScript: an NLU parse takes about 0.05 ms, an approach plan with collision checks about 0.7 ms, and the OpenCV step about 20 ms per frame. The camera render is GPU work.
- **Not included: SLAM and Nav2.** The arm is table-mounted, so there is no map to build and nowhere to navigate.

## ROS 2 stack (work in progress)

ROS 2 Humble packages exist for NLU, orchestration, skills, MoveIt 2 config, ros2_control and Gazebo, plus an Isaac Sim stub. Treat them as scaffolding:

- The affordance node scores each skill against the world model (`/nora/world_model/state`) and the arm URDF: reachability is a numerical IK solve for a top-down grasp above the target, collision is the clearance of that vertical approach from taller neighbouring objects (object sizes are assumed, not sensed), and object state follows the world model's state and confidence. Usefulness is a fixed action-to-skill relevance table scaled by the NLU confidence, with no language model. A component whose input is missing scores `0.5` and says so in `breakdown_json`. This has unit tests but has not been run on a ROS machine.
- The affordance node publishes `/nora/affordance_score` (Float32) so Foxglove or `rqt_plot` can chart it. The web app publishes `/nora/task_affordance` and `/nora/affordance_score` as well when it is connected to a rosbridge.
- The ROS arm description does not yet match the web simulator's UR5e-style model, and there is no point-cloud publisher. Gazebo and Isaac Sim integration are in progress.

### Behavior-tree executor, replanning and world model

None of this has been built or run yet: it was written on a machine without ROS 2.

```
/nora/intent -> nora_orchestrator (plan) -> /nora/execute_plan -> nora_bt_executor -> /nora/skills/<skill>
                      ^   ^                                            |      |
                      |   +------ failure report + world state --------+      | pick/place results
                      +---------------- nora_world_model <--------------------+
                                             ^
                                 /nora/perception/detections
```

- **`nora_bt_executor`** (C++, BehaviorTree.CPP 4). Turns the orchestrator's skill list into a tree: a `Sequence` of steps, each skill an asynchronous `ExecuteSkill` action inside `RetryUntilSuccessful`. When the world model has objects, a pick becomes `Fallback(already held, Sequence(object known, pick))` and a place is guarded by "object is held". The tree is ticked from a timer, so nothing blocks. Status (`IDLE`, `RUNNING`, `SUCCESS`, `FAILURE`) is on `/nora/bt_executor/status`.
- **Failure report.** A failed plan returns the step index, skill, a code (`SKILL_ABORTED`, `GOAL_REJECTED`, `TIMEOUT`, `PRECONDITION`, `SERVER_UNAVAILABLE`, `INTERNAL_ERROR`, `INVALID_PLAN`, `ESTOP`, `CANCELED`), the reason, whether it is recoverable, and the world state.
- **Replanning.** For a recoverable failure the orchestrator builds a revised plan (retreat to home, pick the object again if it is no longer held, resume from the approach before the failed step) and runs it without a new command. It stops after `max_replanning_attempts` (default 3), when the same precondition fails twice, or on a critical failure.
- **Emergency stop.** Publishing `true` on `/emergency_stop` (`std_msgs/Bool`, the topic the web app's E-stop button uses) halts the tree, cancels the running skill goal and rejects new plans until `false` is published. A cancelled skill calls `MoveGroupInterface::stop()` and skips its remaining steps.
- **`nora_world_model`** (Python). Scene graph of objects with pose in `base_link`, state (`detected`, `grasped`, `moved`, `placed`, `missing`, `unknown`), `visible` flag, last-seen time and a confidence that halves every `confidence_half_life_sec` once the object is out of view. Input is `vision_msgs/Detection3DArray` on `/nora/perception/detections`, one message per camera frame, published by `nora_perception`. Objects that leave the view are kept as remembered, and become `unknown` after `stale_after_sec`. The graph is saved to `$NORA_WORLD_MODEL_PATH` (default `~/.ros/nora_world_model.json`) and reloaded on start. It publishes `/nora/world_model/state` and the TF frames `nora/objects/<id>` that the pick skill looks up.
- **`nora_perception`** (Python). Detects objects with YOLOX-Tiny trained on COCO (Apache-2.0, run with `onnxruntime`; install it with `pip install onnxruntime`, the model downloads to `~/.ros/nora/` on first start), so cups, bottles, apples, books, balls and other COCO tabletop classes are recognised by shape and appearance. Each box is located in 3D from the aligned depth image, and objects keep stable ids (`cup`, `cup_2`) between frames. Plain primitives that COCO has no class for are still found by colour: it finds the largest blob of each configured colour in the RGB image (`/camera/color/image_raw`), takes its median depth from the aligned depth image, deprojects it with the camera intrinsics and publishes the position in `base_link`. Objects are keyed by hue range in `config/perception.yaml`, so a new object needs a new entry and two objects of the same colour cannot be told apart. The Gazebo tabletop holds mesh models of the web simulator objects (mug, glass, tennis ball, apple, can, notebook, exported with `npm run export:gazebo` in `frontend/`); each has a COCO class, so no colours are configured, and `class_aliases` in the same file renames the COCO classes to those object names (`cup` to `mug`, `wine glass` to `glass`, `sports ball` to `tennis_ball`, `bottle` to `can`, `book` to `notebook`). The position is the visible surface, not the object centre. The Gazebo world has an RGB-D camera looking down at the table at 55 degrees that publishes these topics; a RealSense with aligned depth uses the same names.
- **Questions.** A command starting with "where" or "what" is answered from the world model on `/nora/response`, e.g. "cup is not currently visible. It was last seen 42 s ago at (0.40, 0.00, 0.10) in base_link (remembered, confidence 0.55)."

```bash
ros2 launch nora_bringup nora.launch.py
ros2 service call /nora/parse_command nora_interfaces/srv/ParseCommand "{raw_text: 'pick up the cup'}"
ros2 service call /nora/world_model/query nora_interfaces/srv/QueryWorld "{query: object, object_id: cup}"

# Replanning check: fail every pick attempt of the first plan, then let the revised plan run
ros2 run nora_bt_executor bt_executor_node --ros-args -p inject_failure_skill:=pick -p inject_failure_count:=3

# Unit tests of the scene graph, the replanner and the detector
colcon test --packages-select nora_world_model nora_orchestrator nora_perception
```

### MoveIt 2: where it is used

**MoveIt 2 belongs to the ROS 2 side of the project (Gazebo simulation, inspected in Foxglove). The web frontend does not use it: it has its own planner.**

- **ROS 2 / Gazebo side:** a MoveIt 2 config package (`ros2_ws/src/nora_moveit_config`: SRDF, OMPL planning, kinematics, joint limits, controllers, a `move_group` launch file) and a C++ skills package (`ros2_ws/src/nora_skills_cpp`) that calls `MoveGroupInterface` for move-to-pose, go-home and the gripper, with a mock fallback when MoveIt is not available. `move_group.launch.py` takes `use_sim_time:=true` for running against Gazebo. The Python skills only reference `MoveGroupInterface` in comments.
- **Foxglove:** Foxglove is the viewer for the ROS side. It displays the topics MoveIt and the other nodes publish (planned paths, joint states, `/nora/affordance_score`); it does not plan anything itself.
- **Current wiring:** `nora_gazebo/launch/gazebo.launch.py` starts Gazebo, the robot state publisher and the robot spawner only. `move_group` is launched separately with `ros2 launch nora_moveit_config move_group.launch.py use_sim_time:=true`. The ROS arm description still differs from the web arm.
- **Why the web frontend cannot run MoveIt itself:** MoveIt is a C++/ROS program that needs a Linux machine running ROS 2. It cannot run inside a browser tab, so a static site on Netlify can only talk to a MoveIt running somewhere else.

**What the web frontend uses instead** (all TypeScript, in the browser):

| Job | MoveIt 2 (ROS / Gazebo side) | Web frontend |
|---|---|---|
| Path planning | OMPL (RRT-Connect by default) | Own RRT-Connect with shortcut smoothing, `frontend/src/sim/planner.ts` |
| Collision checking | FCL on the robot's meshes | Capsule model of the arm against table, tote, objects and itself, `frontend/src/sim/collision.ts` |
| Inverse kinematics | KDL or similar numeric solvers | Closed-form solver for tool-down poses, checked against forward kinematics, `frontend/src/sim/kinematics.ts` |
| Straight-line moves | Cartesian path planner | IK solved every 10 mm along the line |
| Trajectory timing | Time parameterisation | Speed profile scaled to stay inside joint velocity and acceleration limits, `frontend/src/sim/world.ts` |
| Execution | ros2_control joint trajectory controller | Simulated joint servos in the physics world |

It is the same algorithm family, but a small hand-written version: tool-down poses only, simplified collision shapes, one planner, no path constraints. The topic `/move_group/display_planned_path` is produced inside the simulator, not by MoveIt.

**Plan to connect the web frontend to MoveIt (not started):**

1. Make the ROS URDF and SRDF match the web arm exactly, including the gripper (`gripper_joint` = distance between the pad faces).
2. Launch Gazebo and `move_group` together from one bringup launch file, on Linux or WSL with ROS 2 Humble.
3. Add a planning bridge to the website: when a rosbridge is connected (`ws://localhost:9090`), send each motion goal to MoveIt, receive the trajectory, and execute it on the browser's joint controllers. Publish the robot's believed obstacles to MoveIt's planning scene.
4. Keep the built-in planner as the fallback, and show in the UI which planner produced each path, so the public Netlify site still works with no ROS machine attached.

Giving every visitor of the public site a real MoveIt would need the ROS stack hosted on a server (a container plus a secure WebSocket). That is possible but is not planned.

---

Try the deployed web app: **[https://armnora.netlify.app](https://armnora.netlify.app)**
