import json
import networkx as nx

def build_graph_from_plan(json_path):
    with open(json_path, 'r') as f:
        plan = json.load(f)

    # Initialize a Directed Graph
    G = nx.DiGraph()

    # 1. Extract Nodes and Metadata
    planned_resources = plan.get('planned_values', {}).get('root_module', {}).get('resources', [])
    for res in planned_resources:
        node_id = res['address'] # e.g., 'aws_vpc.main'
        metadata = {
            'type': res['type'],
            'name': res['name'],
            # Storing the actual AWS attributes (like cidr_block) for the AI agents later
            'attributes': res.get('values', {}) 
        }
        G.add_node(node_id, **metadata)

    # 2. Extract Edges (Dependencies)
    config_resources = plan.get('configuration', {}).get('root_module', {}).get('resources', [])
    for res in config_resources:
        source_id = res['address']

        # Look through all configuration expressions to find 'references'
        expressions = res.get('expressions', {})
        for attr, expr in expressions.items():
            if 'references' in expr:
                for ref in expr['references']:
                    # References often look like 'aws_vpc.main.id'. We just want 'aws_vpc.main'.
                    parts = ref.split('.')
                    if len(parts) >= 2:
                        target_id = f"{parts[0]}.{parts[1]}"
                        
                        # Only draw an edge if the target is a known node and not a self-reference
                        if target_id in G.nodes and target_id != source_id:
                            # Edge flows from Target (VPC) -> Source (Subnet) for blast radius
                            G.add_edge(target_id, source_id, dependency_type=attr)

    return G

if __name__ == "__main__":
    # Test our function against the generated JSON
    graph = build_graph_from_plan('plan.json')
    
    print("--- Preflight Graph Engine ---")
    print(f"Nodes found: {list(graph.nodes(data=True))}\n")
    print(f"Edges mapped: {list(graph.edges(data=True))}\n")
    
    # Quick sanity check for the blast radius logic
    print("If 'aws_vpc.main' fails, what is immediately affected?")
    affected = list(graph.successors('aws_vpc.main'))
    print(affected)