import unittest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from main import app

class TestBackend(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_get_graph(self):
        """Test the graph endpoint returns nodes and links properly formatted."""
        response = self.client.get("/api/graph")
        self.assertEqual(response.status_code, 200)
        
        data = response.json()
        self.assertIn("nodes", data)
        self.assertIn("links", data)
        
        self.assertTrue(len(data["nodes"]) > 0, "Expected at least one node")
        self.assertTrue(len(data["links"]) > 0, "Expected at least one link")
        
        # Check node structure
        first_node = data["nodes"][0]
        self.assertIn("id", first_node)
        self.assertIn("type", first_node)
        self.assertIn("label", first_node)

    @patch("main.analyze_scenario", new_callable=AsyncMock)
    def test_simulate_success(self, mock_analyze):
        """Test the simulate endpoint with a mocked AI agent response."""
        # Mock the AI agents' response to avoid hitting Fireworks API and causing 404/500
        mock_analyze.return_value = {
            "Reliability": {
                "downtime_estimate_minutes": 45,
                "critical_spofs": ["aws_vpc.main"]
            },
            "Security": {
                "exposure_risk_level": "High",
                "iam_sg_warnings": ["Security group issue detected"]
            },
            "Cost": {
                "orphaned_resource_cost_estimate": 340,
                "financial_impact_summary": "Test cost impact"
            }
        }
        
        response = self.client.post(
            "/api/simulate",
            json={"node_id": "aws_vpc.main", "failure_type": "outage"}
        )
        self.assertEqual(response.status_code, 200, response.text)
        
        data = response.json()
        
        # Validate exact shape based on API_CONTRACT.md
        self.assertIn("blast_radius", data)
        self.assertIn("affected_pathway", data["blast_radius"])
        self.assertIn("agents", data)
        
        # Check mock data propagated
        agents = data["agents"]
        self.assertEqual(agents["Reliability"]["downtime_estimate_minutes"], 45)
        self.assertEqual(agents["Security"]["exposure_risk_level"], "High")

    def test_simulate_invalid_node(self):
        """Test simulate with an invalid node id."""
        response = self.client.post(
            "/api/simulate",
            json={"node_id": "invalid_node_id_123", "failure_type": "outage"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("not found", response.json().get("detail", "").lower())

if __name__ == "__main__":
    unittest.main(verbosity=2)
