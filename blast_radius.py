import networkx as nx
from collections import deque

def simulate_failure(G, failed_node_id, failure_type="outage"):
    """
    Simulates a failure cascading through the infrastructure graph using BFS.
    
    Note on failure_type: Graph propagation is identical for all types. 
    The failure_type is passed purely to the Agent Layer so the AI can 
    interpret the blast radius context differently (e.g., 'outage' vs 'data_leak').
    """
    if failed_node_id not in G.nodes:
        return {"error": f"Node {failed_node_id} not found in graph."}

    # 1. BFS Traversal for Blast Radius and Depth
    queue = deque([(failed_node_id, 0)]) 
    visited_depths = {failed_node_id: 0} 

    while queue:
        current_node, current_depth = queue.popleft()
        
        for dependent in G.successors(current_node):
            if dependent not in visited_depths:
                visited_depths[dependent] = current_depth + 1
                queue.append((dependent, current_depth + 1))

    # 2. Extract Hard Metrics
    affected_nodes = list(visited_depths.keys())
    affected_count = len(affected_nodes)
    
    # FIX 2: Explicitly handle leaf nodes so critical path is strictly >= 0
    cascade_depths = {k: v for k, v in visited_depths.items() if k != failed_node_id}
    critical_path_depth = max(cascade_depths.values()) if cascade_depths else 0

    # 3. Calculate Surviving Fragments
    G_surviving = G.copy()
    G_surviving.remove_nodes_from(affected_nodes)
    
    # FIX 1: Renamed for semantic clarity. 1 means the surviving infra is whole. 
    # >1 means the failure fractured the remaining infrastructure into disconnected islands.
    surviving_fragments_count = nx.number_weakly_connected_components(G_surviving)

    # 4. ENHANCEMENT: Enrich the pathway with node types for the AI agents
    affected_pathway = {
        node: {
            "depth": depth,
            "type": G.nodes[node].get("type", "unknown")
        }
        for node, depth in visited_depths.items()
    }

    return {
        "failed_node": failed_node_id,
        "failure_type": failure_type,
        "metrics": {
            "affected_count": affected_count,
            "critical_path_depth": critical_path_depth,
            "surviving_fragments_count": surviving_fragments_count
        },
        "affected_pathway": affected_pathway
    }

if __name__ == "__main__":
    import json
    from engine import build_graph_from_plan, enrich_graph_with_hcl

    print("--- Preflight: Blast Radius Simulator (Hardened) ---")
    
    graph = build_graph_from_plan('plan.json')
    graph = enrich_graph_with_hcl(graph, 'main.tf')

    target_node = "aws_subnet.primary"
    print(f"\n[Scenario] Simulating failure of: {target_node}")
    
    result = simulate_failure(graph, target_node)
    print(json.dumps(result, indent=2))