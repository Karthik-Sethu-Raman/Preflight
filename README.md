# Preflight AI

## What it does
Preflight AI is a cloud infrastructure risk engine that analyzes Terraform deployments to identify potential failure impacts. It parses a `.tf` file into a graph, simulates cascading failures using BFS, and leverages AI agents to assess reliability, security, and cost risks.

## Architecture
```text
+---------------+       +------------------+       +------------------+
|               |       |                  |       |                  |
|  React + Vite | <---> | FastAPI Backend  | <---> | Fireworks AI API |
|  (Frontend)   |       | (Python)         |       | (DeepSeek V4 Pro)|
|               |       |                  |       |                  |
+---------------+       +------------------+       +------------------+
                                |
                                v
                        +------------------+
                        |                  |
                        | Terraform Plan   |
                        | Graph & BFS Sim  |
                        |                  |
                        +------------------+
```

## Setup instructions
1. Clone this repository.
2. Create a `.env` file in the project root and add your `FIREWORKS_API_KEY` (e.g., `FIREWORKS_API_KEY=your_key_here`).
3. Run `docker-compose up --build` to start both the frontend and backend services.
4. Access the frontend at `http://localhost:5173`.

## How to use
1. Upload your Terraform `.tf` file using the UI.
2. Once the graph is generated, click on any node to select it as the failure origin.
3. Simulate a failure (e.g., outage, data leak) to visualize the blast radius and view insights from the Reliability, Security, and Cost AI agents.

## Tech stack
- **Backend:** Python, FastAPI, NetworkX, asyncio, python-hcl2, httpx, openai SDK
- **Frontend:** React + Vite, react-force-graph-2d
- **AI:** Fireworks AI API (DeepSeek V4 Pro)
- **Deployment:** Docker + docker-compose

## Third-Party GitHub Action

You can add Preflight AI directly to your own repositories to get automatic Terraform code reviews on your Pull Requests!

Just create a file at `.github/workflows/preflight.yml` in your repository:

```yaml
name: "Preflight AI Review"
on:
  pull_request:
    paths:
      - '**/*.tf'

jobs:
  preflight-review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v3
        with:
          fetch-depth: 2
      
      - name: Run Preflight AI
        uses: Karthik-Sethu-Raman/Preflight@main
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

Preflight will automatically analyze your changed `.tf` files and post a beautiful Markdown report with potential misconfigurations and security risks directly to your PR!
