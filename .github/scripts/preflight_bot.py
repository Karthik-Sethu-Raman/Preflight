import os
import re
import sys
import requests
import subprocess

def get_modified_tf_files():
    """Get list of modified .tf files in the PR."""
    try:
        # In GitHub Actions pull_request event, HEAD^1 is usually the base branch
        result = subprocess.run(
            ['git', 'diff', '--name-only', 'HEAD^1', 'HEAD'],
            capture_output=True, text=True, check=True
        )
        files = result.stdout.strip().split('\n')
        tf_files = [f for f in files if f.endswith('.tf')]
        return tf_files
    except Exception as e:
        print(f"Error getting git diff: {e}")
        return []

def extract_first_resource(file_path):
    """Extract the first Terraform resource block to use as the failure node."""
    try:
        with open(file_path, 'r') as f:
            content = f.read()
        
        match = re.search(r'resource\s+"([^"]+)"\s+"([^"]+)"', content)
        if match:
            return f"{match.group(1)}.{match.group(2)}"
    except Exception as e:
        print(f"Error parsing file: {e}")
    return None

def main():
    api_url = os.environ.get('PREFLIGHT_API_URL', 'http://localhost:8000').rstrip('/')
    github_token = os.environ.get('GITHUB_TOKEN')
    pr_number = os.environ.get('PR_NUMBER')
    repo_name = os.environ.get('REPO_NAME')

    if not github_token or not pr_number or not repo_name:
        print("Missing GitHub environment variables. Skipping comment post.")
        # We don't exit, we just won't post to GitHub (useful for local testing)

    tf_files = get_modified_tf_files()
    if not tf_files:
        print("No .tf files modified. Exiting.")
        sys.exit(0)

    target_file = tf_files[0]
    print(f"Analyzing {target_file}...")

    # 1. Upload to Preflight API
    print("Uploading to Preflight API...")
    try:
        with open(target_file, 'rb') as f:
            files = {'file': (os.path.basename(target_file), f, 'application/octet-stream')}
            upload_res = requests.post(f"{api_url}/api/upload", files=files)
            upload_res.raise_for_status()
    except Exception as e:
        print(f"Failed to upload to Preflight API: {e}")
        # If API is fake or unreachable, exit gracefully for the hackathon demo unless it's critical
        sys.exit(0)

    # 2. Find a node to simulate
    node_id = extract_first_resource(target_file)
    if not node_id:
        print("No valid Terraform resources found in the file to simulate. Exiting.")
        sys.exit(0)

    # 3. Run Simulation
    print(f"Simulating failure on {node_id}...")
    try:
        sim_res = requests.post(f"{api_url}/api/simulate", json={
            "node_id": node_id,
            "failure_type": "Accidental Deletion / Configuration Error"
        })
        sim_res.raise_for_status()
        data = sim_res.json()
    except Exception as e:
        print(f"Failed to run simulation: {e}")
        sys.exit(0)

    agents = data.get("agents", {})
    if not agents:
        print("No agent data returned.")
        sys.exit(0)

    # 4. Construct Markdown Comment
    reliability = agents.get("Reliability", {})
    security = agents.get("Security", {})
    cost = agents.get("Cost", {})
    remediation = agents.get("Remediation", {})

    comment_body = f"""## 🚨 Preflight Risk Analysis

**Target Resource:** `{node_id}`

### 💥 Blast Radius (Reliability)
> {reliability.get('cascading_impact_summary', 'No immediate impact detected.')}
**Estimated Downtime:** {reliability.get('downtime_estimate_minutes', 0)} minutes

### 💸 FinOps Impact
> {cost.get('financial_impact_summary', 'No financial impact.')}
**Hourly Burn Rate:** ${cost.get('hourly_burn_rate', 0)}/hr

### 🔒 Security & Compliance
**Exposure Risk:** `{security.get('exposure_risk_level', 'Unknown')}`
> {security.get('attack_vectors', 'No clear attack vectors.')}

---

### 🛠️ Auto-Remediation
{remediation.get('explanation', 'Review configuration.')}

```hcl
{remediation.get('terraform_patch', '# No patch generated')}
```
"""

    print("Generated Comment:")
    print(comment_body)

    # 5. Post Comment to GitHub PR
    if github_token and pr_number and repo_name:
        print(f"Posting comment to PR #{pr_number} in {repo_name}...")
        url = f"https://api.github.com/repos/{repo_name}/issues/{pr_number}/comments"
        headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        res = requests.post(url, json={"body": comment_body}, headers=headers)
        if res.status_code == 201:
            print("Successfully posted PR comment!")
        else:
            print(f"Failed to post comment: {res.status_code} {res.text}")

if __name__ == "__main__":
    main()
