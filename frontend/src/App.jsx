import React, { useState, useEffect, useRef, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';

/* ---------------------------------------------------------------- */
/*  Backend API base                                                 */
/*  Set VITE_API_URL in an .env file to point at a deployed backend. */
/*  Falls back to the local FastAPI dev server on port 8000.         */
/* ---------------------------------------------------------------- */
const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';

/* ---------------------------------------------------------------- */
/*  Design tokens                                                    */
/* ---------------------------------------------------------------- */
const COLORS = {
  text: '#e6e8eb',
  textMuted: '#9ba1a9',
  textFaint: '#6b7178',
  accent: '#5b8def',
  danger: '#e5484d',
  safe: '#30a46c',
  warn: '#e0913f',
  selected: '#f5f6f8',
};

/* Resource category palette (muted, distinct, no red/green so state
   colors never clash with type colors). */
const CATEGORY = {
  compute:  { color: '#e8964f', label: 'Compute' },
  network:  { color: '#5b8def', label: 'Network' },
  storage:  { color: '#35b0a7', label: 'Storage / DB' },
  security: { color: '#c9a227', label: 'Security / IAM' },
  other:    { color: '#7c8591', label: 'Other' },
};

function categorize(type = '') {
  const t = type.toLowerCase();
  if (/(instance|lambda|ecs|eks|autoscaling|batch|fargate|launch|ec2|elastic_beanstalk)/.test(t)) return 'compute';
  if (/(vpc|subnet|route|gateway|nat|eip|lb|elb|alb|network|vpn|peering|endpoint|cloudfront|api_gateway|dns|route53)/.test(t)) return 'network';
  if (/(s3|ebs|efs|rds|dynamodb|db_|database|elasticache|redshift|glacier|bucket|volume|backup)/.test(t)) return 'storage';
  if (/(iam|security_group|kms|secret|acm|waf|cognito|policy|role)/.test(t)) return 'security';
  return 'other';
}

function typeColor(type) {
  return CATEGORY[categorize(type)].color;
}

/* Soft radial halo used sparingly (selected / failed only) */
const createGlowTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)');
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
  const [chaosData, setChaosData] = useState(null);
  const [isChaosRunning, setIsChaosRunning] = useState(false);
  const [failureType, setFailureType] = useState('outage');
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFailureDropdown, setShowFailureDropdown] = useState(false);
  const failureDropdownRef = useRef(null);

  const [simulationStarted, setSimulationStarted] = useState(false);
  const simulationStartedRef = useRef(false);
  const [isSimulating, setIsSimulating] = useState(false);
  useEffect(() => {
    simulationStartedRef.current = simulationStarted;
  }, [simulationStarted]);
  const [isUploading, setIsUploading] = useState(false);
  
  const [affectedNodesList, setAffectedNodesList] = useState([]);
  const [currentAffectedIndex, setCurrentAffectedIndex] = useState(-1);

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

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      body: formData,
    })
      .then(async res => {
        if (!res.ok) {
          // Surface the backend's real reason instead of always blaming syntax.
          let detail = `Backend responded with ${res.status}.`;
          try {
            const body = await res.json();
            if (body && body.detail) detail = body.detail;
          } catch { /* non-JSON error body */ }
          throw new Error(detail);
        }
        return res.json();
      })
      .then(data => {
        setGraphData(data);
        handleReset();
        setIsUploading(false);
      })
      .catch(err => {
        console.error('[v0] Upload failed:', err);
        // TypeError from fetch means the backend URL was never reached.
        const unreachable = err instanceof TypeError;
        alert(
          unreachable
            ? `Could not reach the backend at ${API_BASE}.\n\nMake sure the Python API is running (uvicorn main:app --port 8000) and, if you are viewing a hosted preview, set VITE_API_URL to your backend's public URL.`
            : `Upload failed: ${err.message}`
        );
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

  // Close failure dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (failureDropdownRef.current && !failureDropdownRef.current.contains(e.target)) {
        setShowFailureDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);



  const runChaosAnalysis = async () => {
    setIsChaosRunning(true);
    setChaosData(null);
    setAgentsData(null);
    setSelectedNode(null);
    setSimulationStarted(false);
    
    try {
      const res = await fetch(`${API_BASE}/api/chaos-simulate`, {
        method: 'POST',
      });
      const data = await res.json();
      setChaosData(data);
    } catch (err) {
      console.error('Chaos simulation failed:', err);
    } finally {
      setIsChaosRunning(false);
    }
  };

  const focusNode = useCallback((node, keepSimulation = false) => {
    // Block node selection changes while a simulation is active
    if (simulationStartedRef.current && !keepSimulation) return;

    setSelectedNode(node.id);
    if (!keepSimulation) {
      setSimulationStarted(false);
    }

    if (graphRef.current) {
      const distance = 50;
      const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);

      graphRef.current.cameraPosition(
        { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
        node,
        2000
      );
    }
  }, [simulationStarted]);

  const simulateFailure = async () => {
    if (!selectedNode) return;
    setSimulationStarted(true);
    setIsSimulating(true);
    try {
      const res = await fetch(`${API_BASE}/api/simulate`, {
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
        
        const sortedAffected = Object.keys(affected)
          .filter(id => id !== selectedNode)
          .sort((a, b) => affected[a].depth - affected[b].depth || a.localeCompare(b));
        setAffectedNodesList(sortedAffected);
        setCurrentAffectedIndex(-1);
        setIsSimulating(false);

      }, (maxDepth * 600) + 600);

    } catch (err) {
      console.error('Simulation failed:', err);
      setIsSimulating(false);
    }
  };

  const handleReset = () => {
    setNodeStates({});
    setAgentsData(null);
    setChaosData(null);
    setSelectedNode(null);
    setSimulationStarted(false);
    setIsSimulating(false);
    setSearchQuery('');
    setAffectedNodesList([]);
    setCurrentAffectedIndex(-1);
  };

  const handleNextAffected = () => {
    if (affectedNodesList.length === 0) return;
    const nextIndex = (currentAffectedIndex + 1) % affectedNodesList.length;
    setCurrentAffectedIndex(nextIndex);
    const nextNodeId = affectedNodesList[nextIndex];
    const node = graphData.nodes.find(n => n.id === nextNodeId);
    if (node) {
      focusNode(node, true);
    }
  };

  const drawNode = useCallback((node) => {
    const isSelected = selectedNode === node.id;
    const state = nodeStates[node.id];

    let baseColor = typeColor(node.type);
    if (state === 'failed') baseColor = COLORS.danger;
    else if (state === 'safe') baseColor = COLORS.safe;

    const color = new THREE.Color(baseColor);
    const group = new THREE.Group();

    // Core sphere — matte PBR with a gentle emissive lift, no heavy glow.
    const geometry = new THREE.SphereGeometry(4, 32, 32);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.45,
      metalness: 0.15,
      emissive: color,
      emissiveIntensity: isSelected || state === 'failed' ? 0.55 : 0.28,
    });
    const sphere = new THREE.Mesh(geometry, material);
    group.add(sphere);

    // Selection ring — a clean thin torus, not a glow blob.
    if (isSelected) {
      const ringGeo = new THREE.TorusGeometry(6.4, 0.28, 12, 48);
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.selected) });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      group.add(ring);
    }

    // Subtle halo only for states that need attention.
    if (isSelected || state === 'failed') {
      const spriteMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: state === 'failed' ? new THREE.Color(COLORS.danger) : color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        opacity: 0.32,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.scale.set(16, 16, 1);
      group.add(sprite);
    }

    // Label
    const textSprite = new SpriteText(node.id);
    textSprite.color = isSelected ? 'rgba(245,246,248,0.95)' : 'rgba(230,232,235,0.6)';
    textSprite.textHeight = 2.6;
    textSprite.fontWeight = '500';
    textSprite.fontFace = 'Inter, sans-serif';
    textSprite.position.set(0, -8.5, 0);
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
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          linkColor={() => 'rgba(255, 255, 255, 0.7)'}
          linkWidth={1.5}
          onNodeClick={(node) => focusNode(node)}
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
        />

        {/* Legend */}
        <div style={styles.legend}>
          <div style={styles.legendTitle}>Resource types</div>
          {Object.values(CATEGORY).map(c => (
            <div key={c.label} style={styles.legendRow}>
              <span style={{ ...styles.legendDot, backgroundColor: c.color }} />
              <span style={styles.legendLabel}>{c.label}</span>
            </div>
          ))}
          <div style={styles.legendSep} />
          <div style={styles.legendRow}>
            <span style={{ ...styles.legendDot, backgroundColor: COLORS.danger }} />
            <span style={styles.legendLabel}>Impacted</span>
          </div>
          <div style={styles.legendRow}>
            <span style={{ ...styles.legendDot, backgroundColor: COLORS.safe }} />
            <span style={styles.legendLabel}>Unaffected</span>
          </div>
        </div>

        {/* Selected resource card */}
        {selectedNodeData && !simulationStarted && (
          <div style={styles.floatingResourceCard}>
            <div style={{ ...styles.accentBar, backgroundColor: typeColor(selectedNodeData.type) }} />
            <div style={styles.cardInner}>
              <div style={styles.cardEyebrow}>Selected resource</div>
              <p style={styles.resourceId}>{selectedNodeData.id}</p>
              <div style={styles.dataRow}>
                <span style={styles.dataLabel}>Type</span>
                <span style={{ ...styles.tag, borderColor: typeColor(selectedNodeData.type), color: typeColor(selectedNodeData.type) }}>
                  {selectedNodeData.type}
                </span>
              </div>
              <p style={styles.insightText}>Run a simulation to map the blast radius across dependent resources.</p>
            </div>
          </div>
        )}

        {/* Zoom controls */}
        <div style={styles.zoomControls}>
          <button style={styles.zoomButton} onClick={handleZoomIn} aria-label="Zoom in">+</button>
          <button style={styles.zoomButton} onClick={handleZoomOut} aria-label="Zoom out">&minus;</button>
        </div>
      </div>

      <div style={styles.hudSidebar}>
        <div style={styles.hudContent}>

          <div style={styles.header}>
            <h1 style={styles.title}>Preflight</h1>
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
            {isUploading ? 'Uploading…' : (graphData && graphData.nodes && graphData.nodes.length > 0 ? 'File uploaded' : 'Upload Terraform (.tf)')}
          </button>

          <div style={styles.divider} />

          {/* Chaos Lab Panel */}
          <div style={styles.chaosPanel}>
            <div style={styles.chaosHeader}>
              <span style={{ fontWeight: 700, color: COLORS.text }}>Chaos Lab (AMD MI300X)</span>
            </div>
            <button 
              onClick={runChaosAnalysis} 
              disabled={isChaosRunning || graphData.nodes.length === 0}
              style={{
                ...styles.button,
                width: '100%',
                backgroundColor: 'rgba(201, 162, 39, 0.15)',
                border: '1px solid rgba(201, 162, 39, 0.4)',
                color: '#c9a227',
                cursor: (isChaosRunning || graphData.nodes.length === 0) ? 'not-allowed' : 'pointer',
              }}
            >
              {isChaosRunning ? 'Simulating failures...' : 'Run Full Chaos Analysis'}
            </button>
            
            {chaosData && (
              <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={styles.label}>Highest Risk Scenarios</div>
                {(chaosData.top_scenarios || []).map((scenario, idx) => (
                  <div key={idx} style={{ ...styles.cardInner, backgroundColor: 'rgba(0,0,0,0.2)', padding: '12px' }}>
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.danger }}>Risk {scenario.risk_score}</span>
                       <span style={styles.badge}>{scenario.failure_type}</span>
                     </div>
                     <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', margin: '6px 0', color: COLORS.text }}>
                       {scenario.resource}
                     </div>
                     <div style={{ fontSize: '12px', color: COLORS.textMuted, lineHeight: '1.4' }}>
                       {(chaosData.explanations || {})[scenario.resource] || `${scenario.affected_count} resources affected.`}
                     </div>
                  </div>
                ))}
                
                <div style={styles.label}>Suggested Fixes</div>
                {(chaosData.recommendations || []).map((rec, idx) => (
                  <div key={idx} style={{ ...styles.cardInner, backgroundColor: 'rgba(48, 164, 108, 0.08)', border: '1px solid rgba(48,164,108,0.2)', padding: '12px' }}>
                     <div style={{ fontSize: '13px', fontWeight: 600, color: COLORS.safe }}>{rec.title}</div>
                     <div style={{ fontSize: '12px', color: COLORS.textMuted, margin: '6px 0', lineHeight: '1.4' }}>{rec.description}</div>
                     <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.text }}>
                       Est. Risk Reduction: {rec.estimated_risk_reduction_pct}%
                     </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={styles.divider} />

          {/* Search */}
          <div style={{ position: 'relative', zIndex: 20 }}>
            <input
              type="text"
              placeholder="Search resource ID…"
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
                      e.preventDefault();
                      setSearchQuery('');
                      setShowDropdown(false);
                      focusNode(node);
                    }}
                  >
                    <span style={{ ...styles.legendDot, backgroundColor: typeColor(node.type) }} />
                    {node.id}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={styles.controlGroup}>
            <div style={styles.label}>Selected resource</div>
            <div style={{
              ...styles.selectedNodeBox,
              borderColor: selectedNode ? 'rgba(91,141,239,0.5)' : 'rgba(255,255,255,0.08)',
              color: selectedNode ? COLORS.text : COLORS.textFaint,
            }}>
              {selectedNode ? selectedNode : 'No resource selected'}
            </div>
          </div>

          <div style={styles.controlGroup}>
            <div style={styles.label}>Failure scenario</div>
            <div ref={failureDropdownRef} style={{ position: 'relative' }}>
              <div
                onClick={() => setShowFailureDropdown(!showFailureDropdown)}
                style={{
                  ...styles.select,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderColor: showFailureDropdown ? 'rgba(91,141,239,0.5)' : 'rgba(255,255,255,0.08)',
                }}
              >
                <span>{{ outage: 'System outage', data_leak: 'Data leakage', degraded: 'Degraded performance' }[failureType]}</span>
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ transition: 'transform 0.2s ease', transform: showFailureDropdown ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  <path d="M1 1L5 5L9 1" stroke="#9ba1a9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              {showFailureDropdown && (
                <div style={styles.customDropdownMenu}>
                  {[{ value: 'outage', label: 'System outage' }, { value: 'data_leak', label: 'Data leakage' }, { value: 'degraded', label: 'Degraded performance' }].map((opt) => (
                    <div
                      key={opt.value}
                      onClick={() => { setFailureType(opt.value); setShowFailureDropdown(false); }}
                      style={{
                        ...styles.customDropdownItem,
                        backgroundColor: failureType === opt.value ? 'rgba(91,141,239,0.15)' : 'transparent',
                        color: failureType === opt.value ? '#7da8ff' : COLORS.text,
                      }}
                      onMouseEnter={(e) => { if (failureType !== opt.value) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = failureType === opt.value ? 'rgba(91,141,239,0.15)' : 'transparent'; }}
                    >
                      <span>{opt.label}</span>
                      {failureType === opt.value && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 'auto' }}>
                          <path d="M3 7L6 10L11 4" stroke="#5b8def" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={styles.buttonGroup}>
            {simulationStarted ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  onClick={handleReset}
                  style={{
                    ...styles.button,
                    backgroundColor: COLORS.danger,
                    cursor: 'pointer',
                  }}
                >
                  Stop simulation
                </button>
                {isSimulating && (
                  <div className="loader">
                    <div className="bar1"></div><div className="bar2"></div><div className="bar3"></div><div className="bar4"></div>
                    <div className="bar5"></div><div className="bar6"></div><div className="bar7"></div><div className="bar8"></div>
                    <div className="bar9"></div><div className="bar10"></div><div className="bar11"></div><div className="bar12"></div>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={simulateFailure}
                disabled={!selectedNode}
                style={{
                  ...styles.button,
                  opacity: selectedNode ? 1 : 0.45,
                  cursor: selectedNode ? 'pointer' : 'not-allowed',
                }}
              >
                Run simulation (FIREWORKS API)
              </button>
            )}
            <button onClick={handleReset} style={styles.resetButton}>
              Reset
            </button>
          </div>

          {affectedNodesList.length > 0 && (
            <div style={{ marginTop: '4px' }}>
              <button 
                onClick={handleNextAffected} 
                style={{ 
                  ...styles.button, 
                  width: '100%', 
                  backgroundColor: 'rgba(224, 145, 63, 0.15)', 
                  border: `1px solid rgba(224, 145, 63, 0.4)`, 
                  color: COLORS.warn 
                }}
              >
                Next Affected Node {currentAffectedIndex !== -1 ? `(${currentAffectedIndex + 1}/${affectedNodesList.length})` : ''} &rarr;
              </button>
            </div>
          )}

          <div style={styles.divider} />

          {agentsData && (
            <div style={styles.cardsContainer}>
              <div style={styles.sectionTitle}>Analysis</div>

              {/* Reliability */}
              <div style={styles.card}>
                <div style={{ ...styles.accentBar, backgroundColor: COLORS.accent }} />
                <div style={styles.cardInner}>
                  <div style={styles.cardHeader}>
                    <span style={{ ...styles.headerDot, backgroundColor: COLORS.accent }} />
                    Reliability
                  </div>
                  <div style={styles.cardBody}>
                    <div style={styles.dataRow}>
                      <span style={styles.dataLabel}>Est. downtime</span>
                      <span style={styles.dataValue}>{agentsData.Reliability.downtime_estimate_minutes} min</span>
                    </div>
                    <div style={styles.dataRowCol}>
                      <span style={styles.dataLabel}>Critical single points of failure</span>
                      <div style={styles.tagsContainer}>
                        {agentsData.Reliability.critical_spofs?.length > 0
                          ? agentsData.Reliability.critical_spofs.map((spof, i) => (
                            <span key={i} style={{ ...styles.tag, borderColor: 'rgba(229,72,77,0.5)', color: COLORS.danger }}>{spof}</span>
                          ))
                          : <span style={styles.tag}>None detected</span>
                        }
                      </div>
                    </div>
                    {agentsData.Reliability.cascading_impact_summary && (
                      <p style={styles.insightText}>
                        <span style={styles.insightLabel}>Impact</span>
                        {agentsData.Reliability.cascading_impact_summary}
                      </p>
                    )}
                    {agentsData.Reliability.mitigation_steps?.length > 0 && (
                      <div style={styles.dataRowCol}>
                        <span style={styles.dataLabel}>Mitigation steps</span>
                        <ul style={styles.list}>
                          {agentsData.Reliability.mitigation_steps.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Security */}
              <div style={styles.card}>
                <div style={{ ...styles.accentBar, backgroundColor: COLORS.warn }} />
                <div style={styles.cardInner}>
                  <div style={styles.cardHeader}>
                    <span style={{ ...styles.headerDot, backgroundColor: COLORS.warn }} />
                    Security
                  </div>
                  <div style={styles.cardBody}>
                    <div style={styles.dataRow}>
                      <span style={styles.dataLabel}>Exposure risk</span>
                      <span style={{
                        ...styles.dataValue,
                        color: agentsData.Security.exposure_risk_level === 'High' ? COLORS.danger : COLORS.warn,
                      }}>
                        {agentsData.Security.exposure_risk_level}
                      </span>
                    </div>
                    <div style={styles.dataRowCol}>
                      <span style={styles.dataLabel}>Alerts</span>
                      <ul style={{ ...styles.list, color: COLORS.textMuted }}>
                        {agentsData.Security.iam_sg_warnings?.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                    {agentsData.Security.attack_vectors && (
                      <p style={styles.insightText}>
                        <span style={styles.insightLabel}>Attack vector</span>
                        {agentsData.Security.attack_vectors}
                      </p>
                    )}
                    {agentsData.Security.compliance_violations?.length > 0 && (
                      <div style={styles.dataRowCol}>
                        <span style={styles.dataLabel}>Compliance risks</span>
                        <div style={styles.tagsContainer}>
                          {agentsData.Security.compliance_violations.map((v, i) => (
                            <span key={i} style={{ ...styles.tag, borderColor: 'rgba(224,145,63,0.5)', color: COLORS.warn }}>{v}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Cost */}
              <div style={styles.card}>
                <div style={{ ...styles.accentBar, backgroundColor: COLORS.safe }} />
                <div style={styles.cardInner}>
                  <div style={styles.cardHeader}>
                    <span style={{ ...styles.headerDot, backgroundColor: COLORS.safe }} />
                    Cost
                  </div>
                  <div style={styles.cardBody}>
                    <div style={styles.dataRow}>
                      <span style={styles.dataLabel}>Orphaned spend</span>
                      <span style={{ ...styles.dataValue, fontSize: '16px', color: COLORS.safe }}>
                        ${agentsData.Cost.orphaned_resource_cost_estimate}
                      </span>
                    </div>
                    <div style={styles.dataRow}>
                      <span style={styles.dataLabel}>Hourly burn rate</span>
                      <span style={{ ...styles.dataValue, color: COLORS.warn }}>
                        ${agentsData.Cost.hourly_burn_rate || 0}/hr
                      </span>
                    </div>
                    <p style={styles.insightText}>{agentsData.Cost.financial_impact_summary}</p>
                  </div>
                </div>
              </div>

              {/* Remediation */}
              <div style={styles.card}>
                <div style={{ ...styles.accentBar, backgroundColor: COLORS.safe }} />
                <div style={styles.cardInner}>
                  <div style={styles.cardHeader}>
                    <span style={{ ...styles.headerDot, backgroundColor: COLORS.safe }} />
                    Auto-Remediation
                  </div>
                  <div style={styles.cardBody}>
                    <p style={styles.insightText}>{agentsData.Remediation?.explanation}</p>
                    {agentsData.Remediation?.terraform_patch && (
                      <div style={{ marginTop: '14px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                        <div style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: '6px 12px', fontSize: '10px', color: COLORS.textMuted, borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{width: '8px', height: '8px', borderRadius: '50%', backgroundColor: COLORS.danger}}></span>
                          <span style={{width: '8px', height: '8px', borderRadius: '50%', backgroundColor: COLORS.warn}}></span>
                          <span style={{width: '8px', height: '8px', borderRadius: '50%', backgroundColor: COLORS.safe}}></span>
                          <span style={{marginLeft: '4px', fontFamily: "'JetBrains Mono', monospace"}}>main.tf patch</span>
                        </div>
                        <div style={{ backgroundColor: 'rgba(0,0,0,0.4)', padding: '12px', overflowX: 'auto', maxHeight: '300px' }}>
                          <pre style={{ margin: 0, color: '#A6ACCD', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", lineHeight: '1.4' }}>
                            <code>{agentsData.Remediation.terraform_patch}</code>
                          </pre>
                        </div>
                      </div>
                    )}
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

/* ---------------------------------------------------------------- */
/*  Styles                                                           */
/* ---------------------------------------------------------------- */
const surface = 'rgba(18, 20, 24, 0.82)';
const cardSurface = 'rgba(22, 24, 29, 0.9)';
const hairline = 'rgba(255, 255, 255, 0.08)';

const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    position: 'relative',
    overflow: 'hidden',
  },
  graphContainer: {
    position: 'absolute',
    inset: 0,
    zIndex: 1,
  },

  /* Sidebar */
  hudSidebar: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    width: '360px',
    maxHeight: 'calc(100vh - 40px)',
    zIndex: 10,
    backgroundColor: surface,
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${hairline}`,
    borderRadius: '14px',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)',
    overflowY: 'auto',
  },
  hudContent: {
    padding: '22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 700,
    color: COLORS.text,
    letterSpacing: '-0.02em',
  },
  badge: {
    backgroundColor: 'rgba(91, 141, 239, 0.14)',
    border: '1px solid rgba(91, 141, 239, 0.4)',
    color: COLORS.accent,
    fontSize: '10px',
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: '5px',
    letterSpacing: '0.08em',
  },
  subtitle: {
    margin: '-14px 0 0 0',
    fontSize: '12px',
    color: COLORS.textFaint,
    fontWeight: 500,
    letterSpacing: '0.04em',
  },
  divider: {
    height: '1px',
    background: hairline,
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '11px',
    color: COLORS.textMuted,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  selectedNodeBox: {
    padding: '11px 14px',
    backgroundColor: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '9px',
    fontSize: '13px',
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 500,
    wordBreak: 'break-all',
    transition: 'border-color 0.2s ease',
  },
  select: {
    padding: '11px 14px',
    backgroundColor: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '9px',
    color: COLORS.text,
    fontSize: '13px',
    fontWeight: 500,
    outline: 'none',
    cursor: 'pointer',
    transition: 'border-color 0.2s ease',
  },
  customDropdownMenu: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    backgroundColor: '#1a1c20',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    padding: '4px',
    zIndex: 999,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
    backdropFilter: 'blur(12px)',
    animation: 'fadeIn 0.15s ease',
  },
  customDropdownItem: {
    padding: '10px 12px',
    borderRadius: '7px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    transition: 'background-color 0.15s ease',
  },
  buttonGroup: {
    display: 'flex',
    gap: '10px',
  },
  button: {
    flex: 3,
    padding: '12px',
    backgroundColor: COLORS.accent,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '9px',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    letterSpacing: '0.01em',
    transition: 'background-color 0.2s ease',
  },
  resetButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '9px',
    color: COLORS.textMuted,
    fontSize: '13px',
    fontWeight: 600,
    transition: 'background-color 0.2s ease',
  },
  uploadButton: {
    width: '100%',
    padding: '11px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    border: '1px dashed rgba(255, 255, 255, 0.18)',
    color: COLORS.textMuted,
    borderRadius: '9px',
    fontSize: '13px',
    fontWeight: 500,
    transition: 'border-color 0.2s ease, background-color 0.2s ease',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },

  /* Cards */
  cardsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    animation: 'fadeIn 0.35s ease-out',
  },
  card: {
    position: 'relative',
    backgroundColor: cardSurface,
    border: `1px solid ${hairline}`,
    borderRadius: '11px',
    overflow: 'hidden',
  },
  accentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: '3px',
  },
  cardInner: {
    padding: '15px 16px 15px 18px',
  },
  cardEyebrow: {
    fontSize: '10px',
    fontWeight: 600,
    color: COLORS.textFaint,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '8px',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 600,
    marginBottom: '12px',
    color: COLORS.text,
  },
  headerDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '11px',
  },
  dataRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    margin: 0,
  },
  dataRowCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    margin: 0,
  },
  dataLabel: {
    fontSize: '12px',
    color: COLORS.textMuted,
    fontWeight: 500,
  },
  dataValue: {
    fontSize: '13px',
    fontWeight: 600,
    color: COLORS.text,
    fontFamily: "'JetBrains Mono', monospace",
  },
  resourceId: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: 600,
    color: COLORS.text,
    fontFamily: "'JetBrains Mono', monospace",
    wordBreak: 'break-all',
  },
  tagsContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  tag: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '5px',
    padding: '3px 8px',
    fontSize: '11px',
    color: COLORS.textMuted,
    fontWeight: 500,
    fontFamily: "'JetBrains Mono', monospace",
  },
  list: {
    margin: 0,
    paddingLeft: '16px',
    color: COLORS.textMuted,
    fontSize: '12px',
    lineHeight: 1.6,
  },
  insightText: {
    margin: 0,
    fontSize: '12px',
    color: COLORS.textMuted,
    lineHeight: 1.6,
  },
  insightLabel: {
    display: 'block',
    fontSize: '10px',
    fontWeight: 600,
    color: COLORS.textFaint,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '3px',
  },

  /* Floating selected-resource card */
  floatingResourceCard: {
    position: 'absolute',
    left: '20px',
    bottom: '20px',
    width: '320px',
    zIndex: 10,
    backgroundColor: surface,
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${hairline}`,
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.45)',
    animation: 'fadeIn 0.35s ease-out',
  },

  /* Search */
  searchInput: {
    width: '100%',
    padding: '12px 14px',
    backgroundColor: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '9px',
    color: COLORS.text,
    fontSize: '13px',
    fontWeight: 500,
    outline: 'none',
    transition: 'border-color 0.2s ease',
  },
  searchDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: '6px',
    backgroundColor: 'rgba(18, 20, 24, 0.97)',
    border: `1px solid ${hairline}`,
    borderRadius: '9px',
    maxHeight: '220px',
    overflowY: 'auto',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(10px)',
    overflow: 'hidden',
  },
  searchItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    padding: '10px 14px',
    color: COLORS.text,
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },

  /* Legend */
  legend: {
    position: 'absolute',
    top: '20px',
    left: '20px',
    zIndex: 10,
    backgroundColor: surface,
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${hairline}`,
    borderRadius: '12px',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
  },
  legendTitle: {
    fontSize: '10px',
    fontWeight: 600,
    color: COLORS.textFaint,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '2px',
  },
  legendRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
  },
  legendDot: {
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  legendLabel: {
    fontSize: '12px',
    color: COLORS.textMuted,
    fontWeight: 500,
  },
  legendSep: {
    height: '1px',
    background: hairline,
    margin: '2px 0',
  },

  /* Zoom */
  zoomControls: {
    position: 'absolute',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '8px',
    zIndex: 10,
  },
  zoomButton: {
    backgroundColor: surface,
    border: `1px solid ${hairline}`,
    color: COLORS.textMuted,
    width: '38px',
    height: '38px',
    borderRadius: '9px',
    fontSize: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    transition: 'background-color 0.2s ease',
  },
  uploadButton: {
    width: '100%',
    padding: '10px',
    backgroundColor: 'rgba(0,0,0,0.25)',
    border: '1px dashed rgba(255, 255, 255, 0.2)',
    color: COLORS.textMuted,
    borderRadius: '9px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
    marginTop: '10px',
    transition: 'border-color 0.2s ease',
  },
  chaosPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  chaosHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  }
};

