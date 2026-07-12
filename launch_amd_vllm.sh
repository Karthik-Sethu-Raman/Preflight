#!/bin/bash
# Preflight AI: AMD MI300X vLLM Launch Script
# Run this on your AMD Developer Cloud instance to self-host the LLM.

echo "Launching Llama-3-70B-Instruct on MI300X via Docker..."

# The MI300X has 192GB of VRAM, which comfortably fits the 70B model in bfloat16 without tensor parallelism.
docker run -d --rm \
  --device=/dev/kfd --device=/dev/dri \
  -p 8001:8000 \
  --ipc=host \
  -e HUGGING_FACE_HUB_TOKEN="YOUR_HF_TOKEN_HERE" \
  vllm/vllm-openai-rocm:v0.23.0 \
  --model meta-llama/Meta-Llama-3-70B-Instruct \
  --tensor-parallel-size 1 \
  --max-model-len 8192 \
  --host 0.0.0.0 \
  --port 8000 \
  --api-key "amd-demo-key"
  
echo "Llama-3-70B is now booting up in the background!"
echo "Run 'docker logs -f <container_id>' to watch the startup progress."
