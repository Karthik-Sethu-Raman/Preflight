Here is the full codebase for Preflight AI, a cloud infrastructure risk engine built for a hackathon ending July 11.

PROJECT SUMMARY:
Users upload a Terraform .tf file. The backend runs terraform plan, parses the JSON output into a NetworkX directed graph, simulates cascading failures using BFS from any node, and fires 3 concurrent AI agents (Reliability, Security, Cost) via the Fireworks AI API (Qwen 2.5 7B). The frontend visualizes the graph and animates BFS failure propagation.

TECH STACK:
- Backend: Python, FastAPI, NetworkX, asyncio, python-hcl2, httpx, openai SDK
- Frontend: React + Vite, react-force-graph-2d
- AI: Fireworks AI API (OpenAI-compatible), Qwen2.5-7B-Instruct
- Deployment: Docker + docker-compose

FILES:
[paste each file content here]

CURRENT STATE:
- engine.py: WORKING. Parses plan.json + main.tf, builds NetworkX graph, 24 nodes 35 edges confirmed.
- blast_radius.py: WRITTEN, untested via API
- agents.py: WRITTEN, currently points to Groq — needs switching to Fireworks
- main.py: WRITTEN, untested
- Frontend: Vite project exists, crashes on npm run dev, no components written yet
- plan.json + main.tf: Sample AWS infrastructure files exist and parse correctly

DO NOT change engine.py. It works.
Ask me before deleting or rewriting any existing file completely.

IAM THE FRONTEND ENGINEER