import asyncio
import json
import os
import re
from openai import AsyncOpenAI

# Initialize the Async Client pointing to Fireworks AI
client = AsyncOpenAI(
    base_url="https://api.fireworks.ai/inference/v1",
    api_key=os.environ.get("FIREWORKS_API_KEY")
)

# Using the specified Fireworks model
MODEL_NAME = "accounts/fireworks/models/qwen2p5-7b-instruct"

def extract_clean_json(text_response):
    """
    The Fallback Parser.
    Strips markdown backticks and conversational text to return pure JSON.
    """
    try:
        return json.loads(text_response)
    except json.JSONDecodeError:
        # UI PARSER FIX: Use chr(96) instead of literal backticks 
        ticks = chr(96) * 3
        pattern = rf'{ticks}(?:json)?\s*(.*?)\s*{ticks}'
        
        match = re.search(pattern, text_response, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
        return {"error": "Failed to parse JSON", "raw_response": text_response}

async def run_agent(agent_name, system_prompt, enriched_payload):
    """Generic async function to call an LLM and return structured JSON."""
    
    # CLAUDE'S FIX: Add default=str to safely serialize any non-standard objects from Terraform
    user_content = json.dumps(enriched_payload, indent=2, default=str)

    response = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Analyze this failure event:\n{user_content}"}
        ],
        temperature=0.1, 
    )
    
    raw_text = response.choices[0].message.content
    return agent_name, extract_clean_json(raw_text)

async def analyze_scenario(enriched_payload):
    """Fires all 3 agents concurrently with the FULL raw_hcl context."""
    
    base_instructions = "You are a machine API. You must respond ONLY with valid, minified JSON. No markdown, no backticks, no conversational text."

    prompts = {
        "Reliability": f"You are a Cloud Reliability Engineer. Analyze the blast radius metrics and affected resources. Return a JSON object with 'downtime_estimate_minutes' (integer) and 'critical_spofs' (list of strings). {base_instructions}",
        
        "Security": f"You are a Cloud Security Engineer. Analyze the raw_hcl of the affected resources for IAM/SG misconfigurations or exposure risks. Return a JSON object with 'exposure_risk_level' (Low/Medium/High) and 'iam_sg_warnings' (list of strings). {base_instructions}",
        
        "Cost": f"You are a Cloud FinOps Engineer. Analyze the affected resource types. Return a JSON object with 'orphaned_resource_cost_estimate' (integer) and 'financial_impact_summary' (string). {base_instructions}"
    }

    tasks = [
        run_agent(name, prompt, enriched_payload) 
        for name, prompt in prompts.items()
    ]
    
    results = await asyncio.gather(*tasks)
    return {name: payload for name, payload in results}

if __name__ == "__main__":
    # Import the actual engines from Phase 1 and 2!
    from engine import build_graph_from_plan, enrich_graph_with_hcl
    from blast_radius import simulate_failure

    print("--- Preflight: Agent Layer Simulation (Enriched Context) ---")
    
    # 1. Build the real infrastructure graph
    graph = build_graph_from_plan('plan.json')
    graph = enrich_graph_with_hcl(graph, 'main.tf')

    # 2. Simulate the failure
    target_node = "aws_subnet.primary"
    blast_radius_result = simulate_failure(graph, target_node)

    # 3. CLAUDE'S FIX: Construct the enriched payload containing the raw_hcl
    affected_nodes = blast_radius_result.get("affected_pathway", {}).keys()
    
    enriched_payload = {
        "blast_radius": blast_radius_result,
        "affected_resources": {
            node_id: graph.nodes[node_id]
            for node_id in affected_nodes
            if node_id in graph.nodes
        }
    }

    print("Dispatching Reliability, Security, and Cost agents concurrently with raw HCL context...\n")
    
    # Run the async loop
    final_analysis = asyncio.run(analyze_scenario(enriched_payload))
    
    print(json.dumps(final_analysis, indent=2))