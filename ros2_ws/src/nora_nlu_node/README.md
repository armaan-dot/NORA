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
                                        │  LocalFineTunedParser
                                        └────────┬─────────┘
                                                 │ /nora/intent  (Intent msg)
                                                 ▼
                                        Downstream nodes
```

## Model

The node loads a fine-tuned Hugging Face text-generation model at startup. Set
`model_path` to the directory containing the exported model and tokenizer.

## Building

```bash
colcon build --packages-select nora_nlu_node
source install/setup.bash
```

## Running

```bash
ros2 run nora_nlu_node nora_nlu_node \
  --ros-args -p model_path:=/path/to/model
```

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `model_path` | string | `""` | Path to local HF model directory |
| `confidence_threshold` | float | `0.5` | Log warning if confidence is below this |

## Topics & Services

| Name | Type | Direction |
|---|---|---|
| `/nora/intent` | `nora_interfaces/msg/Intent` | Publish |
| `/nora/parse_command` | `nora_interfaces/srv/ParseCommand` | Service |

## TODOs

- [ ] **TODO(nora):** Add model warm-up and GPU/device parameters.
- [ ] **TODO(nora):** Add Whisper ASR node that feeds transcribed text into this service.
- [ ] **TODO(nora):** Add `cloud_parser.py` backend for OpenAI / Gemini API-based NLU.
