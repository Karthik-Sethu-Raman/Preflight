import asyncio
import json
import os
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv
load_dotenv()
# pyrefly: ignore [missing-import]
from openai import AsyncOpenAI

# 1. Fireworks Client (For complex reasoning and compilation)
FIREWORKS_KEY = os.environ.get("FIREWORKS_API_KEY", "dummy_key")
FIREWORKS_MODEL = "accounts/fireworks/models/deepseek-v4-pro"
fireworks_client = AsyncOpenAI(
    base_url="https://api.fireworks.ai/inference/v1",
    api_key=FIREWORKS_KEY
)

# 2. AMD Client (For high-volume chaos engine workloads)
AMD_BASE = os.environ.get("LLM_API_BASE")
if AMD_BASE:
    AMD_KEY = os.environ.get("LLM_API_KEY", "amd-key")
    AMD_MODEL = os.environ.get("LLM_MODEL_NAME", "meta-llama/Meta-Llama-3-70B-Instruct")
else:
    # Fallback to Fireworks if AMD is not configured in .env
    AMD_BASE = "https://api.fireworks.ai/inference/v1"
    AMD_KEY = FIREWORKS_KEY
    AMD_MODEL = FIREWORKS_MODEL
    
amd_client = AsyncOpenAI(
    base_url=AMD_BASE,
    api_key=AMD_KEY
)

async def _call_llm(client, model, system_prompt, user_prompt, require_json=True):
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.0,
            seed=42,
            response_format={"type": "json_object"} if require_json else None
        )
        raw = response.choices[0].message.content
        return json.loads(raw) if require_json else raw
    except Exception as e:
        print(f"Error calling LLM ({model}): {e}")
        # Dynamic runtime fallback to Fireworks if the AMD droplet goes offline
        if client == amd_client and fireworks_client is not None and model != FIREWORKS_MODEL:
            print("AMD Droplet offline or unreachable! Automatically falling back to Fireworks...")
            return await _call_llm(fireworks_client, FIREWORKS_MODEL, system_prompt, user_prompt, require_json)
            
        return {"error": str(e)} if require_json else f"Error: {e}"

# --- FIREWORKS AGENTS (Standard Analysis) ---

async def analyze_scenario(enriched_payload):
    """Fires all 4 agents concurrently with the FULL raw_hcl context for a single node failure."""
    base_instructions = "You are a machine API. You must respond ONLY with valid, minified JSON. No markdown."
    user_prompt = f"Analyze this context:\n{json.dumps(enriched_payload, indent=2, default=str)}"

    prompts = {
        "Reliability": f"You are a Cloud Reliability Engineer analyzing a failure event. Return a JSON object with: 'downtime_estimate_minutes' (int), 'critical_spofs' (list of strings), 'cascading_impact_summary' (a detailed 2-3 sentence paragraph explaining exactly how this failure spreads to downstream components), and 'mitigation_steps' (list of 3 actionable steps to restore service). {base_instructions}",
        "Security": f"You are a Cloud Security Engineer. Analyze the raw_hcl of the affected resources for IAM/SG misconfigurations or exposure risks. Return a JSON object with: 'exposure_risk_level' (Low/Medium/High/Critical), 'iam_sg_warnings' (list of strings), 'attack_vectors' (a detailed 2-3 sentence paragraph describing how a malicious actor could exploit this topology), and 'compliance_violations' (list of potential SOC2/PCI violations). {base_instructions}",
        "Cost": f"You are a Cloud FinOps Engineer. Analyze the affected resource types. Return a JSON object with: 'orphaned_resource_cost_estimate' (int), 'financial_impact_summary' (detailed 2-3 sentence explanation of the blast radius cost, including SLA penalties or hidden data transfer costs), and 'hourly_burn_rate' (estimated waste per hour in dollars). {base_instructions}",
        "Remediation": f"You are a Cloud Infrastructure Architect. Analyze the raw_hcl of the affected resources and the failure event. Propose a concrete Terraform patch to prevent this blast radius from happening again (e.g. adding Multi-AZ, an Auto Scaling Group, or IAM constraints). Return a JSON object with: 'explanation' (a 2 sentence summary of the fix), and 'terraform_patch' (a string containing the raw HCL code block for the new/modified resources. CRITICAL: Ensure the HCL is perfectly valid, use underscores for resource types like 'aws_subnet', and include proper indentation). {base_instructions}"
    }

    async def run_single(name, sys_prompt):
        res = await _call_llm(fireworks_client, FIREWORKS_MODEL, sys_prompt, user_prompt)
        return name, res

    tasks = [run_single(name, prompt) for name, prompt in prompts.items()]
    results = await asyncio.gather(*tasks)
    return {name: payload for name, payload in results}

# --- AMD AGENTS (Chaos Engine) ---

async def analyze_chaos_results(top_scenarios):
    """Explains the top risk scenarios discovered by the chaos engine (uses AMD client)."""
    base = "You are a machine API. Respond ONLY with minified JSON."
    prompt = f"You are a Chaos Engineering AI. I am providing you with the top highest-risk failure scenarios from our Monte Carlo simulation on the infrastructure graph. For each scenario in the list, explain why it is dangerous and its business impact. Return a JSON object with a key 'explanations' which is a dictionary mapping the resource ID to a string explanation of the impact and danger. {base}"
    user = json.dumps(top_scenarios, indent=2, default=str)
    
    return await _call_llm(amd_client, AMD_MODEL, prompt, user)

async def recommend_architecture(risk_list):
    """Recommends holistic architecture fixes based on aggregate chaos risk data (uses AMD client)."""
    base = "You are a machine API. Respond ONLY with minified JSON."
    prompt = f"You are a Principal Cloud Architect. I am providing you with a list of high-risk resources discovered during chaos simulation. Recommend 3 concrete architectural changes to reduce the highest overall risks. Return a JSON object with a key 'recommendations' which is a list of objects, each containing 'title' (string), 'description' (string), and 'estimated_risk_reduction_pct' (int). {base}"
    user = json.dumps(risk_list, indent=2, default=str)
    
    return await _call_llm(amd_client, AMD_MODEL, prompt, user)

# --- REFINEMENT COMPILER (Fireworks) ---

async def compile_pr_markdown_report(tf_code: str, chaos_explanations: dict, chaos_recommendations: dict, manual_analysis: dict = None) -> str:
    """Takes AMD Chaos Engine results and uses Fireworks to generate the final PR comment."""
    sys_prompt = (
        "You are a Principal Cloud Infrastructure Architect doing a code review on a GitHub PR. "
        "You have been provided with the raw Terraform code, AND the results from our internal AI Chaos Engineering Simulator. "
        "Your job is to compile a beautiful, single Markdown report combining a standard code review with the Chaos Simulation results. "
        "Make sure to use Markdown headers (##), bullet points, and highlight the most critical risks. "
        "Do NOT mention 'Fireworks' or 'AMD' in the report, just speak as the Preflight AI engine."
    )
    
    context = {
        "terraform_code": tf_code,
        "chaos_simulations": {
            "explanations": chaos_explanations.get("explanations", {}),
            "architectural_recommendations": chaos_recommendations.get("recommendations", [])
        }
    }
    if manual_analysis:
        context["primary_node_analysis"] = manual_analysis
        
    user_prompt = f"Please write the final markdown report based on this context:\n{json.dumps(context, indent=2, default=str)}"
    
    # Needs to return plain markdown string, not JSON
    return await _call_llm(fireworks_client, FIREWORKS_MODEL, sys_prompt, user_prompt, require_json=False)