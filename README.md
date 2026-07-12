# 🚀 Preflight AI

**A Dual-Model, AI-Powered Infrastructure Risk & Chaos Engine.**

Preflight AI analyzes your Terraform deployments to identify critical failure impacts before they happen. It parses infrastructure as code into a mathematical graph, simulates cascading failures using BFS, and leverages a dual-model AI architecture to assess reliability, security, and cost risks.

![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Terraform](https://img.shields.io/badge/terraform-%235835CC.svg?style=for-the-badge&logo=terraform&logoColor=white)

## ✨ Core Features

*   **Topology Graph Generation:** Instantly parse `.tf` files into mathematical Directed Acyclic Graphs (DAGs) to visualize your exact architecture.
*   **Dual-Model AI Engine:** Uses **Fireworks AI (DeepSeek-V4-Pro)** for logic synthesis and a self-hosted **Llama-3-70B** on an **AMD MI300x Developer Cloud** GPU for high-volume Chaos Engineering Monte Carlo simulations.
*   **Blast Radius Analysis:** Click any node to simulate an outage and instantly see upstream/downstream cascading failures.
*   **Automated PR Code Review:** Prevent bad infrastructure from being merged by adding the Preflight GitHub Action directly to your CI/CD pipeline!

## 📚 Documentation

Detailed documentation on how the system works and how to set it up:

*   [**Architecture & Dual-Model AI**](docs/architecture.md) - Learn how we route workloads between Fireworks and the AMD Developer Cloud.
*   [**Deployment Guide**](docs/deployment.md) - Instructions for deploying the EC2 backend, AMD droplet, and Vercel frontend.
*   [**GitHub Actions Integration**](docs/github_actions.md) - How to add Preflight AI to your own repositories to automate PR reviews.

## 🛠️ Quick Start (Local Development)

1. Clone this repository.
2. Create a `.env` file in the project root:
   ```env
   FIREWORKS_API_KEY=your_key_here
   LLM_API_BASE=http://your-amd-droplet:8001/v1
   LLM_API_KEY=amd-demo-key
   LLM_MODEL_NAME=meta-llama/Meta-Llama-3-70B-Instruct
   ```
3. Start the backend: `cd backend && pip install -r requirements.txt && uvicorn main:app --reload`
4. Start the frontend: `cd frontend && npm install && npm run dev`
5. Access the web dashboard at `http://localhost:5173`.

---
*Built for the AI Infrastructure Hackathon.*
