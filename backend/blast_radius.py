import networkx as nx
from collections import deque
import random

FAILURE_MODES = [
    "outage", 
    "network_partition", 
    "credential_compromise",
    "data_corruption",
    "resource_deleted"
]

def simulate_failure(G, failed_node_id, failure_type="outage"):
    """
    Simulates a failure cascading through the infrastructure graph.
    Supports different failure models based on failure_type.
    """
    if failed_node_id not in G.nodes:
        return {"error": f"Error: Node {failed_node_id} not found in graph."}

    queue = deque([(failed_node_id, 0)]) 
    visited_depths = {failed_node_id: 0} 

    while queue:
        current_node, current_depth = queue.popleft()
        
        # Traverse depending on failure model
        if failure_type == "credential_compromise":
            # Lateral movement: traverse both successors (things that depend on this credential) 
            # and predecessors (things this credential has access to)
            neighbors = list(G.successors(current_node)) + list(G.predecessors(current_node))
        elif failure_type == "network_partition":
            # Typically affects routing, firewalls, and subnets heavily
            neighbors = list(G.successors(current_node))
        else:
            # Standard availability outage (cascading dependency failure)
            neighbors = list(G.successors(current_node))
            
        for dependent in neighbors:
            if dependent not in visited_depths:
                visited_depths[dependent] = current_depth + 1
                queue.append((dependent, current_depth + 1))

    affected_nodes = list(visited_depths.keys())
    affected_count = len(affected_nodes)
    
    cascade_depths = {k: v for k, v in visited_depths.items() if k != failed_node_id}
    critical_path_depth = max(cascade_depths.values()) if cascade_depths else 0

    G_surviving = G.copy()
    G_surviving.remove_nodes_from(affected_nodes)
    surviving_fragments_count = nx.number_weakly_connected_components(G_surviving)

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

def run_chaos_simulations(G, num_simulations=100):
    """
    Monte Carlo simulation: picks random resources and failure types to discover high-risk scenarios.
    """
    nodes = list(G.nodes())
    if not nodes:
        return []
        
    results = []
    
    for _ in range(num_simulations):
        node = random.choice(nodes)
        f_type = random.choice(FAILURE_MODES)
        
        blast = simulate_failure(G, node, f_type)
        if "error" in blast:
            continue
            
        metrics = blast["metrics"]
        affected_count = metrics["affected_count"]
        depth = metrics["critical_path_depth"]
        
        # Risk Score Heuristic
        risk_score = (affected_count * 0.6) + (depth * 1.2)
        
        node_type = G.nodes[node].get("type", "unknown")
        if node_type in ["aws_db_instance", "aws_rds_cluster", "aws_iam_role", "aws_vpc", "aws_nat_gateway", "aws_route_table"]:
            risk_score *= 1.5
            
        risk_score = min(round(risk_score, 1), 9.9)
        if risk_score == 0:
            risk_score = 0.1
            
        results.append({
            "resource": node,
            "type": node_type,
            "failure_type": f_type,
            "affected_count": affected_count,
            "critical_path_depth": depth,
            "risk_score": risk_score,
            "blast_radius": blast
        })
        
    # Sort by risk descending
    results.sort(key=lambda x: x["risk_score"], reverse=True)
    
    # Deduplicate top scenarios
    seen = set()
    unique_top = []
    for r in results:
        sig = f"{r['resource']}-{r['failure_type']}"
        if sig not in seen:
            seen.add(sig)
            unique_top.append(r)
            
    return unique_top

if __name__ == "__main__":
    import json
    from engine import build_graph_from_plan, enrich_graph_with_hcl

    print("--- Preflight: Blast Radius & Chaos Simulator ---")
    
    graph = build_graph_from_plan('plan.json')
    graph = enrich_graph_with_hcl(graph, 'main.tf')

    print("\n[Scenario] Running Chaos Monte Carlo Simulations...")
    chaos_results = run_chaos_simulations(graph, num_simulations=50)
    
    print("\nTop 3 Riskiest Scenarios:")
    for res in chaos_results[:3]:
        print(f"Risk {res['risk_score']} | {res['resource']} ({res['failure_type']}) -> {res['affected_count']} affected")