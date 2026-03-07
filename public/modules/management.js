/**
 * AutoLab Agent Management UI
 * Gateway + Agent management interface
 */

let currentGateway = null;
let currentAgent = null;
let gateways = [];

// ─── Initialize Management Panel ──────────────────────────────
export function initManagement() {
    console.log('[management] Initializing...');
    
    // Create management button in toolbar
    const toolbar = document.querySelector('.toolbar');
    if (toolbar && !document.getElementById('mgmt-btn')) {
        const btn = document.createElement('button');
        btn.id = 'mgmt-btn';
        btn.className = 'toolbar-btn';
        btn.innerHTML = '⚙️ Manage';
        btn.title = 'Agent Management';
        btn.onclick = () => openManagementPanel();
        toolbar.appendChild(btn);
    }
    
    loadGateways();
}

// ─── Load Gateways ─────────────────────────────────────────────
async function loadGateways() {
    try {
        const res = await fetch('/api/gateways');
        const data = await res.json();
        gateways = data.gateways || [];
        console.log('[management] Loaded', gateways.length, 'gateways');
    } catch (e) {
        console.error('[management] Failed to load gateways:', e);
    }
}

// ─── Open Management Panel ─────────────────────────────────────
function openManagementPanel() {
    // Remove existing panel
    const existing = document.getElementById('mgmt-panel');
    if (existing) existing.remove();
    
    const panel = document.createElement('div');
    panel.id = 'mgmt-panel';
    panel.className = 'mgmt-panel';
    panel.innerHTML = `
        <div class="mgmt-header">
            <h2>🛠️ Agent Management</h2>
            <button class="close-btn" onclick="document.getElementById('mgmt-panel').remove()">✕</button>
        </div>
        <div class="mgmt-body">
            <div class="mgmt-sidebar">
                <h3>Gateways</h3>
                <div id="gateway-list"></div>
            </div>
            <div class="mgmt-content">
                <div id="agent-list-view"></div>
                <div id="agent-detail-view" style="display: none;"></div>
            </div>
        </div>
    `;
    
    document.body.appendChild(panel);
    renderGatewayList();
}

// ─── Render Gateway List ───────────────────────────────────────
function renderGatewayList() {
    const container = document.getElementById('gateway-list');
    if (!container) return;
    
    container.innerHTML = gateways.map(gw => `
        <div class="gateway-item ${gw.connected ? 'connected' : 'disconnected'}" 
             onclick="window.selectGateway(${gw.id})">
            <div class="gateway-icon">${gw.connected ? '🟢' : '🔴'}</div>
            <div class="gateway-info">
                <div class="gateway-label">${gw.label}</div>
                <div class="gateway-status">${gw.connected ? 'Connected' : 'Offline'}</div>
            </div>
        </div>
    `).join('');
}

// ─── Select Gateway ────────────────────────────────────────────
window.selectGateway = async function(gatewayId) {
    currentGateway = gateways.find(g => g.id === gatewayId);
    if (!currentGateway) return;
    
    console.log('[management] Selected gateway:', currentGateway.label);
    
    // Highlight selected gateway
    document.querySelectorAll('.gateway-item').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.gateway-item')[gatewayId]?.classList.add('selected');
    
    // Load agents for this gateway
    await loadAgents(gatewayId);
};

// ─── Load Agents ───────────────────────────────────────────────
async function loadAgents(gatewayId) {
    const container = document.getElementById('agent-list-view');
    if (!container) return;
    
    container.style.display = 'block';
    document.getElementById('agent-detail-view').style.display = 'none';
    
    container.innerHTML = '<div class="loading">Loading agents...</div>';
    
    try {
        const res = await fetch(`/api/gateway/${gatewayId}/agents`);
        const data = await res.json();
        
        if (!data.agents || data.agents.length === 0) {
            container.innerHTML = '<div class="empty">No agents found</div>';
            return;
        }
        
        container.innerHTML = `
            <div class="agent-list-header">
                <h3>${data.label} Agents</h3>
                <span class="agent-count">${data.agents.length} agent${data.agents.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="agent-grid">
                ${data.agents.map(agent => `
                    <div class="agent-card" onclick="window.selectAgent(${gatewayId}, '${agent.id}')">
                        <div class="agent-card-header">
                            <div class="agent-name">${agent.name}</div>
                            <div class="agent-status ${agent.active ? 'active' : 'inactive'}">
                                ${agent.active ? '🟢' : '⚪'}
                            </div>
                        </div>
                        <div class="agent-card-body">
                            <div class="agent-stat">
                                <span class="stat-label">Model:</span>
                                <span class="stat-value">${agent.model}</span>
                            </div>
                            <div class="agent-stat">
                                <span class="stat-label">Sessions:</span>
                                <span class="stat-value">${agent.sessions}</span>
                            </div>
                            <div class="agent-stat">
                                <span class="stat-label">Cost:</span>
                                <span class="stat-value">$${agent.cost.toFixed(4)}</span>
                            </div>
                            <div class="agent-stat">
                                <span class="stat-label">Tokens:</span>
                                <span class="stat-value">${(agent.tokens / 1000).toFixed(1)}k</span>
                            </div>
                        </div>
                        <div class="agent-card-footer">
                            <button class="btn-primary">Manage →</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<div class="error">Failed to load agents: ${e.message}</div>`;
    }
}

// ─── Select Agent ──────────────────────────────────────────────
window.selectAgent = async function(gatewayId, agentId) {
    currentAgent = { gatewayId, agentId };
    console.log('[management] Selected agent:', agentId, 'on gateway', gatewayId);
    
    document.getElementById('agent-list-view').style.display = 'none';
    const detailView = document.getElementById('agent-detail-view');
    detailView.style.display = 'block';
    detailView.innerHTML = '<div class="loading">Loading agent details...</div>';
    
    try {
        // Load agent data
        const [filesRes, cronRes] = await Promise.all([
            fetch(`/api/gateway/${gatewayId}/agent/${agentId}/files`),
            fetch(`/api/gateway/${gatewayId}/agent/${agentId}/cron`)
        ]);
        
        const filesData = await filesRes.json();
        const cronData = await cronRes.json();
        
        renderAgentDetail(agentId, filesData, cronData);
    } catch (e) {
        detailView.innerHTML = `<div class="error">Failed to load agent: ${e.message}</div>`;
    }
};

// ─── Render Agent Detail ───────────────────────────────────────
function renderAgentDetail(agentId, filesData, cronData) {
    const detailView = document.getElementById('agent-detail-view');
    
    detailView.innerHTML = `
        <div class="agent-detail-header">
            <button class="back-btn" onclick="window.selectGateway(${currentAgent.gatewayId})">← Back</button>
            <h3>Managing: ${agentId}</h3>
        </div>
        
        <div class="agent-tabs">
            <button class="tab-btn active" onclick="window.switchTab('overview')">Overview</button>
            <button class="tab-btn" onclick="window.switchTab('files')">Core Files</button>
            <button class="tab-btn" onclick="window.switchTab('cron')">Cron Jobs</button>
            <button class="tab-btn" onclick="window.switchTab('services')">Services</button>
        </div>
        
        <div class="tab-content">
            <div id="tab-overview" class="tab-pane active">
                <h4>Agent Overview</h4>
                <div class="overview-section">
                    <div class="form-group">
                        <label>Model:</label>
                        <select id="model-select" onchange="window.changeModel()">
                            <option value="claude-sonnet-4.5">claude-sonnet-4.5</option>
                            <option value="claude-opus-4">claude-opus-4</option>
                            <option value="gpt-4o">gpt-4o</option>
                            <option value="gpt-4-turbo">gpt-4-turbo</option>
                            <option value="hermes3:70b">hermes3:70b (Local)</option>
                            <option value="gpt-oss:20b">gpt-oss:20b (Local)</option>
                        </select>
                        <button class="btn-primary" onclick="window.changeModel()">Update Model</button>
                    </div>
                </div>
            </div>
            
            <div id="tab-files" class="tab-pane">
                <h4>Core Files</h4>
                <div class="file-list">
                    ${(filesData.files || []).map(f => `
                        <div class="file-item" onclick="window.openFile('${f.name}')">
                            <span class="file-icon">📄</span>
                            <span class="file-name">${f.name}</span>
                            <span class="file-size">${(f.size / 1024).toFixed(1)} KB</span>
                        </div>
                    `).join('')}
                </div>
                <div id="file-editor" style="display: none;">
                    <div class="editor-header">
                        <h5 id="editor-filename"></h5>
                        <div class="editor-actions">
                            <button class="btn-primary" onclick="window.saveFile()">💾 Save</button>
                            <button class="btn-secondary" onclick="window.closeEditor()">✕ Close</button>
                        </div>
                    </div>
                    <textarea id="file-content" class="file-editor"></textarea>
                </div>
            </div>
            
            <div id="tab-cron" class="tab-pane">
                <h4>Cron Jobs</h4>
                <button class="btn-primary" onclick="window.createCronJob()">+ New Job</button>
                <div class="cron-list">
                    ${(cronData.jobs || []).length === 0 ? 
                        '<div class="empty">No cron jobs configured</div>' :
                        (cronData.jobs || []).map(job => `
                            <div class="cron-item">
                                <div class="cron-info">
                                    <div class="cron-name">${job.name || 'Unnamed Job'}</div>
                                    <div class="cron-schedule">${formatSchedule(job.schedule)}</div>
                                    <div class="cron-enabled">${job.enabled ? '✅ Enabled' : '⏸️ Disabled'}</div>
                                </div>
                                <div class="cron-actions">
                                    <button class="btn-small" onclick="window.deleteCron('${job.id}')">🗑️</button>
                                </div>
                            </div>
                        `).join('')
                    }
                </div>
            </div>
            
            <div id="tab-services" class="tab-pane">
                <h4>Running Services</h4>
                <div id="services-list">Loading...</div>
            </div>
        </div>
    `;
    
    // Load services
    loadServices();
}

// ─── Switch Tab ────────────────────────────────────────────────
window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
};

// ─── Open File Editor ──────────────────────────────────────────
window.openFile = async function(filename) {
    console.log('[management] Opening file:', filename);
    
    const editor = document.getElementById('file-editor');
    const filenameEl = document.getElementById('editor-filename');
    const contentEl = document.getElementById('file-content');
    
    editor.style.display = 'block';
    filenameEl.textContent = filename;
    contentEl.value = 'Loading...';
    
    try {
        const res = await fetch(`/api/gateway/${currentAgent.gatewayId}/agent/${currentAgent.agentId}/file/${filename}`);
        const data = await res.json();
        contentEl.value = data.content || '';
        contentEl.dataset.filename = filename;
    } catch (e) {
        contentEl.value = `Error loading file: ${e.message}`;
    }
};

// ─── Save File ─────────────────────────────────────────────────
window.saveFile = async function() {
    const contentEl = document.getElementById('file-content');
    const filename = contentEl.dataset.filename;
    const content = contentEl.value;
    
    console.log('[management] Saving file:', filename);
    
    try {
        const res = await fetch(`/api/gateway/${currentAgent.gatewayId}/agent/${currentAgent.agentId}/file/${filename}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        
        const data = await res.json();
        if (data.ok) {
            alert(`✅ Saved ${filename}`);
        } else {
            alert(`❌ Failed to save: ${data.error}`);
        }
    } catch (e) {
        alert(`❌ Error: ${e.message}`);
    }
};

// ─── Close Editor ──────────────────────────────────────────────
window.closeEditor = function() {
    document.getElementById('file-editor').style.display = 'none';
};

// ─── Change Model ──────────────────────────────────────────────
window.changeModel = async function() {
    const select = document.getElementById('model-select');
    const model = select.value;
    
    if (!confirm(`Change model to ${model}?`)) return;
    
    console.log('[management] Changing model to:', model);
    
    try {
        const res = await fetch(`/api/gateway/${currentAgent.gatewayId}/agent/${currentAgent.agentId}/model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model })
        });
        
        const data = await res.json();
        if (data.ok) {
            alert(`✅ Model changed to ${model}`);
        } else {
            alert(`❌ Failed: ${data.error}`);
        }
    } catch (e) {
        alert(`❌ Error: ${e.message}`);
    }
};

// ─── Load Services ─────────────────────────────────────────────
async function loadServices() {
    const container = document.getElementById('services-list');
    if (!container) return;
    
    try {
        const res = await fetch('/api/services');
        const data = await res.json();
        
        container.innerHTML = `
            <div class="services-grid">
                ${(data.services || []).map(svc => `
                    <div class="service-card">
                        <div class="service-name">${svc.name}</div>
                        <div class="service-port">Port: ${svc.port}</div>
                        <div class="service-status ${svc.status}">${svc.status}</div>
                        <a href="${svc.url}" target="_blank" class="btn-small">Open →</a>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<div class="error">Failed to load services</div>`;
    }
}

// ─── Format Schedule ───────────────────────────────────────────
function formatSchedule(schedule) {
    if (!schedule) return 'Unknown';
    if (schedule.kind === 'at') return `Once at ${new Date(schedule.at).toLocaleString()}`;
    if (schedule.kind === 'every') return `Every ${schedule.everyMs / 1000}s`;
    if (schedule.kind === 'cron') return schedule.expr;
    return 'Unknown';
}

// ─── Create Cron Job ───────────────────────────────────────────
window.createCronJob = function() {
    alert('Cron job creation UI coming soon!');
};

// ─── Delete Cron Job ───────────────────────────────────────────
window.deleteCron = async function(jobId) {
    if (!confirm('Delete this cron job?')) return;
    
    try {
        const res = await fetch(`/api/gateway/${currentAgent.gatewayId}/agent/${currentAgent.agentId}/cron/${jobId}`, {
            method: 'DELETE'
        });
        
        const data = await res.json();
        if (data.ok) {
            alert('✅ Cron job deleted');
            // Reload agent detail
            window.selectAgent(currentAgent.gatewayId, currentAgent.agentId);
        } else {
            alert(`❌ Failed: ${data.error}`);
        }
    } catch (e) {
        alert(`❌ Error: ${e.message}`);
    }
};
