# nora_nlu_node

ROS 2 node that converts natural-language text commands into structured **Intent** messages for the NORA robotic arm pipeline.

## Architecture

```
Voice / Text Input
       │
       ▼
 ┌─────────────┐    ParseCommand srv    ┌──────────────────┐
 │  NLU Client │ ──────────────────────▶│   NLUNode        │
 └─────────────┘                        │                  │
                                        │  IntentParser ◀──┤ backend param
                                        │  (mock | local)  │
                                        └────────┬─────────┘
                                                 │ /nora/intent  (Intent msg)
                                                 ▼
                                        Downstream nodes
```

## Backends

| Backend | Class | When to use |
|---|---|---|
| `mock` | `MockRuleBasedParser` | Simulation, unit tests, demos — no ML required |
| `local` | `LocalFineTunedParser` | On-robot inference with a fine-tuned HuggingFace model |

## Building

```bash
colcon build --packages-select nora_nlu_node
source install/setup.bash
```

## Running

```bash
# Mock backend (default)
ros2 run nora_nlu_node nora_nlu_node \
  --ros-args --params-file config/nlu.yaml

# Local model backend
ros2 run nora_nlu_node nora_nlu_node \
  --ros-args -p backend:=local -p model_path:=/path/to/model
```

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `backend` | string | `mock` | NLU backend: `mock` or `local` |
| `model_path` | string | `""` | Path to local HF model dir (local backend) |
| `confidence_threshold` | float | `0.5` | Log warning if confidence is below this |

## Topics & Services

| Name | Type | Direction |
|---|---|---|
| `/nora/intent` | `nora_interfaces/msg/Intent` | Publish |
| `/nora/parse_command` | `nora_interfaces/srv/ParseCommand` | Service |

## Running Tests

```bash
pytest src/nora_nlu_node/test/ -v
```

## TODOs

- [ ] **TODO(nora):** Replace `std_msgs/String` publisher with `nora_interfaces/msg/Intent` once the interface package is ready.
- [ ] **TODO(nora):** Replace `std_srvs/Trigger` service with `nora_interfaces/srv/ParseCommand`.
- [ ] **TODO(nora):** Implement `LocalFineTunedParser._label_to_action()` label map once model training is complete.
- [ ] **TODO(nora):** Add Whisper ASR node that feeds transcribed text into this service.
- [ ] **TODO(nora):** Add `cloud_parser.py` backend for OpenAI / Gemini API-based NLU.
