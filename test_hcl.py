import hcl2
import json

def parse_raw_tf(file_path):
    with open(file_path, 'r') as file:
        # hcl2 parses the raw Terraform file into a Python dictionary
        tf_dict = hcl2.load(file)
        
    # We will print it as pretty JSON to easily read the structure
    print(json.dumps(tf_dict, indent=2))

if __name__ == "__main__":
    print("--- Preflight HCL2 Raw Metadata Extraction ---")
    parse_raw_tf('main.tf')