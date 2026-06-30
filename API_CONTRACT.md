# Preflight AI — API Contract

> This is the single source of truth between frontend and backend.
> Neither side changes these shapes without updating this file first.
> Backend implements exactly this. Frontend consumes exactly this.

---

## Base URL

```
http://localhost:8000
```

---

## Endpoints

---

### GET `/api/graph`

Returns the current infrastructure topology.

**Request:** No body, no params.

**Response `200`:**
```json
{
  "nodes": [
    { "id": "aws_vpc.main", "type": "aws_vpc", "label": "aws_vpc.main" },
    { "id": "aws_subnet.public_a", "type": "aws_subnet", "label": "aws_subnet.public_a" }
  ],
  "links": [
    { "source": "aws_vpc.main", "target": "aws_subnet.public_a", "dep": "vpc_id" }
  ]
}
```

**Field definitions:**
- `nodes[].id` — unique string, used as the node identifier everywhere
- `nodes[].type` — AWS resource type e.g. `aws_vpc`, `aws_db_instance`
- `nodes[].label` — display string shown in UI (same as id for now)
- `links[].source` — id of the dependency (the thing that must exist first)
- `links[].target` — id of the dependent (the thing that breaks if source fails)
- `links[].dep` — which attribute created this dependency e.g. `vpc_id`, `subnet_id`

---

### POST `/api/simulate`

Runs BFS failure simulation and fires 3 AI agents.

**Request body:**
```json
{
  "node_id": "aws_vpc.main",
  "failure_type": "outage"
}
```

**Field definitions:**
- `node_id` — must match an `id` from `/api/graph` nodes
- `failure_type` — one of: `"outage"`, `"data_leak"`, `"degraded"`

**Response `200`:**
```json
{
  "blast_radius": {
    "failed_node": "aws_vpc.main",
    "failure_type": "outage",
    "metrics": {
      "affected_count": 20,
      "critical_path_depth": 2,
      "surviving_fragments_count": 1
    },
    "affected_pathway": {
      "aws_vpc.main":            { "depth": 0, "type": "aws_vpc" },
      "aws_subnet.public_a":     { "depth": 1, "type": "aws_subnet" },
      "aws_subnet.public_b":     { "depth": 1, "type": "aws_subnet" },
      "aws_security_group.alb":  { "depth": 1, "type": "aws_security_group" },
      "aws_lb.main":             { "depth": 2, "type": "aws_lb" },
      "aws_db_instance.postgres":{ "depth": 2, "type": "aws_db_instance" }
    }
  },
  "agents": {
    "Reliability": {
      "downtime_estimate_minutes": 45,
      "critical_spofs": ["aws_vpc.main", "aws_db_instance.postgres"]
    },
    "Security": {
      "exposure_risk_level": "High",
      "iam_sg_warnings": ["Security group preflight-alb-sg allows 0.0.0.0/0 on port 80"]
    },
    "Cost": {
      "orphaned_resource_cost_estimate": 340,
      "financial_impact_summary": "RDS multi-AZ and ALB incur costs even during outage. Estimated $340 orphaned spend."
    }
  }
}
```

**Field definitions:**
- `blast_radius.affected_pathway` — object keyed by node id, value has `depth` (BFS layer) and `type`
- `blast_radius.metrics.affected_count` — total number of nodes in blast radius including origin
- `blast_radius.metrics.critical_path_depth` — max BFS depth reached
- `agents.Reliability.downtime_estimate_minutes` — integer
- `agents.Reliability.critical_spofs` — array of node id strings
- `agents.Security.exposure_risk_level` — exactly one of: `"Low"`, `"Medium"`, `"High"`
- `agents.Security.iam_sg_warnings` — array of strings
- `agents.Cost.orphaned_resource_cost_estimate` — integer (USD)
- `agents.Cost.financial_impact_summary` — string

**Error `400`:**
```json
{ "detail": "Node aws_xyz.foo not found in graph." }
```

---

### POST `/api/upload`

Accepts a .tf file, regenerates the graph from it.

**Request:** `multipart/form-data` with field named `file` containing the .tf file.

**Response `200`:** Same shape as `/api/graph`

```json
{
  "nodes": [ ... ],
  "links": [ ... ]
}
```

**Error `400`:**
```json
{ "detail": "Invalid Terraform configuration uploaded." }
```

---

## CORS

Backend allows all origins (`*`) during development.
Frontend always calls `http://localhost:8000` — never hardcode any other URL.

---

## Frontend Animation Contract

When `/api/simulate` returns, the frontend animates BFS like this:

```
for each node_id in blast_radius.affected_pathway:
    depth = blast_radius.affected_pathway[node_id].depth
    after (depth * 600) milliseconds: color node red
```

Depth 0 = the clicked node, turns red immediately.
Depth 1 = turns red after 600ms.
Depth 2 = turns red after 1200ms.

---

## Node Color States (Frontend)

| State    | Color   | Hex       | Trigger                        |
|----------|---------|-----------|--------------------------------|
| Default  | Blue    | `#4488ff` | Initial load                   |
| Selected | Yellow  | `#ffaa00` | User clicks node               |
| Failed   | Red     | `#ff4444` | In blast_radius.affected_pathway |
| Safe     | Green   | `#44ff88` | Loaded but NOT in blast radius |

After simulation: failed nodes = red, surviving nodes = green, then reset clears all back to blue.

---

## What Backend Must Never Change Without Telling Frontend

1. The key names in `affected_pathway` (used for animation)
2. The `agents.Reliability`, `agents.Security`, `agents.Cost` top-level keys
3. The `nodes[].id` field name (used as graph node identifier)
4. The `links[].source` and `links[].target` field names (used by react-force-graph-2d)

## What Frontend Must Never Change Without Telling Backend

1. The field name `node_id` in the simulate request body
2. The field name `failure_type` in the simulate request body
3. The field name `file` in the upload form data
