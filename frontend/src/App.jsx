import React, { useState, useEffect, useRef, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';

const createGlowTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.5)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
};
const glowTexture = createGlowTexture();

export default function App() {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [nodeStates, setNodeStates] = useState({}); // id -> 'failed' | 'safe'
  const [agentsData, setAgentsData] = useState(null);
  const [failureType, setFailureType] = useState('outage');
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const [simulationStarted, setSimulationStarted] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const graphRef = useRef();
  const fileInputRef = useRef(null);

  const handleZoomIn = () => {
    if (graphRef.current) {
      const { x, y, z } = graphRef.current.cameraPosition();
      graphRef.current.cameraPosition({ x: x * 0.7, y: y * 0.7, z: z * 0.7 }, null, 300);
    }
  };

  const handleZoomOut = () => {
    if (graphRef.current) {
      const { x, y, z } = graphRef.current.cameraPosition();
      graphRef.current.cameraPosition({ x: x * 1.4, y: y * 1.4, z: z * 1.4 }, null, 300);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    fetch('http://localhost:8000/api/upload', {
      method: 'POST',
      body: formData,
    })
      .then(res => {
        if (!res.ok) throw new Error("Backend validation failed.");
        return res.json();
      })
      .then(data => {
        setGraphData(data);
        setIsUploading(false);
      })
      .catch(err => {
        console.error("Upload failed:", err);
        alert("Upload failed. Ensure the Terraform syntax is valid and try again.");
        setIsUploading(false);
      });
  };

  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    fetch('http://localhost:8000/api/graph')
      .then(res => res.json())
      .then(data => {
        setGraphData(data);
        // Ensure the camera starts closer rather than fully zoomed out
        setTimeout(() => {
          if (graphRef.current) {
            // Move camera to z: 300 over 1.5 seconds, looking at the origin
            graphRef.current.cameraPosition({ z: 300 }, { x: 0, y: 0, z: 0 }, 1500);
          }
        }, 200);
      })
      .catch(err => console.error("Failed to fetch graph:", err));
  }, []);

  const focusNode = useCallback(node => {
    setSelectedNode(node.id);
    setSimulationStarted(false); 
    
    if (graphRef.current) {
      const distance = 50;
      const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z);

      graphRef.current.cameraPosition(
        { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
        node, 
        2000
      );
    }
  }, []);

  const simulateFailure = async () => {
    if (!selectedNode) return;
    setSimulationStarted(true);
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
    setSelectedNode(null);
    setSimulationStarted(false);
    setSearchQuery('');
  };

  const drawNode = useCallback((node) => {
    let colorStr = '#00F0FF'; 
    if (selectedNode === node.id) colorStr = '#D946EF'; 
    if (nodeStates[node.id] === 'failed') colorStr = '#FF2A2A'; 
    else if (nodeStates[node.id] === 'safe') colorStr = '#00FFAA'; 
    
    const color = new THREE.Color(colorStr);
    const group = new THREE.Group();

    // Core Sphere
    const geometry = new THREE.SphereGeometry(4, 32, 32);
    const material = new THREE.MeshPhysicalMaterial({ 
      color: color, 
      transmission: 0.1,
      opacity: 0.95,
      transparent: true,
      roughness: 0.2,
      metalness: 0.8,
      emissive: color,
      emissiveIntensity: 1.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1
    });
    const sphere = new THREE.Mesh(geometry, material);
    group.add(sphere);

    // Additive Halo Sprite
    const spriteMaterial = new THREE.SpriteMaterial({ 
      map: glowTexture, 
      color: color, 
      transparent: true, 
      blending: THREE.AdditiveBlending,
      opacity: selectedNode === node.id ? 1.0 : 0.6
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(22, 22, 1);
    group.add(sprite);

    // Text Sprite
    const textSprite = new SpriteText(node.id);
    textSprite.color = 'rgba(255, 255, 255, 0.85)';
    textSprite.textHeight = 3.0; // Increased from 1.5
    textSprite.fontWeight = '500';
    textSprite.fontFace = 'Saira, sans-serif'; // Changed font
    textSprite.position.set(0, -9, 0); // Adjusted position for larger text
    group.add(textSprite);

    return group;
  }, [selectedNode, nodeStates]);

  const selectedNodeData = selectedNode ? graphData.nodes.find(n => n.id === selectedNode) : null;
  const filteredNodes = graphData.nodes.filter(n => n.id.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 5);

  return (
    <div style={styles.container}>
      <div style={styles.graphContainer}>
        <ForceGraph3D
          ref={graphRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          nodeThreeObject={drawNode}
          nodeThreeObjectResolution={8}
          nodeLabel="id"
          d3Force="charge"
          d3ForceArgs={[-400]}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkColor={() => 'rgba(255, 255, 255, 0.45)'} // Increased opacity from 0.15 for better visibility
          onNodeClick={focusNode}
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
        />
        
        {/* Floating Resource Details Card */}
        {selectedNodeData && !simulationStarted && (
          <div style={styles.floatingResourceCard}>
            <div style={styles.cardGlowPurple}></div>
            <div style={styles.cardInner}>
              <div style={styles.cardHeader}>
                Target Acquired
              </div>
              <div style={styles.cardBody}>
                <p style={styles.dataRow}>
                  <span style={styles.dataLabel}>Resource ID:</span>
                </p>
                <p style={{...styles.dataValue, color: '#D946EF', fontSize: '15px', marginBottom: '8px', wordBreak: 'break-all'}}>
                  {selectedNodeData.id}
                </p>
                <p style={styles.dataRow}>
                  <span style={styles.dataLabel}>Type:</span>
                  <span style={styles.tag}>{selectedNodeData.type}</span>
                </p>
                <p style={{...styles.insightText, marginTop: '10px'}}>
                  Ready to simulate blast radius on this resource.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Zoom Controls */}
        <div style={styles.zoomControls}>
          <button style={styles.zoomButton} onClick={handleZoomIn}>+</button>
          <button style={styles.zoomButton} onClick={handleZoomOut}>-</button>
        </div>
      </div>

      <div style={styles.hudSidebar}>
        <div style={styles.hudContent}>
          
          <div style={styles.header}>
            <div style={styles.logoGlow}>
              <h1 style={styles.title}>Preflight AI</h1>
            </div>
          </div>
          <p style={styles.subtitle}>Infrastructure Risk Engine</p>

          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            style={{ display: 'none' }} 
            accept=".tf"
          />
          <button 
            style={styles.uploadButton}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? 'UPLOADING...' : 'UPLOAD TERRAFORM (.tf)'}
          </button>

          <div style={styles.divider}></div>

          {/* Search Bar Implementation */}
          <div style={{position: 'relative', zIndex: 20}}>
            <input 
              type="text" 
              placeholder="Search resource ID..." 
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              style={styles.searchInput}
            />
            {showDropdown && searchQuery && filteredNodes.length > 0 && (
              <div style={styles.searchDropdown}>
                {filteredNodes.map(node => (
                  <div 
                    key={node.id} 
                    style={styles.searchItem}
                    onMouseDown={(e) => {
                      e.preventDefault(); // Prevent input onBlur from firing first
                      setSearchQuery('');
                      setShowDropdown(false);
                      focusNode(node);
                    }}
                  >
                    {node.id}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={styles.controlGroup}>
            <div style={styles.label}>Selected Target</div>
            <div style={{...styles.selectedNodeBox, borderColor: selectedNode ? '#D946EF' : 'rgba(255,255,255,0.1)', boxShadow: selectedNode ? '0 0 15px rgba(217, 70, 239, 0.2)' : 'none'}}>
              {selectedNode ? selectedNode : 'Awaiting Selection...'}
            </div>
          </div>

          <div style={styles.controlGroup}>
            <div style={styles.label}>Simulation Profile</div>
            <select 
              value={failureType} 
              onChange={(e) => setFailureType(e.target.value)}
              style={styles.select}
            >
              <option value="outage">System Outage</option>
              <option value="data_leak">Data Leakage</option>
              <option value="degraded">Degraded Performance</option>
            </select>
          </div>

          <div style={styles.buttonGroup}>
            <button 
              onClick={simulateFailure} 
              disabled={!selectedNode}
              style={{
                ...styles.button, 
                opacity: selectedNode ? 1 : 0.4,
                cursor: selectedNode ? 'pointer' : 'not-allowed',
                animation: selectedNode ? 'pulseGlow 2s infinite' : 'none'
              }}
            >
              Initialize Simulation
            </button>
            <button onClick={handleReset} style={styles.resetButton}>
              Abort
            </button>
          </div>

          <div style={styles.divider}></div>

          {agentsData && (
            <div style={styles.cardsContainer}>
              <div style={styles.sectionTitle}>Agent Telemetry</div>
              
              <div style={styles.card}>
                <div style={styles.cardGlowBlue}></div>
                <div style={styles.cardInner}>
                  <div style={styles.cardHeader}>
                    Reliability Core
                  </div>
                  <div style={styles.cardBody}>
                    <p style={styles.dataRow}>
                      <span style={styles.dataLabel}>Downtime Est:</span>
                      <span style={styles.dataValue}>{agentsData.Reliability.downtime_estimate_minutes} mins</span>
                    </p>
                    <p style={styles.dataRowCol}>
                      <span style={styles.dataLabel}>Critical SPOFs:</span>
                    </p>
                    <div style={styles.tagsContainer}>
                      {agentsData.Reliability.critical_spofs?.length > 0 
                        ? agentsData.Reliability.critical_spofs.map((spof, i) => (
                          <span key={i} style={{...styles.tag, borderColor: '#FF2A2A', color: '#FF2A2A'}}>{spof}</span>
                        ))
                        : <span style={styles.tag}>None detected</span>
                      }
                    </div>
                    {agentsData.Reliability.cascading_impact_summary && (
                      <p style={styles.insightText}><strong>Impact:</strong> {agentsData.Reliability.cascading_impact_summary}</p>
                    )}
                    {agentsData.Reliability.mitigation_steps?.length > 0 && (
                      <div style={{marginTop: '4px'}}>
                        <span style={styles.dataLabel}>Mitigation Steps:</span>
                        <ul style={{...styles.list, color: '#3B82F6', textShadow: 'none'}}>
                          {agentsData.Reliability.mitigation_steps.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={styles.card}>
                <div style={styles.cardGlowPurple}></div>
                <div style={styles.cardInner}>
                  <div style={styles.cardHeader}>
                    Security Core
                  </div>
                  <div style={styles.cardBody}>
                    <p style={styles.dataRow}>
                      <span style={styles.dataLabel}>Risk Level:</span>
                      <span style={{
                        ...styles.dataValue, 
                        color: agentsData.Security.exposure_risk_level === 'High' ? '#FF2A2A' : '#F59E0B',
                        textShadow: agentsData.Security.exposure_risk_level === 'High' ? '0 0 10px rgba(255, 42, 42, 0.8)' : 'none'
                      }}>
                        {agentsData.Security.exposure_risk_level}
                      </span>
                    </p>
                    <p style={styles.dataRowCol}>
                      <span style={styles.dataLabel}>Alerts:</span>
                    </p>
                    <ul style={styles.list}>
                      {agentsData.Security.iam_sg_warnings?.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                    {agentsData.Security.attack_vectors && (
                      <p style={styles.insightText}><strong>Attack Vector:</strong> {agentsData.Security.attack_vectors}</p>
                    )}
                    {agentsData.Security.compliance_violations?.length > 0 && (
                      <div style={{marginTop: '4px'}}>
                        <span style={styles.dataLabel}>Compliance Risks:</span>
                        <div style={styles.tagsContainer}>
                          {agentsData.Security.compliance_violations.map((v, i) => (
                            <span key={i} style={{...styles.tag, borderColor: '#F59E0B', color: '#F59E0B'}}>{v}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={styles.card}>
                <div style={styles.cardGlowGreen}></div>
                <div style={styles.cardInner}>
                  <div style={styles.cardHeader}>
                    Financial Core
                  </div>
                  <div style={styles.cardBody}>
                    <p style={styles.dataRow}>
                      <span style={styles.dataLabel}>Orphaned Spend:</span>
                      <span style={{...styles.dataValue, fontSize: '18px', color: '#00FFAA', textShadow: '0 0 10px rgba(0,255,170,0.5)'}}>
                        ${agentsData.Cost.orphaned_resource_cost_estimate}
                      </span>
                    </p>
                    <p style={styles.dataRow}>
                      <span style={styles.dataLabel}>Hourly Burn Rate:</span>
                      <span style={{...styles.dataValue, color: '#F59E0B'}}>
                        ${agentsData.Cost.hourly_burn_rate || 0}/hr
                      </span>
                    </p>
                    <p style={styles.insightText}>{agentsData.Cost.financial_impact_summary}</p>
                  </div>
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
    width: '100vw',
    height: '100vh',
    position: 'relative',
    overflow: 'hidden'
  },
  graphContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: 1
  },
  hudSidebar: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    width: '380px',
    maxHeight: 'calc(100vh - 40px)',
    zIndex: 10,
    backgroundColor: 'rgba(15, 15, 20, 0.5)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '16px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
    overflowY: 'auto',
    animation: 'floatHUD 6s ease-in-out infinite'
  },
  hudContent: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px'
  },
  logoGlow: {
    textShadow: '0 0 15px rgba(255, 255, 255, 0.5)'
  },
  title: {
    margin: '0',
    fontSize: '22px',
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: '0.5px'
  },
  proBadge: {
    backgroundColor: 'rgba(217, 70, 239, 0.2)',
    border: '1px solid #D946EF',
    color: '#D946EF',
    fontSize: '10px',
    fontWeight: '800',
    padding: '3px 8px',
    borderRadius: '6px',
    letterSpacing: '1px',
    boxShadow: '0 0 10px rgba(217, 70, 239, 0.4)'
  },
  subtitle: {
    margin: '-12px 0 0 0',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '500',
    letterSpacing: '1px',
    textTransform: 'uppercase'
  },
  divider: {
    height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
    margin: '4px 0'
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  label: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '1px'
  },
  selectedNodeBox: {
    padding: '12px 16px',
    backgroundColor: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#ffffff',
    fontWeight: '500',
    transition: 'all 0.3s ease'
  },
  select: {
    padding: '12px 16px',
    backgroundColor: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '500',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23FFFFFF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 14px top 50%',
    backgroundSize: '10px auto',
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    marginTop: '8px'
  },
  button: {
    flex: 3,
    padding: '14px',
    backgroundColor: '#3B82F6',
    border: '1px solid #60A5FA',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  resetButton: {
    flex: 1,
    padding: '14px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.8)',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    textTransform: 'uppercase'
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#ffffff',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginTop: '8px'
  },
  cardsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    animation: 'fadeIn 0.4s ease-out'
  },
  card: {
    position: 'relative',
    borderRadius: '12px',
    overflow: 'hidden',
    padding: '1px', // for the gradient border effect
  },
  cardGlowBlue: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.4) 0%, rgba(0,0,0,0) 100%)',
    zIndex: 0
  },
  cardGlowPurple: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'linear-gradient(135deg, rgba(217, 70, 239, 0.4) 0%, rgba(0,0,0,0) 100%)',
    zIndex: 0
  },
  cardGlowGreen: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'linear-gradient(135deg, rgba(0, 255, 170, 0.4) 0%, rgba(0,0,0,0) 100%)',
    zIndex: 0
  },
  cardInner: {
    position: 'relative',
    zIndex: 1,
    backgroundColor: 'rgba(10, 10, 12, 0.9)',
    borderRadius: '11px',
    padding: '16px'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '15px',
    fontWeight: '700',
    marginBottom: '12px',
    color: '#ffffff',
    letterSpacing: '0.5px'
  },
  cardIcon: {
    fontSize: '18px'
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  dataRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: '0'
  },
  dataRowCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    margin: '0'
  },
  dataLabel: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500'
  },
  dataValue: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#ffffff'
  },
  tagsContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px'
  },
  tag: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '11px',
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
    letterSpacing: '0.5px'
  },
  list: {
    margin: '0',
    paddingLeft: '20px',
    color: '#FF2A2A',
    fontSize: '12px',
    lineHeight: '1.5',
    textShadow: '0 0 8px rgba(255, 42, 42, 0.4)'
  },
  insightText: {
    margin: '4px 0 0 0',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.6)',
    lineHeight: '1.5'
  },
  floatingResourceCard: {
    position: 'absolute',
    left: '40px',
    bottom: '40px',
    width: '320px',
    zIndex: 10,
    borderRadius: '12px',
    padding: '1px',
    animation: 'fadeIn 0.4s ease-out, floatHUD 6s ease-in-out infinite'
  },
  searchInput: {
    width: '100%',
    padding: '14px 16px',
    backgroundColor: 'rgba(0,0,0,0.4)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '500',
    outline: 'none',
    transition: 'all 0.3s ease',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
  },
  searchDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: '4px',
    backgroundColor: 'rgba(15, 15, 20, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    maxHeight: '200px',
    overflowY: 'auto',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(10px)',
  },
  searchItem: {
    padding: '12px 16px',
    color: 'rgba(255,255,255,0.8)',
    fontSize: '13px',
    cursor: 'pointer',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    transition: 'all 0.2s ease',
  },
  zoomControls: {
    position: 'absolute',
    bottom: '40px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '10px',
    zIndex: 10,
  },
  zoomButton: {
    backgroundColor: 'rgba(20,20,25,0.8)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#fff',
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(10px)',
    transition: 'all 0.2s',
  },
  uploadButton: {
    width: '100%',
    padding: '10px',
    backgroundColor: 'transparent',
    border: '1px dashed rgba(255, 255, 255, 0.3)',
    color: 'rgba(255,255,255,0.8)',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    marginTop: '10px',
    fontFamily: 'Saira, sans-serif',
    transition: 'all 0.2s ease',
  }
};
