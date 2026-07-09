import asyncio
import json
import os
from dotenv import load_dotenv
load_dotenv()
# pyrefly: ignore [missing-import]
from openai import AsyncOpenAI

# Initialize the Async Client pointing to Fireworks AI
client = AsyncOpenAI(
    base_url="https://api.fireworks.ai/inference/v1",
    api_key=os.environ.get("FIREWORKS_API_KEY", "dummy_key_to_prevent_crash")
)

# Using the specified Fireworks model
MODEL_NAME = "accounts/fireworks/models/deepseek-v4-pro"

async def run_agent(agent_name, system_prompt, enriched_payload):
    """Generic async function to call an LLM and return structured JSON."""
    
    # Safely serialize any non-standard objects from Terraform
    user_content = json.dumps(enriched_payload, indent=2, default=str)

    try:
        response = await client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Analyze this failure event:\n{user_content}"}
            ],
            temperature=0.0,
            seed=42,
            response_format={"type": "json_object"}
        )
        raw_text = response.choices[0].message.content
        return agent_name, json.loads(raw_text)
    except Exception as e:
        print(f"[{agent_name} Agent] Error calling Fireworks AI:")
        if hasattr(e, 'response'):
            print(f"Status Code: {e.response.status_code}")
            print(f"Response Body: {e.response.text}")
        else:
            print(str(e))
        
        return agent_name, {"error": "API Call Failed", "details": str(e)}

async def analyze_scenario(enriched_payload):
    """Fires all 4 agents concurrently with the FULL raw_hcl context."""
    
    base_instructions = "You are a machine API. You must respond ONLY with valid, minified JSON. No markdown, no backticks, no conversational text."

    prompts = {
        "Reliability": f"You are a Cloud Reliability Engineer analyzing a failure event. Return a JSON object with: 'downtime_estimate_minutes' (int), 'critical_spofs' (list of strings), 'cascading_impact_summary' (a detailed 2-3 sentence paragraph explaining exactly how this failure spreads to downstream components), and 'mitigation_steps' (list of 3 actionable steps to restore service). {base_instructions}",
        
        "Security": f"You are a Cloud Security Engineer. Analyze the raw_hcl of the affected resources for IAM/SG misconfigurations or exposure risks. Return a JSON object with: 'exposure_risk_level' (Low/Medium/High/Critical), 'iam_sg_warnings' (list of strings), 'attack_vectors' (a detailed 2-3 sentence paragraph describing how a malicious actor could exploit this topology), and 'compliance_violations' (list of potential SOC2/PCI violations). {base_instructions}",
        
        "Cost": f"You are a Cloud FinOps Engineer. Analyze the affected resource types. Return a JSON object with: 'orphaned_resource_cost_estimate' (int), 'financial_impact_summary' (detailed 2-3 sentence explanation of the blast radius cost, including SLA penalties or hidden data transfer costs), and 'hourly_burn_rate' (estimated waste per hour in dollars). {base_instructions}",
        
        "Remediation": f"You are a Cloud Infrastructure Architect. Analyze the raw_hcl of the affected resources and the failure event. Propose a concrete Terraform patch to prevent this blast radius from happening again (e.g. adding Multi-AZ, an Auto Scaling Group, or IAM constraints). Return a JSON object with: 'explanation' (a 2 sentence summary of the fix), and 'terraform_patch' (a string containing the raw HCL code block for the new/modified resources). {base_instructions}"
    }

    tasks = [
        run_agent(name, prompt, enriched_payload) 
        for name, prompt in prompts.items()
    ]
    
    results = await asyncio.gather(*tasks)
    return {name: payload for name, payload in results}

if __name__ == "__main__":
    from engine import build_graph_from_plan, enrich_graph_with_hcl
    from blast_radius import simulate_failure

    print("--- Preflight: Agent Layer Simulation (Enriched Context) ---")
    
    graph = build_graph_from_plan('plan.json')
    graph = enrich_graph_with_hcl(graph, 'main.tf')
    target_node = "aws_subnet.primary"
    blast_radius_result = simulate_failure(graph, target_node)

    affected_nodes = blast_radius_result.get("affected_pathway", {}).keys()
    enriched_payload = {
        "blast_radius": blast_radius_result,
        "affected_resources": {
            node_id: graph.nodes[node_id]
            for node_id in affected_nodes
            if node_id in graph.nodes
        }
    }

    print("Dispatching agents concurrently with raw HCL context...\n")
    final_analysis = asyncio.run(analyze_scenario(enriched_payload))
    print(json.dumps(final_analysis, indent=2))