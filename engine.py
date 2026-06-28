import json
import networkx as nx
import hcl2

# Set of prefixes to ignore when mapping resource-to-resource dependencies
SKIP_PREFIXES = {'var', 'local', 'module', 'path', 'terraform', 'each', 'count'}

def build_graph_from_plan(json_path):
    """Builds the structural NetworkX graph from Terraform Plan JSON."""
    with open(json_path, 'r') as f:
        plan = json.load(f)

    G = nx.DiGraph()

    # 1. Extract Structural Nodes
    planned_resources = plan.get('planned_values', {}).get('root_module', {}).get('resources', [])
    for res in planned_resources:
        node_id = res['address']
        G.add_node(node_id, type=res['type'], name=res['name'], attributes=res.get('values', {}))

    # 2. Extract Edges (Dependencies)
    config_resources = plan.get('configuration', {}).get('root_module', {}).get('resources', [])
    for res in config_resources:
        source_id = res['address']
        expressions = res.get('expressions', {})
        
        for attr, expr in expressions.items():
            # BUG 1 FIX: Ensure we are only looking for 'references' inside dictionary expressions
            if not isinstance(expr, dict):
                continue
            
            for ref in expr.get('references', []):
                parts = ref.split('.')
                
                # BUG 2 FIX: Skip variables, locals, and metadata references
                if parts[0] in SKIP_PREFIXES:
                    continue
                
                if len(parts) >= 2:
                    target_id = f"{parts[0]}.{parts[1]}"
                    # Draw edge from Target (dependency) -> Source (dependent)
                    if target_id in G.nodes and target_id != source_id:
                        G.add_edge(target_id, source_id, dependency_type=attr)
    return G

def enrich_graph_with_hcl(G, tf_path):
    """Injects raw human-readable HCL metadata into the existing graph nodes."""
    with open(tf_path, 'r') as f:
        tf_dict = hcl2.load(f)

    for res_block in tf_dict.get('resource', []):
        for res_type, res_mapping in res_block.items():
            for res_name, raw_attrs in res_mapping.items():
                
                # Strip the extra quotes python-hcl2 leaves behind
                clean_type = res_type.strip('"\'')
                clean_name = res_name.strip('"\'')
                node_id = f"{clean_type}.{clean_name}"

                # If the node exists in our JSON graph, inject the raw HCL
                if node_id in G.nodes:
                    G.nodes[node_id]['raw_hcl'] = raw_attrs
                    
    # BUG 3 FIX: Validation Pass for silent enrichment failures
    for node_id, data in G.nodes(data=True):
        if 'raw_hcl' not in data:
            print(f"[WARN] Node {node_id} has no HCL enrichment — agent context will be incomplete")
                    
    return G

if __name__ == "__main__":
    print("--- Preflight: Final Phase 1 Engine (Hardened) ---")
    
    # 1. Build structure
    graph = build_graph_from_plan('plan.json')
    
    # 2. Enrich metadata
    graph = enrich_graph_with_hcl(graph, 'main.tf')

    # Verify enrichment by printing the IAM Role's raw HCL
    iam_node = 'aws_iam_role.eks_mock_role'
    if iam_node in graph.nodes:
        print(f"\nSuccessfully enriched {iam_node}. Raw HCL payload for the Security Agent:")
        print(json.dumps(graph.nodes[iam_node].get('raw_hcl', {}), indent=2))
        
    print(f"\nTotal Nodes: {graph.number_of_nodes()}")
    print(f"Total Edges: {graph.number_of_edges()}")