#!/bin/bash
# Preflight AI: AMD MI300X vLLM Launch Script
# Run this on your AMD Developer Cloud instance to self-host the LLM.

echo "Installing vLLM with ROCm support..."
pip install vllm -U --extra-index-url https://download.pytorch.org/whl/rocm6.1

echo "Launching Llama-3-70B-Instruct on MI300X..."
# The MI300X has 192GB of VRAM, which comfortably fits the 70B model in bfloat16 without tensor parallelism.
python3 -m vllm.entrypoints.openai.api_server \
    --model meta-llama/Meta-Llama-3-70B-Instruct \
    --tensor-parallel-size 1 \
    --max-model-len 8192 \
    --host 0.0.0.0 \
    --port 8000 \
    --api-key "amd-demo-key"
