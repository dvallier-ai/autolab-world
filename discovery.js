/**
 * AutoLab Network Discovery
 * 
 * Resolves gateway machines by identity (MAC address) rather than static IPs.
 * Strategy: mDNS hostname → ARP table MAC lookup → last known IP fallback
 * Verifies identity by MAC address after resolution.
 */
import { execSync } from 'child_process';
import dns from 'dns';

// ─── Known Machine Registry ─────────────────────────────────
// MAC address is the canonical identity. Everything else can change.
const MACHINE_REGISTRY = {
    'machine-a': {
        mac: 'aa:bb:cc:dd:ee:01',
        hostnames: ['machine-a.local', 'machine-a.home'],
        gatewayPort: 18789,
        label: 'MacA (Nova)',
        local: true  // This machine — always 127.0.0.1
    },
    'macb': {
        mac: 'aa:bb:cc:dd:ee:02',
        hostnames: ['machine-b.local', 'machine-b.home'],
        gatewayPort: 18789,
        tunnelPort: 18790,  // SSH tunnel for loopback-bound gateways
        label: 'MacB (Liam)',
        loopbackOnly: true  // Gateway bound to loopback — needs tunnel
    },
    'cipher': {
        mac: 'aa:bb:cc:dd:ee:03',
        hostnames: ['laptop.local', 'laptop.home', 'device-3.local'],
        gatewayPort: 18789,
        label: 'Cipher (laptop)',
        mobile: true  // May change networks
    }
};

// ─── Resolution Cache ────────────────────────────────────────
const cache = new Map();  // machineId → { ip, resolvedAt, method }
const CACHE_TTL_MS = 5 * 60 * 1000;       // 5 min for healthy
const CACHE_TTL_FAIL_MS = 30 * 1000;      // 30s for failed (retry sooner)

// ─── Core Resolution ─────────────────────────────────────────

/**
 * Resolve a machine's current IP address.
 * Returns { ip, port, wsUrl, method } or null if unreachable.
 */
export async function resolveMachine(machineId) {
    const machine = MACHINE_REGISTRY[machineId];
    if (!machine) return null;

    // Local machine — always localhost
    if (machine.local) {
        return {
            ip: '127.0.0.1',
            port: machine.gatewayPort,
            wsUrl: `ws://127.0.0.1:${machine.gatewayPort}`,
            method: 'local',
            label: machine.label,
            verified: true
        };
    }

    // Check cache
    const cached = cache.get(machineId);
    if (cached && (Date.now() - cached.resolvedAt) < CACHE_TTL_MS) {
        return cached;
    }

    // Strategy 1: mDNS / DNS hostname resolution
    let ip = await resolveHostname(machine.hostnames);
    let method = 'mdns';

    // Strategy 2: ARP table scan by MAC
    if (!ip) {
        ip = findByMac(machine.mac);
        method = 'arp';
    }

    // Strategy 3: Last known IP from cache (even if expired)
    if (!ip && cached) {
        ip = cached.ip;
        method = 'cache-fallback';
    }

    if (!ip) {
        console.log(`[discovery] ${machineId}: unreachable (all methods failed)`);
        return null;
    }

    // Verify MAC address if possible (non-blocking — ARP may be slow)
    let verified = false;
    try {
        verified = verifyMac(ip, machine.mac);
    } catch {
        // ARP timeout — skip verification
    }
    if (!verified && method === 'mdns') {
        // mDNS is generally reliable — proceed without MAC verification
        console.log(`[discovery] ${machineId}: MAC unverified at ${ip} (ARP may be slow)`);
    }

    // Determine connection method
    let port, wsUrl;
    if (machine.loopbackOnly) {
        // Needs SSH tunnel — use local tunnel port
        port = machine.tunnelPort;
        wsUrl = `ws://127.0.0.1:${machine.tunnelPort}`;
        // Ensure tunnel is up
        ensureSshTunnel(machineId, ip, machine.gatewayPort, machine.tunnelPort);
    } else {
        port = machine.gatewayPort;
        wsUrl = `ws://${ip}:${machine.gatewayPort}`;
    }

    const result = {
        ip,
        port,
        wsUrl,
        method,
        label: machine.label,
        verified,
        resolvedAt: Date.now()
    };

    cache.set(machineId, result);
    console.log(`[discovery] ${machineId}: ${ip} via ${method}${result.verified ? ' ✓' : ' (unverified)'} → ${wsUrl}`);
    return result;
}

/**
 * Resolve all known machines, return a gateway config array.
 */
export async function discoverAllGateways(tokens) {
    const results = [];
    for (const [id, machine] of Object.entries(MACHINE_REGISTRY)) {
        const resolved = await resolveMachine(id);
        if (resolved) {
            results.push({
                machineId: id,
                url: resolved.wsUrl,
                label: resolved.label,
                token: tokens[id] || '',
                ip: resolved.ip,
                method: resolved.method,
                verified: resolved.verified,
                mobile: machine.mobile || false
            });
        }
    }
    return results;
}

/**
 * Re-resolve a specific machine (called on disconnect/failure).
 */
export async function reresolveMachine(machineId) {
    cache.delete(machineId);
    return resolveMachine(machineId);
}

// ─── Hostname Resolution ─────────────────────────────────────

async function resolveHostname(hostnames) {
    for (const hostname of hostnames) {
        try {
            const result = await new Promise((resolve, reject) => {
                dns.resolve4(hostname, { ttl: false }, (err, addresses) => {
                    if (err) reject(err);
                    else resolve(addresses[0]);
                });
            });
            if (result) return result;
        } catch {
            // Try next hostname
        }
    }
    return null;
}

// ─── ARP Table Lookup ────────────────────────────────────────

function getArpTable() {
    try {
        const raw = execSync('/usr/sbin/arp -a', { timeout: 10000, encoding: 'utf8' });
        const entries = [];
        for (const line of raw.split('\n')) {
            // Format: hostname (ip) at mac on interface [type]
            const match = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([\da-f:]+)/i);
            if (match) {
                // Normalize MAC: arp may omit leading zeros (aa:bb:cc:dd:ee:01 vs aa:bb:cc:dd:ee:01)
                const mac = match[2].split(':').map(o => o.padStart(2, '0')).join(':').toLowerCase();
                entries.push({ ip: match[1], mac });
            }
        }
        return entries;
    } catch {
        return [];
    }
}

function findByMac(targetMac) {
    const normalized = targetMac.toLowerCase().split(':').map(o => o.padStart(2, '0')).join(':');
    const table = getArpTable();
    const entry = table.find(e => e.mac === normalized);
    return entry?.ip || null;
}

function verifyMac(ip, expectedMac) {
    const normalized = expectedMac.toLowerCase().split(':').map(o => o.padStart(2, '0')).join(':');
    const table = getArpTable();
    const entry = table.find(e => e.ip === ip);
    return entry?.mac === normalized;
}

// ─── SSH Tunnel Management ───────────────────────────────────

const tunnels = new Map();  // machineId → { pid, remoteIp }

function ensureSshTunnel(machineId, remoteIp, remotePort, localPort) {
    const existing = tunnels.get(machineId);

    // Check if tunnel is still alive and pointing to right IP
    if (existing) {
        if (existing.remoteIp === remoteIp && isTunnelAlive(existing.pid)) {
            return;  // Tunnel healthy
        }
        // Kill stale tunnel
        killTunnel(existing.pid);
        tunnels.delete(machineId);
    }

    // Check if something is already listening on the local port (pre-existing tunnel)
    const existingPid = findTunnelPid(localPort);
    if (existingPid) {
        tunnels.set(machineId, { pid: existingPid, remoteIp, localPort, remotePort });
        console.log(`[discovery] SSH tunnel ${machineId}: reusing existing on local:${localPort} (PID ${existingPid})`);
        return;
    }

    try {
        // Start new tunnel in background
        const cmd = `ssh -fN -o ConnectTimeout=5 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L ${localPort}:127.0.0.1:${remotePort} user@${remoteIp}`;
        execSync(cmd, { timeout: 10000, encoding: 'utf8' });

        // Find the PID
        const pid = findTunnelPid(localPort);
        if (pid) {
            tunnels.set(machineId, { pid, remoteIp, localPort, remotePort });
            console.log(`[discovery] SSH tunnel ${machineId}: local:${localPort} → ${remoteIp}:${remotePort} (PID ${pid})`);
        }
    } catch (e) {
        console.error(`[discovery] SSH tunnel ${machineId} failed: ${e.message}`);
    }
}

function isTunnelAlive(pid) {
    try {
        process.kill(pid, 0);  // Signal 0 = check existence
        return true;
    } catch {
        return false;
    }
}

function killTunnel(pid) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
}

function findTunnelPid(localPort) {
    try {
        const out = execSync(`/usr/sbin/lsof -iTCP:${localPort} -sTCP:LISTEN -t`, { timeout: 3000, encoding: 'utf8' });
        return parseInt(out.trim().split('\n')[0], 10) || null;
    } catch {
        return null;
    }
}

// ─── Periodic Re-discovery ───────────────────────────────────

let discoveryInterval = null;

export function startPeriodicDiscovery(onUpdate, intervalMs = 60000) {
    if (discoveryInterval) clearInterval(discoveryInterval);

    discoveryInterval = setInterval(async () => {
        for (const machineId of Object.keys(MACHINE_REGISTRY)) {
            const machine = MACHINE_REGISTRY[machineId];
            if (machine.local) continue;

            const prev = cache.get(machineId);
            const current = await reresolveMachine(machineId);

            if (current && prev && current.ip !== prev.ip) {
                console.log(`[discovery] ${machineId}: IP changed ${prev.ip} → ${current.ip}`);
                onUpdate(machineId, current);
            } else if (current && !prev) {
                console.log(`[discovery] ${machineId}: came online at ${current.ip}`);
                onUpdate(machineId, current);
            }
        }
    }, intervalMs);

    console.log(`[discovery] Periodic re-discovery every ${intervalMs / 1000}s`);
}

export function stopPeriodicDiscovery() {
    if (discoveryInterval) {
        clearInterval(discoveryInterval);
        discoveryInterval = null;
    }
}

// ─── Exports ─────────────────────────────────────────────────
export { MACHINE_REGISTRY };
