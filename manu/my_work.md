TASK FOR PERSON 1:

1. Modify agents.py:
   - Change base_url to "https://api.fireworks.ai/inference/v1"
   - Change api_key to read from env var FIREWORKS_API_KEY
   - Change MODEL_NAME to "accounts/fireworks/models/qwen2p5-7b-instruct"
   - Keep all 3 agents (Reliability, Security, Cost) and asyncio.gather unchanged

2. Create a .env file in the project root:
   FIREWORKS_API_KEY=paste_key_here

3. Create requirements.txt:
   fastapi
   uvicorn
   networkx
   python-hcl2
   httpx
   openai
   python-dotenv

4. Modify main.py:
   - Add a global CURRENT_GRAPH variable that caches the NetworkX graph after it's built
   - /api/graph should build graph once, cache it, return nodes+links
   - /api/simulate should use cached graph, not rebuild every call
   - Remove the terraform subprocess calls from /api/upload for now — just parse whatever plan.json exists
   - Load the existing plan.json and main.tf on startup automatically so /api/graph works immediately without uploading

5. Run: uvicorn main:app --reload
   Then test: curl http://localhost:8000/api/graph
   It should return JSON with nodes and links arrays.

6. Then test simulate: 
   curl -X POST http://localhost:8000/api/simulate -H "Content-Type: application/json" -d "{\"node_id\": \"aws_vpc.main\", \"failure_type\": \"outage\"}"
   It should return blast_radius + agents results.

Report back exactly what the terminal shows.


STRICT REQUIREMENT:
Your API responses must match API_CONTRACT.md exactly.
Specifically:
- /api/graph returns {nodes: [{id, type, label}], links: [{source, target, dep}]}
- /api/simulate returns {blast_radius: {..., affected_pathway: {node_id: {depth, type}}}, agents: {Reliability, Security, Cost}}
Do not rename any fields. The frontend depends on these exact shapes.