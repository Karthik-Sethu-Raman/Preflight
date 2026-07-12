# 🤖 Preflight GitHub Action

Preflight AI is not just a web dashboard; it integrates directly into your developer workflow to stop bad infrastructure code from ever being merged.

## How it works

When a developer opens a Pull Request that modifies Terraform (`.tf`) files, the Preflight GitHub Action intercepts the PR. 

1. It sends the raw Terraform code to your deployed Preflight Backend API.
2. The Backend parses the code, builds the mathematical graph, and simulates hundreds of node failures.
3. It routes standard checks (Cost, Security, Reliability) to **Fireworks AI**.
4. It routes the heavy Monte Carlo Chaos simulations to your self-hosted **AMD MI300x GPU**.
5. It synthesizes the data and automatically posts a comprehensive Markdown code review back to the Pull Request.

## Setup Instructions

To add Preflight AI to any of your Terraform repositories, create a workflow file at `.github/workflows/preflight.yml`:

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
        # Point this to your deployed Action repository
        uses: Karthik-Sethu-Raman/Preflight@main
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

*(Note: The backend endpoint URL is hardcoded into `action.yml` in this repository. If you redeploy your EC2 backend to a new IP/Domain, make sure to update the `curl` command inside `action.yml` to point to your new backend URL!)*
