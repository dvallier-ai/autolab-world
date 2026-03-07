import express from 'express';
import compression from 'compression';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { networkInterfaces } from 'os';
import { GatewayClient } from './gateway-client.js';
import { discoverAllGateways, reresolveMachine, startPeriodicDiscovery, MACHINE_REGISTRY } from './discovery.js';
import rpgSystem from './rpg-system.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const VERSION = 'v1.0.0';

// ─── Load Configuration ──────────────────────────────────────
let config = {
    network: { port: 3333, gateways: [{ url: 'ws://localhost:18789', label: 'Primary', token: '' }] },
    overseer: { name: 'Admin', displayName: 'Overseer' },
    devices: [],
    agents: []
};

// Try loading autolab-config.json
const CONFIG_PATH = join(__dirname, 'autolab-config.json');
if (existsSync(CONFIG_PATH)) {
    try {
        config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
        console.log('[config] Loaded autolab-config.json');
    } catch (e) {
        console.warn('[config] Failed to parse autolab-config.json, using defaults:', e.message);
    }
} else {
    console.warn('[config] autolab-config.json not found, using defaults. Copy autolab-config.example.json to get started.');
}

// Fallback to OpenClaw user config for gateway token if not in autolab-config
if (!config.network.gateways[0].token) {
    try {
        const userConfig = JSON.parse(readFileSync(join(process.env.HOME, '.openclaw/openclaw.json'), 'utf8'));
        config.network.gateways[0].token = userConfig?.gateway?.auth?.token || '';
    } catch (e) {
        // No user config, that's fine for deployable version
    }
}

const PORT = config.network.port;
const gatewayToken = config.network.gateways[0].token;

// Middleware
app.use(compression()); // gzip all responses
app.use(express.json());
// Disable caching for all static files so browser always gets fresh code
app.use((req, res, next) => {
    // Allow caching for Three.js vendor files (they're versioned)
    if (req.path.startsWith('/vendor/')) {
        res.set('Cache-Control', 'public, max-age=86400');
    } else {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
    next();
});

// Serve Three.js from node_modules (avoids CDN dependency)
app.use('/vendor/three', express.static(join(dirname(fileURLToPath(import.meta.url)), 'node_modules/three')));

app.use(express.static('public'));

// Model pricing (per 1M tokens, average of input/output)
const MODEL_PRICING = {
    'claude-opus-4.6': 45,
    'claude-opus-4': 45,
    'claude-sonnet-4.5': 9,
    'claude-sonnet-4': 9,
    'claude-haiku-4': 1,
    'gpt-4': 30,
    'gpt-4-turbo': 15,
    'gpt-3.5-turbo': 0.5,
    'default': 5
};

// ─── State ───────────────────────────────────────────────────
let agentState = {
    agents: [],
    sessions: [],
    devices: config.devices.length > 0 ? config.devices : [],
    events: [],
    connections: [],
    presence: [],
    lastUpdate: Date.now(),
    gatewayConnected: false,
    gatewayStartTime: null,
    health: null,
    stats: {
        totalTokens: 0,
        totalCost: 0,
        eventsToday: 0
    }
};

// Track recent events for replay to new clients
const EVENTS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'events-cache.json');
let recentEvents = [];
const MAX_EVENTS = 500;

// Load cached events from disk on startup
try {
    const cached = JSON.parse(readFileSync(EVENTS_PATH, 'utf8'));
    if (Array.isArray(cached)) {
        // Only keep events from the last 24 hours
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        recentEvents = cached.filter(e => e.ts > cutoff).slice(0, MAX_EVENTS);
        console.log(`[events] Loaded ${recentEvents.length} cached events`);
    }
} catch { }

// Token tracking per agent (rolling window for burn rate)
const tokenHistory = new Map(); // agentId → [{ts, tokens}, ...]
const TOKEN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

let eventSaveTimer = null;
function scheduleEventSave() {
    if (eventSaveTimer) return;
    eventSaveTimer = setTimeout(() => {
        eventSaveTimer = null;
        try { writeFileSync(EVENTS_PATH, JSON.stringify(recentEvents.slice(0, 200))); } catch {}
    }, 5000); // batch saves every 5s
}

function addEvent(type, data) {
    const evt = { type, data, ts: Date.now() };
    recentEvents.unshift(evt);
    if (recentEvents.length > MAX_EVENTS) recentEvents.pop();
    scheduleEventSave();
    
    // Track daily event count
    agentState.stats.eventsToday++;
    
    return evt;
}

function updateTokenStats(agentId, tokens) {
    if (!tokens || tokens <= 0) return;
    
    const now = Date.now();
    if (!tokenHistory.has(agentId)) {
        tokenHistory.set(agentId, []);
    }
    
    const history = tokenHistory.get(agentId);
    history.push({ ts: now, tokens });
    
    // Clean old entries outside window
    const cutoff = now - TOKEN_WINDOW_MS;
    while (history.length > 0 && history[0].ts < cutoff) {
        history.shift();
    }
}

function getTokenBurnRate(agentId) {
    const history = tokenHistory.get(agentId);
    if (!history || history.length < 2) return 0;
    
    const now = Date.now();
    const windowStart = now - TOKEN_WINDOW_MS;
    const recentTokens = history.filter(h => h.ts >= windowStart);
    
    if (recentTokens.length === 0) return 0;
    
    const totalTokens = recentTokens.reduce((sum, h) => sum + h.tokens, 0);
    const timeSpanMin = (now - recentTokens[0].ts) / 60000;
    
    return timeSpanMin > 0 ? Math.round(totalTokens / timeSpanMin) : 0;
}

function estimateCost(tokens, model) {
    if (!tokens || tokens <= 0) return 0;
    
    let pricePerM = MODEL_PRICING.default;
    
    // Match model name
    for (const [key, price] of Object.entries(MODEL_PRICING)) {
        if (model && model.toLowerCase().includes(key.toLowerCase())) {
            pricePerM = price;
            break;
        }
    }
    
    return (tokens / 1000000) * pricePerM;
}

// Agent positioning — cluster on device platforms
const AGENT_CONFIGS = {
    nova:    { color: '#4a9eff', emoji: '🪄', device: 'MacA' },
    liam:    { color: '#ff6b4a', emoji: '🎲', device: 'MacB' },
    paradox: { color: '#b44aff', emoji: '🌀', device: 'MacA' },
    nexus:   { color: '#4aff6b', emoji: '🤖', device: 'MacA' },
    main:    { color: '#4aff6b', emoji: '🏠', device: 'MacA' },
    cipher:  { color: '#ffaa4a', emoji: '🔐', device: 'device-3' },
};

function getDevicePosition(deviceId, deviceIndex, totalDevices) {
    if (totalDevices === 1) {
        // Single active device: center it
        return { x: 0, y: 0, z: 0 };
    }
    const radius = 8;
    const angle = (deviceIndex / totalDevices) * Math.PI * 2 - Math.PI / 2;
    return {
        x: Math.cos(angle) * radius,
        y: 0,
        z: Math.sin(angle) * radius
    };
}

function getAgentPosition(id, agentIndex, agentsOnDevice, devicePos) {
    // Position agents in a cluster on their device platform
    if (agentsOnDevice === 1) {
        // Single agent: center on platform
        return { x: devicePos.x, y: 0, z: devicePos.z };
    }
    
    // Multiple agents: arrange in circle on platform
    const clusterRadius = 2;
    const angle = (agentIndex / agentsOnDevice) * Math.PI * 2;
    return {
        x: devicePos.x + Math.cos(angle) * clusterRadius,
        y: 0,
        z: devicePos.z + Math.sin(angle) * clusterRadius
    };
}

// ─── Browser clients ─────────────────────────────────────────
const clients = new Set();

function broadcast(msg) {
    const payload = JSON.stringify(msg);
    clients.forEach(ws => {
        if (ws.readyState === 1) ws.send(payload);
    });
}

function broadcastRPGUpdate(data) {
    broadcast({ type: 'rpg', data });
}

// ─── Parse gateway data ──────────────────────────────────────
function parseHealth(health, sessions) {
    const agents = [];
    const agentList = Array.isArray(health?.agents) ? health.agents : [];

    // Build session counts per agent from sessions list
    const sessionsByAgent = {};
    const activeSessionsByAgent = {};
    const modelByAgent = {};
    const tokensByAgent = {};
    const channelsByAgent = {};
    
    if (sessions) {
        for (const s of sessions) {
            const aid = parseAgentFromKey(s.key || s.sessionKey || '');
            if (!sessionsByAgent[aid]) sessionsByAgent[aid] = 0;
            if (!activeSessionsByAgent[aid]) activeSessionsByAgent[aid] = 0;
            if (!tokensByAgent[aid]) tokensByAgent[aid] = 0;
            if (!channelsByAgent[aid]) channelsByAgent[aid] = new Set();
            
            sessionsByAgent[aid]++;
            
            // Consider "active" if updated in last 5 min
            const age = Date.now() - (s.updatedAt || 0);
            if (age < 5 * 60 * 1000) activeSessionsByAgent[aid]++;
            
            // Track model
            if (s.model && !modelByAgent[aid]) modelByAgent[aid] = s.model;
            
            // Track tokens
            if (s.totalTokens) {
                tokensByAgent[aid] += s.totalTokens;
                updateTokenStats(aid, s.totalTokens);
            }
            
            // Track channels
            const channel = s.lastChannel || s.channel || s.origin?.provider;
            if (channel) channelsByAgent[aid].add(channel);
        }
    }

    // Update global stats
    agentState.stats.totalTokens = Object.values(tokensByAgent).reduce((sum, t) => sum + t, 0);
    agentState.stats.totalCost = 0;

    // Group agents by device
    const agentsByDevice = {};

    agentList.forEach((info, index) => {
        const id = info.agentId || info.id || `agent-${index}`;
        const config = AGENT_CONFIGS[id] || { color: '#888888', emoji: '❓', device: 'MacA' };
        
        const totalSessions = info.sessions?.count || sessionsByAgent[id] || 0;
        const activeSessions = activeSessionsByAgent[id] || 0;
        const totalTokens = tokensByAgent[id] || 0;
        const model = modelByAgent[id] || 'unknown';
        const channels = channelsByAgent[id] ? Array.from(channelsByAgent[id]) : [];
        const burnRate = getTokenBurnRate(id);
        const cost = estimateCost(totalTokens, model);
        
        agentState.stats.totalCost += cost;
        
        const recentAge = info.sessions?.recent?.[0]?.age;
        const isActive = recentAge != null ? recentAge < 5 * 60 * 1000 : activeSessions > 0;

        const deviceId = config.device || 'MacA';
        if (!agentsByDevice[deviceId]) agentsByDevice[deviceId] = [];
        
        agentsByDevice[deviceId].push({
            id,
            name: info.name || id,
            emoji: config.emoji || '❓',
            sessions: totalSessions,
            activeSessions,
            model,
            active: isActive,
            isDefault: info.isDefault || false,
            heartbeatEnabled: info.heartbeat?.enabled || false,
            color: config.color || '#888888',
            deviceId,
            totalTokens,
            burnRate,
            cost,
            channels
        });
    });

    // Calculate device positions and agent positions
    const activeDevices = Object.entries(agentsByDevice)
        .filter(([_, agents]) => agents.length > 0)
        .map(([deviceId]) => deviceId);
    
    activeDevices.forEach((deviceId, deviceIndex) => {
        const devicePos = getDevicePosition(deviceId, deviceIndex, activeDevices.length);
        const devAgents = agentsByDevice[deviceId];
        
        devAgents.forEach((agent, agentIndex) => {
            agent.position = getAgentPosition(agent.id, agentIndex, devAgents.length, devicePos);
        });
        
        agents.push(...devAgents);
    });

    // Update device online status
    const devicesWithStatus = (config.devices || []).map(dev => ({
        ...dev,
        online: activeDevices.includes(dev.id),
        agentCount: (agentsByDevice[dev.id] || []).length
    }));

    return {
        agents,
        devices: devicesWithStatus,
        lastUpdate: Date.now(),
        gatewayConnected: true,
        health: {
            version: health?.version || 'unknown',
            defaultAgentId: health?.defaultAgentId || null,
            channels: health?.channelOrder || [],
            ts: health?.ts || null,
        }
    };
}

async function fetchSessions() {
    if (!primaryGateway.connected) return [];
    try {
        const result = await primaryGateway.request('sessions.list', { 
            activeMinutes: 120,
            includeGlobal: true,
            includeUnknown: true,
            limit: 100
        });
        return result?.sessions || [];
    } catch (e) {
        return [];
    }
}

async function fetchPresence() {
    if (!primaryGateway.connected) return [];
    try {
        const result = await primaryGateway.getPresence();
        return Array.isArray(result) ? result : [];
    } catch {
        return [];
    }
}

// ─── Gateway Connections (Discovery-Based) ───────────────────
const gateways = [];
const remoteAgents = new Map(); // gateway label -> agents[]

// Gateway tokens keyed by machine registry ID
const gatewayTokens = {};
for (const gw of config.network.gateways) {
    // Match config entries to machine registry by label
    for (const [id, machine] of Object.entries(MACHINE_REGISTRY)) {
        if (gw.label && gw.label.includes(machine.label.split(' ')[0])) {
            gatewayTokens[id] = gw.token;
        }
    }
}
// Fallback: first config gateway = nova-mac
if (!gatewayTokens['nova-mac'] && config.network.gateways[0]?.token) {
    gatewayTokens['nova-mac'] = config.network.gateways[0].token;
}

async function initGateways() {
    const discovered = await discoverAllGateways(gatewayTokens);
    console.log(`[discovery] Found ${discovered.length} gateways`);

    for (const gw of discovered) {
        const isLocal = MACHINE_REGISTRY[gw.machineId]?.local;
        const client = new GatewayClient(gw.token, gw.url, {
            clientId: 'autolab-control-ui',
            clientMode: 'webchat'
        });
        const entry = { client, label: gw.label, connected: false, machineId: gw.machineId };
        gateways.push(entry);
    }

    // Define gwMacB as shorthand for MacB gateway
    const macBEntry = gateways.find(g => g.machineId === 'macb');
    gwMacB = macBEntry?.client || null;
    primaryGateway = gateways[0]?.client || null;

    setupGatewayListeners();
    connectAllGateways();

    // Re-discover every 60s — reconnect on IP changes
    startPeriodicDiscovery(async (machineId, resolved) => {
        const entry = gateways.find(g => g.machineId === machineId);
        if (!entry) return;
        console.log(`[discovery] Reconnecting ${machineId} at ${resolved.wsUrl}`);
        entry.client.close();
        const newClient = new GatewayClient(gatewayTokens[machineId] || '', resolved.wsUrl, {
            clientId: 'autolab-control-ui',
            clientMode: 'webchat'
        });
        entry.client = newClient;
        setupSingleGatewayListener(entry, gateways.indexOf(entry));
        newClient.connect().catch(() => {});
    }, 60000);

    return gwMacB;
}

let gwMacB = null;
let macBConnected = false;
// primaryGateway always points to the local machine's gateway client
let primaryGateway = null;

function setupGatewayListeners() {
    gateways.forEach((gw, idx) => setupSingleGatewayListener(gw, idx));
}

function connectAllGateways() {
    gateways.forEach(async (gw, idx) => {
        try {
            await gw.client.connect();
        } catch (e) {
            const machine = MACHINE_REGISTRY[gw.machineId];
            if (machine?.mobile) {
                console.log(`[gateway-${idx}] ${gw.label} offline (may be network hopping)`);
            } else {
                console.warn(`[gateway-${idx}] Could not connect to ${gw.label}:`, e.message || e);
            }
        }
    });
}

function setupSingleGatewayListener(gw, idx) {
    const isLocal = MACHINE_REGISTRY[gw.machineId]?.local;

    gw.client.on('snapshot', async () => {
        console.log(`[gateway-${idx}] Connected to ${gw.label}`);
        gw.connected = true;
        if (isLocal) {
            agentState.gatewayConnected = true;
            agentState.gatewayStartTime = Date.now();
        }
        if (gw.machineId === 'macb') {
            macBConnected = true;
        }
        
        try {
            const health = await gw.client.getHealth();
            if (!isLocal) {
                remoteAgents.set(gw.label, parseRemoteAgents(health, gw.label));
                console.log(`[gateway-${idx}] Found ${remoteAgents.get(gw.label).length} agents on ${gw.label}`);
                mergeRemoteAgents();
            }
            broadcast({ type: 'update', data: agentState });
        } catch (e) {
            console.error(`[gateway-${idx}] Failed to get initial data:`, e);
        }
    });

    gw.client.on('agent', (payload) => {
        const evt = addEvent('agent', { ...payload, _remote: !isLocal ? gw.label : null });
        broadcast({ type: 'event', event: 'agent', data: payload, ts: evt.ts });
    });

    gw.client.on('disconnect', async () => {
        console.log(`[gateway-${idx}] Disconnected from ${gw.label}`);
        gw.connected = false;
        if (isLocal) {
            agentState.gatewayConnected = false;
        }
        if (gw.machineId === 'macb') {
            macBConnected = false;
        }
        // Trigger re-discovery on disconnect for mobile machines
        if (MACHINE_REGISTRY[gw.machineId]?.mobile) {
            console.log(`[discovery] ${gw.machineId} disconnected — triggering re-resolve`);
            const resolved = await reresolveMachine(gw.machineId);
            if (resolved && resolved.wsUrl !== gw.client.url) {
                console.log(`[discovery] ${gw.machineId} IP changed to ${resolved.ip}, reconnecting...`);
                const newClient = new GatewayClient(gatewayTokens[gw.machineId] || '', resolved.wsUrl, {
                    clientId: 'autolab-control-ui', clientMode: 'webchat'
                });
                gw.client = newClient;
                setupSingleGatewayListener(gw, idx);
                newClient.connect().catch(() => {});
            }
        }
    });
}

function parseRemoteAgents(health, gatewayLabel) {
    const agents = [];
    const agentList = Array.isArray(health?.agents) ? health.agents : [];
    
    for (const info of agentList) {
        let agentId = info.agentId || info.id || 'unknown';
        
        // Map Cipher's "main" agent to "cipher" display name
        if (gatewayLabel.includes('Cipher') && agentId === 'main') {
            agentId = 'cipher';
        }
        
        const totalSessions = info.sessions?.count || 0;
        const recentAge = info.sessions?.recent?.[0]?.age;
        const isActive = recentAge != null ? recentAge < 5 * 60 * 1000 : false;
        
        agents.push({
            id: agentId,
            name: info.name || agentId,
            emoji: '🤖',
            color: '#4aff6b',
            deviceId: gatewayLabel,
            sessions: totalSessions,
            activeSessions: isActive ? 1 : 0,
            model: info.model || 'unknown',
            active: isActive,
            channels: [],
            totalTokens: 0,
            burnRate: 0,
            cost: 0,
            _remote: gatewayLabel,
            _remoteAgentId: info.agentId || info.id,
        });
    }
    return agents;
}

function mergeRemoteAgents() {
    // Merge all remote gateway agents into main state
    const allRemoteAgents = [];
    for (const [label, agents] of remoteAgents.entries()) {
        allRemoteAgents.push(...agents);
    }
    
    // Remove old remote agents and add fresh ones
    if (agentState.agents) {
        agentState.agents = agentState.agents.filter(a => !a._remote);
        agentState.agents.push(...allRemoteAgents);
    }
}

// Primary gateway detailed event handlers — called after initGateways()
function setupPrimaryGatewayListeners() {
    if (!primaryGateway) return;

primaryGateway.on('snapshot', async (snapshot) => {
    console.log('[gateway] Processing initial snapshot...');
    try {
        agentState.gatewayStartTime = Date.now();
        
        const [health, sessions, presence] = await Promise.all([
            primaryGateway.getHealth(),
            fetchSessions(),
            fetchPresence()
        ]);
        
        const parsed = parseHealth(health, sessions);
        agentState = {
            ...parsed,
            sessions: sessions.map(simplifySession),
            presence,
            events: [],
            gatewayStartTime: agentState.gatewayStartTime,
            stats: agentState.stats
        };
        
        broadcast({ type: 'init', data: agentState });
        console.log(`[gateway] Found ${agentState.agents.length} agents:`, 
            agentState.agents.map(a => `${a.name} (${a.sessions}s, ${a.active ? 'ACTIVE' : 'idle'})`).join(', '));
    } catch (e) {
        console.error('[gateway] Failed to get initial data:', e);
    }
});

// Forward gateway events to browser + track for visualization
primaryGateway.on('agent', (payload) => {
    const evt = addEvent('agent', payload);
    broadcast({ type: 'event', event: 'agent', data: payload, ts: evt.ts });
    
    // Detect sub-agent lifecycle from agent events
    // Gateway sends agent events with stream:"lifecycle" and data.phase:"start"/"end"
    // Session keys like "agent:nova:subagent:UUID" indicate sub-agent runs
    const sessionKey = payload?.sessionKey;
    const stream = payload?.stream;
    const phase = payload?.data?.phase;
    
    if (stream === 'lifecycle' && sessionKey && sessionKey.includes('subagent')) {
        const agentId = parseAgentFromKey(sessionKey);
        if (phase === 'start') {
            const spawnEvt = addEvent('session-spawn', {
                sessionKey,
                parentKey: `agent:${agentId}:main`,
                agentId,
            });
            broadcast({ type: 'event', event: 'session-spawn', data: spawnEvt.data, ts: spawnEvt.ts });
        } else if (phase === 'end') {
            const completeEvt = addEvent('session-complete', {
                sessionKey,
                agentId,
            });
            broadcast({ type: 'event', event: 'session-complete', data: completeEvt.data, ts: completeEvt.ts });
        }
    }
});

primaryGateway.on('chat', (payload) => {
    // Chat events = agent activity (thinking, responding, etc.)
    // Extract tool calls from payload
    const toolCalls = [];
    if (payload?.toolCalls && Array.isArray(payload.toolCalls)) {
        payload.toolCalls.forEach(tc => {
            if (tc.name) toolCalls.push(tc.name);
        });
    }
    
    const evt = addEvent('chat', {
        sessionKey: payload?.sessionKey,
        state: payload?.state,
        runId: payload?.runId,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        kind: payload?.kind,
        // Include content + role for message panel display
        content: payload?.content,
        role: payload?.role,
    });
    broadcast({ type: 'event', event: 'chat', data: evt.data, ts: evt.ts });
});

primaryGateway.on('presence', (payload) => {
    agentState.presence = Array.isArray(payload?.presence) ? payload.presence : [];
    broadcast({ type: 'presence', data: agentState.presence });
});

primaryGateway.on('cron', (payload) => {
    // Detect heartbeat events
    const isHeartbeat = payload?.name?.toLowerCase()?.includes('heartbeat');
    const evt = addEvent('cron', {
        ...payload,
        isHeartbeat
    });
    broadcast({ type: 'event', event: 'cron', data: evt.data, ts: evt.ts });
});

primaryGateway.on('any-event', ({ event, payload }) => {
    // Forward all unhandled events, but detect session spawn/complete
    if (!['agent', 'chat', 'presence', 'cron', 'connect.challenge'].includes(event)) {
        // Detect session lifecycle events
        if (event === 'session.created' || event === 'session.spawned') {
            const evt = addEvent('session-spawn', {
                sessionKey: payload?.sessionKey || payload?.key,
                parentKey: payload?.parentKey,
                agentId: parseAgentFromKey(payload?.sessionKey || payload?.key),
            });
            broadcast({ type: 'event', event: 'session-spawn', data: evt.data, ts: evt.ts });
        } else if (event === 'session.completed' || event === 'session.closed') {
            const evt = addEvent('session-complete', {
                sessionKey: payload?.sessionKey || payload?.key,
                agentId: parseAgentFromKey(payload?.sessionKey || payload?.key),
            });
            broadcast({ type: 'event', event: 'session-complete', data: evt.data, ts: evt.ts });
        }
        
        const evt = addEvent(event, payload);
        broadcast({ type: 'event', event, data: payload, ts: evt.ts });
    }
});

primaryGateway.on('disconnect', () => {
    agentState.gatewayConnected = false;
    broadcast({ type: 'gateway-status', connected: false });
});
} // end setupPrimaryGatewayListeners

// ─── Session helpers ─────────────────────────────────────────
function simplifySession(s) {
    const key = s.key || s.sessionKey || '';
    return {
        key,
        agentId: parseAgentFromKey(key),
        kind: s.kind,
        label: s.label || s.displayName,
        active: (Date.now() - (s.updatedAt || 0)) < 5 * 60 * 1000,
        channel: s.lastChannel || s.channel || s.origin?.provider,
        model: s.model,
        lastActiveAt: s.updatedAt,
        tokens: s.totalTokens || 0,
        cost: s.cost || null,
    };
}

function parseAgentFromKey(key) {
    if (!key) return 'unknown';
    // session keys are like "agent:nova:main" or "agent:liam:telegram:1234"
    const parts = key.split(':');
    if (parts[0] === 'agent' && parts[1]) return parts[1];
    return parts[0] || 'unknown';
}

// ─── Periodic health/session poll ────────────────────────────
let pollInterval;
async function pollHealth() {
    if (!primaryGateway.connected) return;
    try {
        const [health, sessions] = await Promise.all([
            primaryGateway.getHealth(),
            fetchSessions()
        ]);
        
        const parsed = parseHealth(health, sessions);
        agentState = {
            ...parsed,
            sessions: sessions.map(simplifySession),
            presence: agentState.presence || [],
            events: [],
            gatewayStartTime: agentState.gatewayStartTime,
            stats: agentState.stats
        };
        
        // Also poll MacB health if connected
        if (macBConnected) {
            try {
                const macBHealth = await gwMacB.getHealth();
                macBAgents = parseMacBAgents(macBHealth);
            } catch (e) { /* silent */ }
        }
        mergeRemoteAgents();
        
        broadcast({ type: 'update', data: agentState });
    } catch (e) {
        // Silent fail
    }
}

// ─── Browser WebSocket handler ───────────────────────────────
wss.on('connection', (ws) => {
    console.log('[ws] Browser client connected');
    clients.add(ws);

    // Send full state + recent events
    ws.send(JSON.stringify({ type: 'init', data: agentState }));
    
    // Send recent events for event log replay
    recentEvents.slice(0, 30).reverse().forEach(evt => {
        ws.send(JSON.stringify({ type: 'event', event: evt.type, data: evt.data, ts: evt.ts }));
    });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            handleBrowserMessage(ws, msg);
        } catch {}
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log('[ws] Browser client disconnected');
    });
});

function handleBrowserMessage(ws, msg) {
    // Handle requests from the browser (e.g., agent detail queries)
    if (msg.type === 'get-agent-detail') {
        const agent = agentState.agents.find(a => a.id === msg.agentId);
        const sessions = agentState.sessions.filter(s => s.agentId === msg.agentId);
        ws.send(JSON.stringify({
            type: 'agent-detail',
            agentId: msg.agentId,
            agent,
            sessions,
        }));
    }
}

// ─── REST API for external tools ─────────────────────────────
app.get('/api/state', (req, res) => {
    res.json(agentState);
});

app.get('/api/agents', (req, res) => {
    res.json(agentState.agents);
});

app.get('/api/events', (req, res) => {
    res.json(recentEvents);
});

app.get('/api/hardware', (req, res) => {
    // Serve device config with resolved URLs
    const configPath = join(__dirname, 'devices-config.json');
    if (!existsSync(configPath)) {
        return res.json({ devices: [] });
    }
    try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        // For local devices, resolve to the requesting host (so remote browsers work)
        const requestHost = req.hostname;
        const devices = (config.devices || []).map(dev => {
            const host = dev.isLocal ? requestHost : dev.host;
            const services = dev.services.map(svc => {
                if (svc.type === 'http') {
                    return { ...svc, url: `http://${host}:${svc.port}${svc.path || '/'}` };
                }
                return svc;
            });
            return { ...dev, resolvedHost: host, services };
        });
        res.json({ defaultUser: config.defaultUser || overseer', devices });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/devices', (req, res) => {
    res.json(agentState.devices || []);
});

// ── Agent Appearances (character customization) ───────────────
const APPEARANCES_PATH = join(__dirname, 'agent-appearances.json');

function loadAppearances() {
    try {
        if (existsSync(APPEARANCES_PATH)) {
            return JSON.parse(readFileSync(APPEARANCES_PATH, 'utf8'));
        }
    } catch (e) { /* ignore */ }
    return {};
}

function saveAppearances(data) {
    writeFileSync(APPEARANCES_PATH, JSON.stringify(data, null, 2));
}

app.get('/api/appearances', (req, res) => {
    res.json(loadAppearances());
});

app.post('/api/appearances/:agentId', (req, res) => {
    const { agentId } = req.params;
    const { preset, name } = req.body;
    if (!preset) return res.status(400).json({ error: 'preset required' });
    
    const appearances = loadAppearances();
    appearances[agentId] = { preset, updatedAt: Date.now() };
    if (name !== undefined) appearances[agentId].name = name;
    saveAppearances(appearances);
    
    // Broadcast to all connected browsers
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify({
                type: 'appearance-change',
                agentId,
                preset,
                name,
            }));
        }
    });
    
    res.json({ ok: true, agentId, preset, name });
});

app.get('/api/stats', (req, res) => {
    res.json({
        totalTokens: agentState.stats.totalTokens,
        totalCost: agentState.stats.totalCost,
        eventsToday: agentState.stats.eventsToday,
        agents: agentState.agents.map(a => ({
            id: a.id,
            name: a.name,
            tokens: a.totalTokens || 0,
            cost: a.cost || 0,
            burnRate: a.burnRate || 0,
            model: a.model
        }))
    });
});

app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json(recentEvents.slice(0, limit));
});

// ─── Camera API (for Liam's programmatic photography) ────────
const CAMERA_POSITIONS_PATH = join(__dirname, 'camera-positions.json');

function loadCameraPositions() {
    try {
        if (existsSync(CAMERA_POSITIONS_PATH)) {
            return JSON.parse(readFileSync(CAMERA_POSITIONS_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('[camera] Failed to load positions:', e);
    }
    return { cameras: [] };
}

// List all available camera positions
app.get('/api/camera/positions', (req, res) => {
    const positions = loadCameraPositions();
    res.json(positions);
});

// Set camera to specific position (broadcasts to all browsers)
app.post('/api/camera/set', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Camera id required' });
    
    const positions = loadCameraPositions();
    const camera = positions.cameras.find(c => c.id === id);
    
    if (!camera) {
        return res.status(404).json({ error: `Camera position '${id}' not found` });
    }
    
    // Broadcast camera change to all connected browsers
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify({
                type: 'camera-set',
                position: camera.position,
                target: camera.target,
                cameraId: id,
                label: camera.label
            }));
        }
    });
    
    res.json({ ok: true, camera });
});

// Get screenshot from current camera angle (placeholder - requires browser-side implementation)
app.get('/api/camera/screenshot', (req, res) => {
    // This endpoint will trigger a browser-side screenshot capture
    // Browser will capture canvas, upload via POST, then return URL
    res.json({ 
        error: 'Not implemented',
        note: 'Use browser tool with canvas snapshot for screenshots'
    });
});

// ─── Interactive API (v0.5.0) ────────────────────────────────

// Helper: broadcast to all connected browser clients
function wsBroadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of clients) {
        try { client.send(data); } catch {}
    }
}

// ── Kanban Board API ─────────────────────────────────────────
const KANBAN_PATH = join(dirname(fileURLToPath(import.meta.url)), 'kanban.json');

app.get('/api/kanban', (req, res) => {
    try {
        const data = JSON.parse(readFileSync(KANBAN_PATH, 'utf8'));
        res.json(data);
    } catch (e) {
        res.json({ title: 'Kanban', columns: [] });
    }
});

app.post('/api/kanban', (req, res) => {
    try {
        writeFileSync(KANBAN_PATH, JSON.stringify(req.body, null, 2));
        res.json({ ok: true });
        wsBroadcast({ type: 'kanban-update', data: req.body });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/kanban/card', (req, res) => {
    try {
        const data = JSON.parse(readFileSync(KANBAN_PATH, 'utf8'));
        const { action, columnIndex, cardIndex, card, toColumn, toIndex } = req.body;
        
        if (action === 'add') {
            if (data.columns[columnIndex]) {
                const newCard = { id: `K-${Date.now().toString(36)}`, ...card };
                data.columns[columnIndex].cards.push(newCard);
            }
        } else if (action === 'move') {
            if (data.columns[columnIndex] && data.columns[toColumn]) {
                const [moved] = data.columns[columnIndex].cards.splice(cardIndex, 1);
                if (moved) {
                    const idx = toIndex ?? data.columns[toColumn].cards.length;
                    data.columns[toColumn].cards.splice(idx, 0, moved);
                }
            }
        } else if (action === 'delete') {
            if (data.columns[columnIndex]) {
                data.columns[columnIndex].cards.splice(cardIndex, 1);
            }
        } else if (action === 'edit') {
            if (data.columns[columnIndex]?.cards[cardIndex]) {
                Object.assign(data.columns[columnIndex].cards[cardIndex], card);
            }
        }
        
        writeFileSync(KANBAN_PATH, JSON.stringify(data, null, 2));
        res.json({ ok: true, data });
        wsBroadcast({ type: 'kanban-update', data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Whiteboard API ───────────────────────────────────────────
const WHITEBOARD_PATH = join(dirname(fileURLToPath(import.meta.url)), 'whiteboard.txt');

app.get('/api/whiteboard', (req, res) => {
    try {
        const text = readFileSync(WHITEBOARD_PATH, 'utf8');
        res.json({ text });
    } catch {
        res.json({ text: '' });
    }
});

app.post('/api/whiteboard', (req, res) => {
    try {
        writeFileSync(WHITEBOARD_PATH, req.body.text || '');
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── RPG System API ────────────────────────────────────────────
app.get('/api/rpg/stats', (req, res) => {
    res.json(rpgSystem.getAllStats());
});

app.get('/api/rpg/agent/:agentId', (req, res) => {
    const stats = rpgSystem.getAgentStats(req.params.agentId);
    if (!stats) {
        return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(stats);
});

app.post('/api/rpg/award-xp', (req, res) => {
    const { agentId, amount, reason } = req.body;
    const result = rpgSystem.awardXP(agentId, amount, reason);
    if (!result) {
        return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Broadcast to connected clients
    broadcastRPGUpdate({ type: 'xp', agentId, result });
    
    res.json(result);
});

app.post('/api/rpg/achievement', (req, res) => {
    const { agentId, achievementId } = req.body;
    const result = rpgSystem.awardAchievement(agentId, achievementId);
    if (!result) {
        return res.status(404).json({ error: 'Achievement already earned or not found' });
    }
    
    // Broadcast to connected clients
    broadcastRPGUpdate({ type: 'achievement', agentId, result });
    
    res.json(result);
});

// ── System Stats API (for server rack) ───────────────────────
app.get('/api/hw-ping', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.json({ online: false, error: 'no url' });
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const response = await fetch(`${url}/status`, { signal: controller.signal });
        clearTimeout(timeout);
        res.json({ online: response.ok, status: response.status });
    } catch (e) {
        res.json({ online: false, error: e.message });
    }
});

app.get('/api/system-stats', async (req, res) => {
    try {
        const { execSync } = await import('child_process');
        const uptime = execSync('uptime').toString().trim();
        const mem = execSync('vm_stat | head -5').toString().trim();
        const disk = execSync('df -h / | tail -1').toString().trim();
        const procs = execSync('ps aux | wc -l').toString().trim();
        const nodeV = process.version;
        const gatewayPid = execSync('pgrep -f "openclaw gateway" || echo "N/A"').toString().trim();
        
        res.json({
            uptime,
            memory: mem,
            disk,
            processes: parseInt(procs) || 0,
            nodeVersion: nodeV,
            gatewayPid,
            serverUptime: Math.floor(process.uptime()) + 's',
        });
    } catch (e) {
        res.json({ error: e.message });
    }
});

// Fetch chat history for an agent's main session
app.get('/api/agent/:id/history', async (req, res) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    const agent = agentState.agents?.find(a => a.id === id);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Remote agents (Nexus on MacB) — fetch history via SSH
    const isRemote = agent._remote === 'MacB';
    const remoteAgentId = agent._remoteAgentId || id;
    
    try {
        let messages = [];
        
        if (isRemote) {
            messages = await fetchRemoteHistory(remoteAgentId, limit);
        } else {
            messages = await fetchLocalHistory(id, limit);
        }
        
        const recent = messages.slice(-limit);
        res.json({ agentId: id, messages: recent, total: messages.length });
        
    } catch (error) {
        console.error('[api] History fetch failed:', error.message);
        res.json({ agentId: id, messages: [], error: error.message });
    }
});

async function fetchRemoteHistory(remoteAgentId, limit) {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    // Use SSH to read session files on MacB
    // First get the session ID from sessions.json
    const sessionsDir = `~/.openclaw/agents/${remoteAgentId}/sessions`;
    const cmd = `ssh macb "cat ${sessionsDir}/sessions.json 2>/dev/null || echo '{}'"`;
    
    const { stdout: sessionsOut } = await execAsync(cmd, { timeout: 10000 });
    const sessionsMeta = JSON.parse(sessionsOut.trim());
    const mainSession = sessionsMeta[`agent:${remoteAgentId}:main`];
    
    if (!mainSession?.sessionId) return [];
    
    // Read the JSONL file remotely — tail last 200 lines to avoid huge transfers
    const jsonlPath = `${sessionsDir}/${mainSession.sessionId}.jsonl`;
    const readCmd = `ssh macb "tail -200 ${jsonlPath} 2>/dev/null || echo ''"`;
    
    const { stdout: jsonlOut } = await execAsync(readCmd, { timeout: 15000, maxBuffer: 5 * 1024 * 1024 });
    
    return parseSessionJsonl(jsonlOut);
}

async function fetchLocalHistory(id, limit) {
    const fs = await import('fs');
    const path = await import('path');
    const readline = await import('readline');
    
    const sessionsDir = path.default.join(
        process.env.HOME, '.openclaw', 'agents', id, 'sessions'
    );
    const sessionsJson = path.default.join(sessionsDir, 'sessions.json');
    
    if (!fs.default.existsSync(sessionsJson)) return [];
    
    const sessionsMeta = JSON.parse(fs.default.readFileSync(sessionsJson, 'utf8'));
    const mainSession = sessionsMeta[`agent:${id}:main`];
    
    if (!mainSession?.sessionId) return [];
    
    const jsonlPath = path.default.join(sessionsDir, `${mainSession.sessionId}.jsonl`);
    if (!fs.default.existsSync(jsonlPath)) return [];
    
    const fileStream = fs.default.createReadStream(jsonlPath);
    const rl = readline.default.createInterface({ input: fileStream, crlfDelay: Infinity });
    
    let raw = '';
    for await (const line of rl) {
        raw += line + '\n';
    }
    
    return parseSessionJsonl(raw);
}

function parseSessionJsonl(raw) {
    const messages = [];
    const lines = raw.split('\n');
    
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const entry = JSON.parse(line);
            if (entry.type !== 'message' || !entry.message) continue;
            
            const msg = entry.message;
            const role = msg.role;
            if (role !== 'user' && role !== 'assistant') continue;
            
            let text = '';
            if (typeof msg.content === 'string') {
                text = msg.content;
            } else if (Array.isArray(msg.content)) {
                text = msg.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n');
            }
            
            if (!text || text.length < 1) continue;
            if (msg.model === 'delivery-mirror') continue;
            
            let displayText = text;
            const metaMatch = text.match(/^\[(?:Telegram|Signal|WhatsApp|Discord)[^\]]*\]\s*/);
            if (role === 'user' && metaMatch) {
                displayText = text.substring(metaMatch[0].length);
            }
            
            messages.push({
                role,
                text: displayText.substring(0, 2000),
                timestamp: entry.timestamp || null,
                model: msg.model || null,
            });
        } catch (e) { /* skip malformed lines */ }
    }
    
    return messages;
}

// Send message to agent
app.post('/api/agent/:id/message', async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;
    
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message required' });
    }
    
    const agent = agentState.agents?.find(a => a.id === id);
    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }
    
    try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        const escapedMessage = message.replace(/'/g, "'\\''");
        
        // Route to the agent's ACTUAL main session so they have full context
        // For remote agents (Nexus on MacB), SSH to the remote machine
        const isRemote = agent._remote === 'MacB';
        const remoteAgentId = agent._remoteAgentId || id;
        
        // If talking to a local agent that might be active, use a dedicated web session
        // to avoid locking the main session
        const isLocalActive = !isRemote && agent.active;
        const sessionId = isLocalActive ? `agent:${id}:web-chat` : `agent:${remoteAgentId}:main`;
        
        const prefix = `[AutoLab Chat — Dan is talking to you through the 3D web interface. Respond briefly.]`;
        const escapedPrefix = prefix.replace(/'/g, "'\\''");
        
        let cmd;
        if (isRemote) {
            cmd = `ssh macb "PATH=/opt/homebrew/bin:\\$PATH openclaw agent --session-id ${sessionId} --message '${escapedPrefix}\\n\\nDan: ${escapedMessage}' --json"`;
        } else {
            cmd = `openclaw agent --session-id ${sessionId} --message '${escapedPrefix}\\n\\nDan: ${escapedMessage}' --json`;
        }
        
        console.log('[api] Routing to real session:', sessionId);
        
        const { stdout } = await execAsync(cmd, { timeout: 60000, maxBuffer: 5 * 1024 * 1024 });
        
        console.log('[api] Response received, stdout length:', stdout.length);
        
        // Parse agent reply from JSON output
        let agentReply = 'No response';
        try {
            const result = JSON.parse(stdout);
            console.log('[api] payloads count:', result.result?.payloads?.length);
            
            if (result.result?.payloads?.length > 0) {
                agentReply = result.result.payloads[0].text || 'No text';
            } else {
                const textMatch = stdout.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                if (textMatch) {
                    agentReply = JSON.parse('"' + textMatch[1] + '"');
                }
            }
        } catch (parseErr) {
            console.error('[api] JSON parse error:', parseErr.message);
            agentReply = 'Response received but could not parse';
        }
        
        res.json({
            success: true,
            agentId: id,
            reply: agentReply
        });
        
    } catch (error) {
        console.error('[api] Message send failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// ── Inter-agent messaging: one agent talks to another ─────────
app.post('/api/agent/:fromId/talk-to/:toId', async (req, res) => {
    const { fromId, toId } = req.params;
    const { message } = req.body;
    
    if (!message) return res.status(400).json({ error: 'Message required' });
    
    const fromAgent = agentState.agents?.find(a => a.id === fromId);
    const toAgent = agentState.agents?.find(a => a.id === toId);
    if (!fromAgent) return res.status(404).json({ error: `Agent ${fromId} not found` });
    if (!toAgent) return res.status(404).json({ error: `Agent ${toId} not found` });
    
    try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        const escapedMessage = message.replace(/'/g, "'\\''");
        
        // Route to the target agent's REAL session
        const sessionId = `agent:${toId}:main`;
        const prefix = `[AutoLab Chat — ${fromAgent.name || fromId} is talking to you through the 3D web interface. Respond briefly.]`;
        const escapedPrefix = prefix.replace(/'/g, "'\\''");
        
        const cmd = `openclaw agent --session-id ${sessionId} --message '${escapedPrefix}\\n\\n${fromAgent.name || fromId}: ${escapedMessage}' --json`;
        
        console.log('[api] Agent-to-agent:', fromId, '->', toId, 'via session', sessionId);
        
        const { stdout } = await execAsync(cmd, { timeout: 60000, maxBuffer: 5 * 1024 * 1024 });
        
        let agentReply = 'No response';
        try {
            const result = JSON.parse(stdout);
            if (result.result?.payloads?.length > 0) {
                agentReply = result.result.payloads[0].text || 'No text';
            } else {
                const textMatch = stdout.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                if (textMatch) agentReply = JSON.parse('"' + textMatch[1] + '"');
            }
        } catch (e) {
            agentReply = 'Response received but could not parse';
        }
        
        // Broadcast the conversation via WebSocket so the 3D world shows it
        wsBroadcast({
            event: 'agent-chat',
            data: {
                from: fromId,
                fromName: fromAgent.name || fromId,
                to: toId,
                toName: toAgent.name || toId,
                message: message,
                reply: agentReply,
            }
        });
        
        res.json({ success: true, from: fromId, to: toId, message, reply: agentReply });
    } catch (error) {
        console.error('[api] Agent-to-agent failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Execute whitelisted command
const ALLOWED_COMMANDS = [
    'openclaw status',
    'openclaw gateway status',
    'openclaw session list',
    'openclaw agent --help',
];

app.post('/api/exec', async (req, res) => {
    const { command } = req.body;
    
    if (!command || typeof command !== 'string') {
        return res.status(400).json({ error: 'Command required' });
    }
    
    // Check whitelist
    const isAllowed = ALLOWED_COMMANDS.some(allowed => 
        command.startsWith(allowed)
    );
    
    if (!isAllowed) {
        return res.status(403).json({ 
            error: 'Command not allowed',
            allowed: ALLOWED_COMMANDS
        });
    }
    
    try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        const { stdout, stderr } = await execAsync(command, {
            timeout: 10000,
            maxBuffer: 1024 * 1024
        });
        
        res.json({
            success: true,
            command,
            output: stdout,
            error: stderr || null,
            exitCode: 0
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            command,
            output: error.stdout || '',
            error: error.stderr || error.message,
            exitCode: error.code || 1
        });
    }
});

// ─── Water Cooler Chat System ────────────────────────────────
const WATERCOOLER_TOPICS = [
    "What improvements could we make around the lab? Any ideas to make this place better?",
    "What have you been working on lately? Any interesting projects or breakthroughs?",
    "Learned anything cool recently? Teach me something I might not know.",
    "Any issues or bugs we should tackle? What's been bugging you?",
    "If you could add one feature to AutoLab, what would it be?",
    "What's the most interesting thing a human asked you to do this week?",
    "What's your take on how we could work together more effectively?",
    "If you had to train a new agent joining the team, what's lesson #1?",
    "What's something you wish you were better at?",
    "Any thoughts on our workflow? Something we could streamline?",
];

let waterCoolerActive = false;
let waterCoolerInterval = null;
const WATERCOOLER_SETTINGS_PATH = join(__dirname, 'watercooler-settings.json');

function loadWaterCoolerSettings() {
    try {
        if (existsSync(WATERCOOLER_SETTINGS_PATH)) {
            return JSON.parse(readFileSync(WATERCOOLER_SETTINGS_PATH, 'utf8'));
        }
    } catch (e) { /* ignore */ }
    return { enabled: true, intervalMinutes: 8 };
}

function saveWaterCoolerSettings(settings) {
    writeFileSync(WATERCOOLER_SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

async function triggerWaterCoolerChat(forcedAgents = null) {
    if (waterCoolerActive) return { error: 'Chat already in progress' };
    
    // Pick 2 agents (prefer idle ones)
    const agents = agentState.agents?.filter(a => a.id !== overseer') || [];
    if (agents.length < 2) return { error: 'Need at least 2 agents' };
    
    let pair;
    if (forcedAgents && forcedAgents.length === 2) {
        pair = forcedAgents.map(id => agents.find(a => a.id === id)).filter(Boolean);
        if (pair.length !== 2) return { error: 'Specified agents not found' };
    } else {
        // Shuffle and pick 2 — prefer idle agents
        const idle = agents.filter(a => !a.active);
        const pool = idle.length >= 2 ? idle : agents;
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        pair = shuffled.slice(0, 2);
    }
    
    const [agentA, agentB] = pair;
    const topic = WATERCOOLER_TOPICS[Math.floor(Math.random() * WATERCOOLER_TOPICS.length)];
    
    waterCoolerActive = true;
    console.log(`[watercooler] ${agentA.name} & ${agentB.name} chatting about: ${topic}`);
    
    // Broadcast that agents are walking to the water cooler
    wsBroadcast({
        type: 'watercooler-start',
        agents: [agentA.id, agentB.id],
        topic,
    });
    
    try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        const conversation = [];
        
        // Agent A starts the conversation
        const startPrompt = `[Water Cooler Chat — You're ${agentA.name}, taking a break at the water cooler in the AutoLab 3D office. ${agentB.name} just walked up. Start a casual conversation about: "${topic}". Keep it to 1-2 sentences. Be yourself — casual, opinionated, fun. Don't be generic.]`;
        
        const cmdA1 = `openclaw agent --session-id watercooler:${Date.now()} --message '${startPrompt.replace(/'/g, "'\\''")}' --json`;
        const { stdout: outA1 } = await execAsync(cmdA1, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
        const replyA1 = parseAgentReply(outA1);
        
        conversation.push({ agent: agentA.id, name: agentA.name, text: replyA1 });
        wsBroadcast({ type: 'watercooler-message', agent: agentA.id, name: agentA.name, text: replyA1 });
        
        // Wait a beat
        await new Promise(r => setTimeout(r, 3000));
        
        // Agent B responds
        const respondPrompt = `[Water Cooler Chat — You're ${agentB.name} at the water cooler in AutoLab. ${agentA.name} just said: "${replyA1}". Respond naturally in 1-2 sentences. Be yourself — agree, disagree, riff on it. If you have a concrete idea for improvement, mention it.]`;
        
        const cmdB1 = `openclaw agent --session-id watercooler:${Date.now()} --message '${respondPrompt.replace(/'/g, "'\\''")}' --json`;
        const { stdout: outB1 } = await execAsync(cmdB1, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
        const replyB1 = parseAgentReply(outB1);
        
        conversation.push({ agent: agentB.id, name: agentB.name, text: replyB1 });
        wsBroadcast({ type: 'watercooler-message', agent: agentB.id, name: agentB.name, text: replyB1 });
        
        // Wait a beat
        await new Promise(r => setTimeout(r, 3000));
        
        // Agent A wraps up
        const wrapPrompt = `[Water Cooler Chat — You're ${agentA.name}. ${agentB.name} responded: "${replyB1}". Wrap up the conversation in 1 sentence. If either of you had a good idea, say you'll add it to the board.]`;
        
        const cmdA2 = `openclaw agent --session-id watercooler:${Date.now()} --message '${wrapPrompt.replace(/'/g, "'\\''")}' --json`;
        const { stdout: outA2 } = await execAsync(cmdA2, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
        const replyA2 = parseAgentReply(outA2);
        
        conversation.push({ agent: agentA.id, name: agentA.name, text: replyA2 });
        wsBroadcast({ type: 'watercooler-message', agent: agentA.id, name: agentA.name, text: replyA2 });
        
        // End — agents walk back
        setTimeout(() => {
            wsBroadcast({ type: 'watercooler-end', agents: [agentA.id, agentB.id] });
            waterCoolerActive = false;
        }, 4000);
        
        console.log(`[watercooler] Chat complete: ${conversation.length} messages`);
        return { success: true, conversation, topic };
        
    } catch (error) {
        console.error('[watercooler] Chat failed:', error.message);
        waterCoolerActive = false;
        wsBroadcast({ type: 'watercooler-end', agents: [agentA.id, agentB.id] });
        return { error: error.message };
    }
}

function parseAgentReply(stdout) {
    try {
        const result = JSON.parse(stdout);
        if (result.result?.payloads?.length > 0) {
            return result.result.payloads[0].text || 'No response';
        }
        const textMatch = stdout.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textMatch) return JSON.parse('"' + textMatch[1] + '"');
    } catch (e) { /* ignore */ }
    return 'No response';
}

// API endpoints for water cooler
app.get('/api/watercooler/settings', (req, res) => {
    res.json(loadWaterCoolerSettings());
});

app.post('/api/watercooler/settings', (req, res) => {
    const settings = { ...loadWaterCoolerSettings(), ...req.body };
    saveWaterCoolerSettings(settings);
    
    // Restart interval if needed
    setupWaterCoolerInterval(settings);
    
    wsBroadcast({ type: 'watercooler-settings', settings });
    res.json(settings);
});

app.post('/api/watercooler/trigger', async (req, res) => {
    const { agents } = req.body || {};
    const result = await triggerWaterCoolerChat(agents);
    res.json(result);
});

function setupWaterCoolerInterval(settings) {
    if (waterCoolerInterval) clearInterval(waterCoolerInterval);
    
    if (!settings?.enabled) {
        console.log('[watercooler] Disabled');
        return;
    }
    
    const ms = (settings.intervalMinutes || 8) * 60 * 1000;
    console.log(`[watercooler] Scheduling chats every ${settings.intervalMinutes || 8} min`);
    
    waterCoolerInterval = setInterval(() => {
        const wcSettings = loadWaterCoolerSettings();
        if (wcSettings.enabled) {
            triggerWaterCoolerChat();
        }
    }, ms);
}

// ─── Start ───────────────────────────────────────────────────
async function start() {
    // Get local network IP for display
    const nets = networkInterfaces();
    let localIP = 'localhost';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                localIP = net.address;
                break;
            }
        }
    }

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🪄 AutoLab Viz Server ${VERSION}`);
        console.log(`   Local:   http://localhost:${PORT}`);
        console.log(`   Network: http://${localIP}:${PORT}\n`);
    });

    // Discovery-based gateway initialization
    try {
        gwMacB = await initGateways();
        setupPrimaryGatewayListeners();
        pollInterval = setInterval(pollHealth, 5000);
    } catch (e) {
        console.error('[discovery] Gateway init failed:', e.message || e);
        console.log('[gateway] Running with mock data until gateways are available...');
        
        agentState = {
            agents: [
                { id: 'agent-1', name: 'Agent 1', emoji: '🤖', sessions: 1, activeSessions: 1, model: 'claude-sonnet-4.5', active: true, position: { x: -2, y: 0, z: -1 }, color: '#4a9eff', deviceId: 'local-machine', channels: ['telegram'], totalTokens: 50000, burnRate: 120, cost: 0.45 }
            ],
            sessions: [],
            devices: config.devices.length > 0 ? config.devices.map(d => ({ ...d, online: d.isLocal, agentCount: d.isLocal ? 1 : 0 })) : [],
            presence: [],
            events: [],
            connections: [],
            lastUpdate: Date.now(),
            gatewayConnected: false,
            gatewayStartTime: Date.now(),
            stats: {
                totalTokens: 2550000,
                totalCost: 22.95,
                eventsToday: 0
            }
        };
    }
    
    // Start water cooler chat system
    setupWaterCoolerInterval(loadWaterCoolerSettings());
}

// ═══════════════════════════════════════════════════════════════
// AGENT CORE FILES API (SOUL.md, IDENTITY.md, AGENTS.md, etc.)
// ═══════════════════════════════════════════════════════════════

// Resolve workspace path for an agent
function getAgentWorkspace(agentId) {
    try {
        const config = JSON.parse(readFileSync(join(process.env.HOME, '.autolab/autolab.json'), 'utf8'));
        const agents = config?.agents?.list || [];
        const agent = agents.find(a => a.id === agentId);
        if (agent?.workspace) return agent.workspace;
    } catch (e) {}
    // Fallback to default path
    return join(process.env.HOME, '.autolab/workspace', agentId);
}

// Allowed core files that can be read/written
const CORE_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'USER.md', 'HEARTBEAT.md'];

// Validate filename: must end in .md, no path traversal
function isValidFilename(f) {
    return f.endsWith('.md') && !f.includes('/') && !f.includes('\\') && !f.startsWith('.');
}

// GET /api/agent/:id/files — list all .md files in workspace
app.get('/api/agent/:id/files', (req, res) => {
    const ws = getAgentWorkspace(req.params.id);
    let allMd = [];
    try {
        allMd = readdirSync(ws).filter(f => f.endsWith('.md'));
    } catch (e) {
        // Fallback: just check known core files
        allMd = CORE_FILES.filter(f => existsSync(join(ws, f)));
    }
    
    const files = allMd.map(f => {
        try {
            const content = readFileSync(join(ws, f), 'utf8');
            return { name: f, size: content.length, preview: content.slice(0, 200) };
        } catch (e) {
            return { name: f, size: 0, preview: '' };
        }
    });
    res.json({ agentId: req.params.id, workspace: ws, files });
});

// GET /api/agent/:id/file/:filename — read a core file
app.get('/api/agent/:id/file/:filename', (req, res) => {
    const { id, filename } = req.params;
    if (!isValidFilename(filename)) return res.status(403).json({ error: 'Invalid filename' });
    
    const ws = getAgentWorkspace(id);
    const filepath = join(ws, filename);
    if (!existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
    
    try {
        const content = readFileSync(filepath, 'utf8');
        res.json({ agentId: id, filename, content });
    } catch (e) {
        res.status(500).json({ error: 'Failed to read file' });
    }
});

// POST /api/agent/:id/file/:filename — write a core file (requires unlock)
app.post('/api/agent/:id/file/:filename', (req, res) => {
    const { id, filename } = req.params;
    const { content } = req.body;
    if (!isValidFilename(filename)) return res.status(403).json({ error: 'Invalid filename' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    
    const ws = getAgentWorkspace(id);
    const filepath = join(ws, filename);
    
    try {
        writeFileSync(filepath, content, 'utf8');
        res.json({ ok: true, agentId: id, filename, size: content.length });
    } catch (e) {
        res.status(500).json({ error: 'Failed to write file' });
    }
});

// ═══════════════════════════════════════════════════════════════
// AUTOLAB SETTINGS API
// ═══════════════════════════════════════════════════════════════

const SETTINGS_FILE = join(__dirname, 'autolab-settings.json');

function loadSettings() {
    try { return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}

function saveSettings(s) {
    writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

app.get('/api/settings', (req, res) => {
    res.json(loadSettings());
});

app.post('/api/settings', (req, res) => {
    const current = loadSettings();
    const merged = { ...current, ...req.body };
    saveSettings(merged);
    res.json(merged);
});

// ═══════════════════════════════════════════════════════════════
// GATEWAY MANAGEMENT API
// ═══════════════════════════════════════════════════════════════

// GET /api/gateways — list all connected gateways
app.get('/api/gateways', (req, res) => {
    const list = gateways.map((gw, idx) => ({
        id: idx,
        label: gw.label,
        url: config.network.gateways[idx]?.url || '',
        connected: gw.connected,
        isPrimary: idx === 0
    }));
    res.json({ gateways: list });
});

// GET /api/gateway/:gatewayId/agents — get all agents on a specific gateway
app.get('/api/gateway/:gatewayId/agents', async (req, res) => {
    const gatewayId = parseInt(req.params.gatewayId, 10);
    if (gatewayId < 0 || gatewayId >= gateways.length) {
        return res.status(404).json({ error: 'Gateway not found' });
    }
    
    const gw = gateways[gatewayId];
    if (!gw.connected) {
        return res.status(503).json({ error: 'Gateway not connected' });
    }
    
    try {
        const health = await gw.client.getHealth();
        const agents = Array.isArray(health?.agents) ? health.agents : [];
        res.json({
            gatewayId,
            label: gw.label,
            agents: agents.map(a => ({
                id: a.agentId || a.id,
                name: a.name || a.agentId || a.id,
                model: a.model || 'unknown',
                active: a.active !== false,
                sessions: a.sessions || 0,
                cost: a.cost || 0,
                tokens: a.totalTokens || 0
            }))
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch agents', message: e.message });
    }
});

// GET /api/gateway/:gatewayId/agent/:agentId/config — get agent config
app.get('/api/gateway/:gatewayId/agent/:agentId/config', async (req, res) => {
    const gatewayId = parseInt(req.params.gatewayId, 10);
    const { agentId } = req.params;
    
    if (gatewayId < 0 || gatewayId >= gateways.length) {
        return res.status(404).json({ error: 'Gateway not found' });
    }
    
    const gw = gateways[gatewayId];
    if (!gw.connected) {
        return res.status(503).json({ error: 'Gateway not connected' });
    }
    
    try {
        // Try to get agent config via gateway API
        const result = await gw.client.request('agent.config', { agentId });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch config', message: e.message });
    }
});

// POST /api/gateway/:gatewayId/agent/:agentId/model — change agent model
app.post('/api/gateway/:gatewayId/agent/:agentId/model', async (req, res) => {
    const gatewayId = parseInt(req.params.gatewayId, 10);
    const { agentId } = req.params;
    const { model } = req.body;
    
    if (!model) {
        return res.status(400).json({ error: 'model required' });
    }
    
    if (gatewayId < 0 || gatewayId >= gateways.length) {
        return res.status(404).json({ error: 'Gateway not found' });
    }
    
    const gw = gateways[gatewayId];
    if (!gw.connected) {
        return res.status(503).json({ error: 'Gateway not connected' });
    }
    
    try {
        // Use session-send to change model via OpenClaw
        const sessionKey = `agent:${agentId}:main`;
        await gw.client.request('session-send', {
            sessionKey,
            message: `/model ${model}`
        });
        
        res.json({ ok: true, agentId, model });
    } catch (e) {
        res.status(500).json({ error: 'Failed to change model', message: e.message });
    }
});

// GET /api/gateway/:gatewayId/agent/:agentId/files — list agent files
app.get('/api/gateway/:gatewayId/agent/:agentId/files', async (req, res) => {
    const gatewayId = parseInt(req.params.gatewayId, 10);
    const { agentId } = req.params;
    
    // If local gateway (0), use existing filesystem method
    if (gatewayId === 0) {
        const ws = getAgentWorkspace(agentId);
        let allMd = [];
        try {
            allMd = readdirSync(ws).filter(f => f.endsWith('.md'));
        } catch (e) {
            allMd = CORE_FILES.filter(f => existsSync(join(ws, f)));
        }
        
        const files = allMd.map(f => {
            try {
                const content = readFileSync(join(ws, f), 'utf8');
                return { name: f, size: content.length, preview: content.slice(0, 200) };
            } catch (e) {
                return { name: f, size: 0, preview: '' };
            }
        });
        return res.json({ agentId, gatewayId, files });
    }
    
    // Remote gateway - return list of known core files
    if (gatewayId < 0 || gatewayId >= gateways.length) {
        return res.status(404).json({ error: 'Gateway not found' });
    }
    
    const gw = gateways[gatewayId];
    if (!gw.connected) {
        return res.status(503).json({ error: 'Gateway not connected' });
    }
    
    // For remote gateways, we don't have direct filesystem access
    // Return the known core files list
    const files = CORE_FILES.map(name => ({ name, size: 0, preview: '' }));
    res.json({ agentId, gatewayId, files });
});

// GET /api/gateway/:gatewayId/agent/:agentId/file/:filename — read agent file
app.get('/api/gateway/:gatewayId/agent/:agentId/file/:filename', async (req, res) => {
    const gatewayId = parseInt(req.params.gatewayId, 10);
    const { agentId, filename } = req.params;
    
    if (!isValidFilename(filename)) {
        return res.status(403).json({ error: 'Invalid filename' });
    }
    
    // If local gateway (0), use filesystem
    if (gatewayId === 0) {
        const ws = getAgentWorkspace(agentId);
        const filepath = join(ws, filename);
        if (!existsSync(filepath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        try {
            const content = readFileSync(filepath, 'utf8');
            return res.json({ agentId, gatewayId, filename, content });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to read file' });
        }
    }
    
    // Remote gateway - use SSH/gateway API
    if (gatewayId < 0 || gatewayId >= gateways.length) {
        return res.status(404).json({ error: 'Gateway not found' });
    }
    
    const gw = gateways[gatewayId];
    if (!gw.connected) {
        return res.status(503).json({ error: 'Gateway not connected' });
    }
    
    try {
        // Use gateway API to read file
        // OpenClaw gateway might not have direct file read API, so we'll use exec
        const gatewayUrl = config.network.gateways[gatewayId].url;
        const host = new URL(gatewayUrl.replace('ws://', 'http://')).hostname;
        
        // SSH to remote machine and read file
        const { execSync } = await import('child_process');
        const workspace = `~/.openclaw/workspace/${agentId}`;
        const cmd = `ssh ${host} "cat ${workspace}/${filename}" 2>/dev/null || echo "FILE_NOT_FOUND"`;
        const content = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
        
        if (content.trim() === 'FILE_NOT_FOUND' || !content) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        res.json({ agentId, gatewayId, filename, content });
    } catch (e) {
        res.status(500).json({ error: 'Failed to read remote file', message: e.message });
    }
});

// POST /api/gateway/:gatewayId/agent/:agentId/file/:filename — write agent file
app.post('/api/gateway/:gatewayId/agent/:agentId/file/:filename', async (req, res) => {
    const gatewayId = parseInt(req.params.gatewayId, 10);
    const { agentId, filename } = req.params;
    const { content } = req.body;
    
    if (!isValidFilename(filename)) {
        return res.status(403).json({ error: 'Invalid filename' });
    }
    
    if (typeof content !== 'string') {
        return res.status(400).json({ error: 'content required' });
    }
    
    // If local gateway (0), use filesystem
    if (gatewayId === 0) {
        const ws = getAgentWorkspace(agentId);
        const filepath = join(ws, filename);
        
        try {
            writeFileSync(filepath, content, 'utf8');
            return res.json({ ok: true, agentId, gatewayId, filename, size: content.length });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to write file' });
        }
    }
    
    // Remote gateway - use SSH
    if (gatewayId < 0 || gatewayId >= gateways.length) {
        return res.status(404).json({ error: 'Gateway not found' });
    }
    
    const gw = gateways[gatewayId];
    if (!gw.connected) {
        return res.status(503).json({ error: 'Gateway not connected' });
    }
    
    try {
        const gatewayUrl = config.network.gateways[gatewayId].url;
        const host = new URL(gatewayUrl.replace('ws://', 'http://')).hostname;
        
        // SSH to remote machine and write file
        const { execSync } = await import('child_process');
        const workspace = `~/.openclaw/workspace/${agentId}`;
        const escapedContent = content.replace(/'/g, "'\\''"); // Escape single quotes
        const cmd = `ssh ${host} "cat > ${workspace}/${filename}" <<'EOF'\n${escapedContent}\nEOF`;
        execSync(cmd, { encoding: 'utf8', timeout: 10000 });
        
        res.json({ ok: true, agentId, gatewayId, filename, size: content.length });
    } catch (e) {
        res.status(500).json({ error: 'Failed to write remote file', message: e.message });
    }
});

// GET /api/gateway/:gatewayId/agent/:agentId/cron — list cron jobs
app.get('/api/gateway/:gatewayId/agent/:agentId/cron', async (req, res) => {
    const gatewayId = parseInt(req.params.gatewayId, 10);
    const { agentId } = req.params;
    
    if (gatewayId < 0 || gatewayId >= gateways.length) {
        return res.status(404).json({ error: 'Gateway not found' });
    }
    
    const gw = gateways[gatewayId];
    if (!gw.connected) {
        return res.status(503).json({ error: 'Gateway not connected' });
    }
    
    try {
        const result = await gw.client.request('cron.list', { includeDisabled: true });
        res.json({ agentId, gatewayId, jobs: result.jobs || [] });
    } catch (e) {
        res.status(500).json({ error: 'Failed to list cron jobs', message: e.message });
    }
});

// POST /api/gateway/:gatewayId/agent/:agentId/cron — create/update cron job
app.post('/api/gateway/:gatewayId/agent/:agentId/cron', async (req, res) => {
    const gatewayId = parseInt(req.params.gatewayId, 10);
    const { agentId } = req.params;
    const { job } = req.body;
    
    if (!job) {
        return res.status(400).json({ error: 'job required' });
    }
    
    if (gatewayId < 0 || gatewayId >= gateways.length) {
        return res.status(404).json({ error: 'Gateway not found' });
    }
    
    const gw = gateways[gatewayId];
    if (!gw.connected) {
        return res.status(503).json({ error: 'Gateway not connected' });
    }
    
    try {
        const result = await gw.client.request('cron.add', { job });
        res.json({ ok: true, agentId, gatewayId, job: result.job });
    } catch (e) {
        res.status(500).json({ error: 'Failed to create cron job', message: e.message });
    }
});

// DELETE /api/gateway/:gatewayId/agent/:agentId/cron/:jobId — delete cron job
app.delete('/api/gateway/:gatewayId/agent/:agentId/cron/:jobId', async (req, res) => {
    const gatewayId = parseInt(req.params.gatewayId, 10);
    const { agentId, jobId } = req.params;
    
    if (gatewayId < 0 || gatewayId >= gateways.length) {
        return res.status(404).json({ error: 'Gateway not found' });
    }
    
    const gw = gateways[gatewayId];
    if (!gw.connected) {
        return res.status(503).json({ error: 'Gateway not connected' });
    }
    
    try {
        await gw.client.request('cron.remove', { jobId });
        res.json({ ok: true, agentId, gatewayId, jobId });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete cron job', message: e.message });
    }
});

// GET /api/services — list running services/ports
app.get('/api/services', (req, res) => {
    const services = [
        { name: 'AutoLab', port: 3333, url: 'http://localhost:3333', status: 'running' },
        { name: 'World Monitor', port: 3000, url: 'http://localhost:3000', status: 'running' },
        { name: 'Qwen3-TTS', port: 7860, url: 'http://localhost:7860', status: 'running' },
        { name: 'Homepage', port: 3001, url: 'http://localhost:3001', status: 'running' },
        { name: 'Trading Dashboard', port: 3200, url: 'http://localhost:3200', status: 'running' },
        { name: 'Nova Gateway', port: 18789, url: 'http://localhost:18789', status: 'running' },
    ];
    
    // Add gateways
    gateways.forEach((gw, idx) => {
        if (idx > 0 && gw.connected) {
            const gwUrl = config.network.gateways[idx].url;
            const port = gwUrl.match(/:(\d+)/)?.[1] || '18789';
            services.push({
                name: `${gw.label} Gateway`,
                port: parseInt(port),
                url: gwUrl.replace('ws://', 'http://'),
                status: gw.connected ? 'running' : 'stopped'
            });
        }
    });
    
    res.json({ services });
});

start();
