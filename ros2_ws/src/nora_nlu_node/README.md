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
| `ollama` | `OllamaParser` | Local Ollama model with schema-constrained intent output |

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

# Ollama backend (after: ollama pull qwen2.5:1.5b)
ros2 run nora_nlu_node nora_nlu_node \
  --ros-args -p backend:=ollama -p ollama_model:=qwen2.5:1.5b
```

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `backend` | string | `mock` | NLU backend: `mock`, `local`, or `ollama` |
| `model_path` | string | `""` | Path to local HF model dir (local backend) |
| `ollama_model` | string | `qwen2.5:1.5b` | Local Ollama model name |
| `ollama_host` | string | `http://localhost:11434` | Ollama server URL |
| `ollama_timeout_seconds` | float | `30.0` | Maximum local inference time |
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
