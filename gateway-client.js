/**
 * AutoLab Gateway Client
 * Connects to the Gateway WS protocol v3 with proper handshake.
 */
import WebSocket from 'ws';
import crypto from 'crypto';

const GATEWAY_URL = 'ws://127.0.0.1:18789';

export class GatewayClient {
    constructor(token, url, opts = {}) {
        this.token = token;
        this.url = url || GATEWAY_URL;
        this.clientId = opts.clientId || 'autolab-control-ui';
        this.clientMode = opts.clientMode || 'webchat';
        this.ws = null;
        this.reqId = 0;
        this.pending = new Map();
        this.listeners = new Map();
        this.connected = false;
        this.snapshot = null;
        this.challengeNonce = null;
    }

    on(event, fn) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(fn);
    }

    emit(event, data) {
        const fns = this.listeners.get(event) || [];
        fns.forEach(fn => fn(data));
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url, {
                headers: { origin: this.url.replace('ws://', 'http://') }
            });

            this.ws.on('open', () => {
                console.log('[gateway] WebSocket open, waiting for challenge...');
            });

            this.ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(raw.toString());
                    this._handleMessage(msg, resolve, reject);
                } catch (e) {
                    console.error('[gateway] Parse error:', e);
                }
            });

            this.ws.on('close', (code, reason) => {
                const r = reason?.toString() || '';
                console.log(`[gateway] Closed: ${code} ${r}`);
                this.connected = false;
                this.emit('disconnect', { code, reason: r });
                // Auto-reconnect after 5s
                setTimeout(() => {
                    this.connect().catch(() => {});
                }, 5000);
            });

            this.ws.on('error', (err) => {
                console.error('[gateway] Error:', err.message);
                this.emit('error', err);
            });
        });
    }

    _sendConnect(resolve, reject) {
        const id = String(++this.reqId);
        this.pending.set(id, { 
            resolve: (payload) => {
                this.snapshot = payload?.snapshot || null;
                this.connected = true;
                console.log('[gateway] Connected successfully.');
                this.emit('snapshot', this.snapshot);
                resolve(payload);
            }, 
            reject 
        });

        this.ws.send(JSON.stringify({
            type: 'req',
            id,
            method: 'connect',
            params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                    id: this.clientId,
                    version: '0.1.0',
                    platform: 'macos',
                    mode: this.clientMode,
                    instanceId: 'autolab-viz-' + Date.now()
                },
                role: 'operator',
                scopes: ['operator.read', 'operator.admin'],
                caps: [],
                commands: [],
                permissions: {},
                auth: { token: this.token },
                locale: 'en-US',
                userAgent: 'autolab/0.1.0'
            }
        }));
    }

    async request(method, params = {}) {
        const id = String(++this.reqId);
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({
                type: 'req',
                id,
                method,
                params
            }));
        });
    }

    _handleMessage(msg, connectResolve, connectReject) {
        // Handle challenge event
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
            this.challengeNonce = msg.payload?.nonce;
            console.log('[gateway] Challenge received, sending connect...');
            this._sendConnect(connectResolve, connectReject);
            return;
        }

        if (msg.type === 'res') {
            const pending = this.pending.get(msg.id);
            if (pending) {
                this.pending.delete(msg.id);
                if (msg.ok) {
                    pending.resolve(msg.payload);
                } else {
                    console.error('[gateway] Request rejected:', msg.error);
                    pending.reject(msg.error);
                }
            }
        } else if (msg.type === 'event') {
            this.emit(msg.event, msg.payload);
            this.emit('any-event', { event: msg.event, payload: msg.payload });
        }
    }

    async getHealth() {
        return this.request('health');
    }

    async getStatus() {
        return this.request('status');
    }

    async getPresence() {
        return this.request('system-presence');
    }

    async sendMessage(sessionKey, message) {
        return this.request('session-send', {
            sessionKey,
            message
        });
    }

    close() {
        if (this.ws) this.ws.close();
    }
}
