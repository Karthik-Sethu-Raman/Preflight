import json
import shutil
import os
import subprocess
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import your hardened Phase 1, 2, and 4 logic
from engine import build_graph_from_plan, enrich_graph_with_hcl
from blast_radius import simulate_failure, run_chaos_simulations
from agents import analyze_scenario, analyze_chaos_results, recommend_architecture

app = FastAPI(title="Preflight Graph API")

# Enable CORS for the Vite React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state to track which .tf file to use for HCL enrichment and cache the graph
CURRENT_TF_FILE = "main.tf"
CURRENT_GRAPH = {
    "data": None,      # The dict returned to the frontend (nodes + links)
    "nx_graph": None   # The NetworkX graph object used for simulation
}

class SimulateRequest(BaseModel):
    node_id: str
    failure_type: str = "outage"

def get_formatted_graph(json_plan_path, tf_file_path):
    """Helper to build, enrich, and format the graph for the frontend."""
    G = build_graph_from_plan(json_plan_path)
    G = enrich_graph_with_hcl(G, tf_file_path)
    
    nodes = [
        {"id": n, "type": data.get("type", "unknown"), "label": n} 
        for n, data in G.nodes(data=True)
    ]
    links = [
        {"source": u, "target": v, "dep": data.get("dependency_type", "unknown")} 
        for u, v, data in G.edges(data=True)
    ]
    return {"nodes": nodes, "links": links}, G

def init_graph():
    """Initializes the cached graph on startup."""
    global CURRENT_GRAPH
    if os.path.exists("plan.json") and os.path.exists(CURRENT_TF_FILE):
        data, nx_graph = get_formatted_graph("plan.json", CURRENT_TF_FILE)
        CURRENT_GRAPH["data"] = data
        CURRENT_GRAPH["nx_graph"] = nx_graph

# No longer auto-loading graph on startup — users must upload a .tf file first.

@app.get("/")
def read_root():
    """Root route to verify the API is running."""
    return {"message": "Preflight API is live!", "status": "ok"}

@app.get("/api/graph")
def get_graph():
    """Returns the current infrastructure topography from cache."""
    if not CURRENT_GRAPH["data"]:
        return {"nodes": [], "links": []}
    return CURRENT_GRAPH["data"]

@app.post("/api/upload")
def upload_tf(file: UploadFile = File(...)):
    """Accepts a new .tf file, saves it, and regenerates the graph from existing plan.json."""
    global CURRENT_TF_FILE, CURRENT_GRAPH
    
    # 1. Overwrite the main.tf file with the newly uploaded code
    with open("main.tf", "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    CURRENT_TF_FILE = "main.tf"
    
    # 2. Run Terraform subprocess calls to regenerate plan.json dynamically
    try:
        # Set dummy AWS credentials to completely bypass slow AWS credential discovery timeouts
        import os
        env = os.environ.copy()
        env["AWS_ACCESS_KEY_ID"] = "dummy"
        env["AWS_SECRET_ACCESS_KEY"] = "dummy"
        env["AWS_DEFAULT_REGION"] = "us-east-1"
        env["AWS_SESSION_TOKEN"] = "dummy"

        # Try planning first to skip the slow init step if providers are already cached
        try:
            subprocess.run(["terraform", "plan", "-out=tfplan", "-input=false", "-refresh=false"], check=True, capture_output=True, cwd=".", text=True, env=env)
        except subprocess.CalledProcessError:
            # If plan fails, we likely need to initialize new providers
            subprocess.run(["terraform", "init", "-input=false"], check=True, capture_output=True, cwd=".", text=True, env=env)
            subprocess.run(["terraform", "plan", "-out=tfplan", "-input=false", "-refresh=false"], check=True, capture_output=True, cwd=".", text=True, env=env)
        # Show as JSON
        result = subprocess.run(["terraform", "show", "-json", "tfplan"], check=True, capture_output=True, cwd=".", text=True, env=env)
        
        # Overwrite plan.json
        with open("plan.json", "w", encoding="utf-8") as f:
            f.write(result.stdout)
            
        # Parse the dynamically generated plan.json
        data, nx_graph = get_formatted_graph("plan.json", CURRENT_TF_FILE)
        CURRENT_GRAPH["data"] = data
        CURRENT_GRAPH["nx_graph"] = nx_graph
    except subprocess.CalledProcessError as e:
        print(f"Terraform error: {e.stderr}")
        raise HTTPException(status_code=400, detail="Terraform validation failed. Check your syntax.")
    except Exception as e:
        print(f"Error parsing graph: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse the new graph.")

    # 3. Return the completely new, dynamically generated graph
    return CURRENT_GRAPH["data"]

@app.post("/api/github/analyze-pr")
async def analyze_pr_endpoint(file: UploadFile = File(...)):
    """Receives a Terraform file from GitHub Actions and returns an AI Markdown review."""
    import asyncio
    import subprocess
    from agents import analyze_chaos_results, recommend_architecture, compile_pr_markdown_report
    from engine import build_graph_from_plan, enrich_graph_with_hcl
    from blast_radius import run_chaos_simulations
    
    import tempfile
    import os
    import shutil
    try:
        content = await file.read()
        tf_code = content.decode("utf-8")
        
        import re
        with tempfile.TemporaryDirectory() as temp_dir:
            # Write a default provider so we don't fail on missing region
            if not re.search(r'provider\s+"aws"', tf_code):
                with open(os.path.join(temp_dir, "provider.tf"), "w", encoding="utf-8") as f:
                    f.write('provider "aws" { region = "us-west-2" }\n')
                
            # Write PR file
            pr_file_path = os.path.join(temp_dir, "pr_main.tf")
            with open(pr_file_path, "w", encoding="utf-8") as f:
                f.write(tf_code)
                
            try:
                # 2. Run Terraform to get plan
                subprocess.run(["terraform", "init", "-backend=false", "-input=false"], check=True, capture_output=True, cwd=temp_dir, text=True)
                subprocess.run(["terraform", "plan", "-out=pr_tfplan", "-input=false"], check=True, capture_output=True, cwd=temp_dir, text=True)
                result = subprocess.run(["terraform", "show", "-json", "pr_tfplan"], check=True, capture_output=True, cwd=temp_dir, text=True)
            except subprocess.CalledProcessError as e:
                print(f"Terraform error during PR analysis: stdout={e.stdout}, stderr={e.stderr}")
                raise HTTPException(status_code=400, detail=f"Terraform validation failed: {e.stderr}")
                
            plan_path = os.path.join(temp_dir, "pr_plan.json")
            with open(plan_path, "w", encoding="utf-8") as f:
                f.write(result.stdout)
                
            # 3. Build graph
            G = build_graph_from_plan(plan_path)
            G = enrich_graph_with_hcl(G, pr_file_path)
            
        # 4. Chaos Simulations
        chaos_results = run_chaos_simulations(G, num_simulations=50)
        top_scenarios = chaos_results[:3]
        
        # 5. LLM Pipeline (AMD)
        explanations_task = analyze_chaos_results(top_scenarios)
        arch_task = recommend_architecture(top_scenarios)
        explanations, recommendations = await asyncio.gather(explanations_task, arch_task)
        
        # 6. Final Report via Fireworks
        markdown_report = await compile_pr_markdown_report(
            tf_code, 
            explanations, 
            recommendations
        )
        
        return {"markdown_report": markdown_report}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error during PR analysis: {e}")
        raise HTTPException(status_code=500, detail="Failed to analyze PR code.")


@app.post("/api/simulate")
async def simulate(req: SimulateRequest):
    """Executes the deterministic BFS propagation and dispatches the AI agents."""
    G = CURRENT_GRAPH["nx_graph"]
    if not G:
        raise HTTPException(status_code=400, detail="Graph not initialized.")
    
    # 1. Run BFS Math
    blast_result = simulate_failure(G, req.node_id, req.failure_type)
    if "error" in blast_result:
        raise HTTPException(status_code=400, detail=blast_result["error"])
        
    # 2. Build the enriched context payload for the Agents
    affected_nodes = blast_result.get("affected_pathway", {}).keys()
    enriched_payload = {
        "blast_radius": blast_result,
        "affected_resources": {
            node_id: G.nodes[node_id] for node_id in affected_nodes if node_id in G.nodes
        }
    }
    
    # 3. Fire the concurrent agents
    agents_result = await analyze_scenario(enriched_payload)
    
    # Claude's safeguard: Serialize with default=str to avoid FastAPI crashing on Terraform objects
    safe_response = json.loads(json.dumps({
        "blast_radius": blast_result,
        "agents": agents_result
    }, default=str))
    
    return safe_response

@app.post("/api/chaos-simulate")
async def chaos_simulate():
    """Executes the Chaos Engineering Monte Carlo Simulation over the entire graph."""
    import asyncio
    G = CURRENT_GRAPH["nx_graph"]
    if not G:
        raise HTTPException(status_code=400, detail="Graph not initialized.")
    
    # Run the monte carlo simulations
    chaos_results = run_chaos_simulations(G, num_simulations=100)
    if not chaos_results:
        raise HTTPException(status_code=400, detail="Failed to generate chaos results.")
        
    top_scenarios = chaos_results[:3] # Take top 3 for speed
    
    # Fire the concurrent LLM explanations and recommendations
    explanations_task = analyze_chaos_results(top_scenarios)
    arch_task = recommend_architecture(top_scenarios)
    
    explanations, recommendations = await asyncio.gather(explanations_task, arch_task)
    
    safe_response = json.loads(json.dumps({
        "top_scenarios": top_scenarios,
        "explanations": explanations.get("explanations", {}),
        "recommendations": recommendations.get("recommendations", [])
    }, default=str))
    
    return safe_response