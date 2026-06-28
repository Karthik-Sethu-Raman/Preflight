import json
import shutil
import subprocess
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import your hardened Phase 1, 2, and 4 logic
from engine import build_graph_from_plan, enrich_graph_with_hcl
from blast_radius import simulate_failure
from agents import analyze_scenario

app = FastAPI(title="Preflight Graph API")

# Enable CORS for the Vite React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state to track which .tf file to use for HCL enrichment
CURRENT_TF_FILE = "main.tf"

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

@app.get("/api/graph")
def get_graph():
    """Returns the current infrastructure topography."""
    graph_data, _ = get_formatted_graph("plan.json", CURRENT_TF_FILE)
    return graph_data

@app.post("/api/upload")
async def upload_tf(file: UploadFile = File(...)):
    """Accepts a new .tf file, runs Terraform dynamically, and generates a fresh graph."""
    global CURRENT_TF_FILE
    
    # 1. Overwrite the main.tf file with the newly uploaded code
    with open("main.tf", "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    CURRENT_TF_FILE = "main.tf"
    
    try:
        # 2. Dynamically run Terraform to calculate the new graph!
        # This simulates exactly what you did manually in your terminal during Phase 1
        subprocess.run(["terraform", "init"], check=True, capture_output=True)
        subprocess.run(["terraform", "plan", "-out=tfplan"], check=True, capture_output=True)
        
        # 3. Convert the new plan to JSON and overwrite plan.json
        with open("plan.json", "w") as f:
            subprocess.run(["terraform", "show", "-json", "tfplan"], stdout=f, check=True)
            
    except subprocess.CalledProcessError as e:
        # If the user uploads broken Terraform code, catch the error gracefully
        print(f"Terraform Error: {e.stderr}")
        raise HTTPException(status_code=400, detail="Invalid Terraform configuration uploaded.")

    # 4. Return the completely new, dynamically generated graph
    graph_data, _ = get_formatted_graph("plan.json", CURRENT_TF_FILE)
    return graph_data

@app.post("/api/simulate")
async def simulate(req: SimulateRequest):
    """Executes the deterministic BFS propagation and dispatches the AI agents."""
    _, G = get_formatted_graph("plan.json", CURRENT_TF_FILE)
    
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