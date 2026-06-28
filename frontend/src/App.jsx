import React, { useState, useEffect, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

export default function App() {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [nodeStates, setNodeStates] = useState({}); // id -> 'failed' | 'safe'
  const [agentsData, setAgentsData] = useState(null);
  const [failureType, setFailureType] = useState('outage');
  const [dimensions, setDimensions] = useState({ width: window.innerWidth * 0.7, height: window.innerHeight });

  const graphRef = useRef();

  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth * 0.7, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    fetch('http://localhost:8000/api/graph')
      .then(res => res.json())
      .then(data => {
        setGraphData(data);
      })
      .catch(err => console.error("Failed to fetch graph:", err));
  }, []);

  const handleNodeClick = useCallback(node => {
    setSelectedNode(node.id);
  }, []);

  const simulateFailure = async () => {
    if (!selectedNode) return;
    try {
      const res = await fetch('http://localhost:8000/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: selectedNode, failure_type: failureType })
      });
      const data = await res.json();
      
      const affected = data.blast_radius.affected_pathway;
      let maxDepth = 0;
      
      Object.entries(affected).forEach(([nodeId, info]) => {
        if (info.depth > maxDepth) maxDepth = info.depth;
        setTimeout(() => {
          setNodeStates(prev => ({ ...prev, [nodeId]: 'failed' }));
        }, info.depth * 600);
      });

      setTimeout(() => {
        setNodeStates(prev => {
          const next = { ...prev };
          graphData.nodes.forEach(n => {
            if (!affected[n.id]) {
              next[n.id] = 'safe';
            }
          });
          return next;
        });
        setAgentsData(data.agents);
      }, (maxDepth * 600) + 600);
      
    } catch (err) {
      console.error("Simulation failed:", err);
    }
  };

  const handleReset = () => {
    setNodeStates({});
    setAgentsData(null);
  };

  const drawNode = useCallback((node, ctx, globalScale) => {
    const label = node.id;
    const fontSize = 12 / globalScale;
    ctx.font = `${fontSize}px Inter, sans-serif`;
    
    let color = '#4488ff';
    if (selectedNode === node.id) color = '#ffaa00';
    if (nodeStates[node.id] === 'failed') color = '#ff4444';
    else if (nodeStates[node.id] === 'safe') color = '#44ff88';

    // Glow effect
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    
    ctx.beginPath();
    ctx.arc(node.x, node.y, 6, 0, 2 * Math.PI, false);
    ctx.fillStyle = color;
    ctx.fill();

    // Reset shadow for text
    ctx.shadowBlur = 0;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText(label, node.x, node.y + 10);
  }, [selectedNode, nodeStates]);

  return (
    <div style={styles.container}>
      <div style={styles.leftPanel}>
        <ForceGraph2D
          ref={graphRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          nodeCanvasObject={drawNode}
          nodeCanvasObjectMode={() => 'replace'}
          d3Force="charge"
          d3ForceArgs={[-300]}
          linkDirectionalArrowLength={3.5}
          linkDirectionalArrowRelPos={1}
          linkColor={() => 'rgba(255, 255, 255, 0.2)'}
          onNodeClick={handleNodeClick}
          backgroundColor="#0f0f1a"
        />
      </div>

      <div style={styles.rightPanel}>
        <div style={styles.sidebarContent}>
          <h1 style={styles.title}>Preflight AI</h1>
          <p style={styles.subtitle}>Infrastructure Risk Engine</p>

          <div style={styles.controlGroup}>
            <div style={styles.label}>Selected Node</div>
            <div style={styles.selectedNodeBox}>
              {selectedNode ? selectedNode : 'Click a node to select'}
            </div>
          </div>

          <div style={styles.controlGroup}>
            <div style={styles.label}>Failure Scenario</div>
            <select 
              value={failureType} 
              onChange={(e) => setFailureType(e.target.value)}
              style={styles.select}
            >
              <option value="outage">Outage</option>
              <option value="data_leak">Data Leak</option>
              <option value="degraded">Degraded Performance</option>
            </select>
          </div>

          <div style={styles.buttonGroup}>
            <button 
              onClick={simulateFailure} 
              disabled={!selectedNode}
              style={{...styles.button, opacity: selectedNode ? 1 : 0.5}}
            >
              Simulate Failure
            </button>
            <button onClick={handleReset} style={styles.resetButton}>
              Reset
            </button>
          </div>

          {agentsData && (
            <div style={styles.cardsContainer}>
              <div style={styles.card}>
                <div style={styles.cardHeader}>
                  <div style={styles.cardIcon}>⚡</div>
                  Reliability
                </div>
                <div style={styles.cardBody}>
                  <p><strong>Downtime:</strong> {agentsData.Reliability.downtime_estimate_minutes} mins</p>
                  <p><strong>SPOFs:</strong> {agentsData.Reliability.critical_spofs?.join(', ') || 'None'}</p>
                </div>
              </div>

              <div style={styles.card}>
                <div style={styles.cardHeader}>
                  <div style={styles.cardIcon}>🛡️</div>
                  Security
                </div>
                <div style={styles.cardBody}>
                  <p><strong>Risk Level:</strong> {agentsData.Security.exposure_risk_level}</p>
                  <p><strong>Warnings:</strong></p>
                  <ul style={styles.list}>
                    {agentsData.Security.iam_sg_warnings?.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              </div>

              <div style={styles.card}>
                <div style={styles.cardHeader}>
                  <div style={styles.cardIcon}>💰</div>
                  Cost
                </div>
                <div style={styles.cardBody}>
                  <p><strong>Orphaned Cost:</strong> ${agentsData.Cost.orphaned_resource_cost_estimate}</p>
                  <p style={{fontSize: '0.85rem', color: '#aaa'}}>{agentsData.Cost.financial_impact_summary}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    width: '100vw',
    height: '100vh',
    backgroundColor: '#0f0f1a',
    color: '#ffffff',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    overflow: 'hidden'
  },
  leftPanel: {
    width: '70%',
    height: '100%',
    position: 'relative'
  },
  rightPanel: {
    width: '30%',
    height: '100%',
    backgroundColor: 'rgba(20, 20, 30, 0.95)',
    borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
    boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
    overflowY: 'auto'
  },
  sidebarContent: {
    padding: '30px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  title: {
    margin: '0 0 5px 0',
    fontSize: '24px',
    fontWeight: '600',
    background: 'linear-gradient(90deg, #4488ff, #ffaa00)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent'
  },
  subtitle: {
    margin: '0 0 20px 0',
    fontSize: '14px',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '1px'
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  label: {
    fontSize: '13px',
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  selectedNodeBox: {
    padding: '12px 15px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '6px',
    fontSize: '14px',
    color: '#ffaa00',
    fontWeight: '500'
  },
  select: {
    padding: '12px 15px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none'
  },
  buttonGroup: {
    display: 'flex',
    gap: '10px',
    marginTop: '10px'
  },
  button: {
    flex: 2,
    padding: '12px',
    backgroundColor: '#4488ff',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 4px 15px rgba(68, 136, 255, 0.3)'
  },
  resetButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  cardsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
    marginTop: '20px',
    animation: 'fadeIn 0.5s ease-out'
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '8px',
    padding: '15px',
    backdropFilter: 'blur(10px)'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '15px',
    fontWeight: '600',
    marginBottom: '10px',
    color: '#ddd'
  },
  cardIcon: {
    fontSize: '18px'
  },
  cardBody: {
    fontSize: '14px',
    color: '#ccc',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  list: {
    margin: '0',
    paddingLeft: '20px',
    color: '#ffaa00',
    fontSize: '13px'
  }
};
