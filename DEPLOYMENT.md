# Deployment Guide

This guide explains how to deploy AutoLab in different environments with zero personal data leakage.

## Pre-Deployment Checklist

Before publishing or deploying to a new network:

- [ ] Copy `autolab-config.example.json` to `autolab-config.json`
- [ ] Update gateway URLs and tokens
- [ ] Configure devices in config (or let auto-discovery handle it)
- [ ] Remove any personal IPs/hostnames from config
- [ ] Test connection to gateway: `curl http://your-gateway:18789/api/health`
- [ ] Verify no sensitive data in git: `git status`

## Deployment Scenarios

### 1. Single Gateway (Simplest)

**Use case:** One machine running OpenClaw gateway, visualizing its agents.

**autolab-config.json:**
```json
{
  "network": {
    "port": 3333,
    "gateways": [
      {
        "url": "ws://localhost:18789",
        "label": "Local Gateway",
        "token": "get-from-openclaw-config"
      }
    ]
  },
  "overseer": { "name": "Admin", "displayName": "Overseer" },
  "devices": [],
  "agents": []
}
```

Gateway token location: `~/.openclaw/openclaw.json` → `gateway.auth.token`

Start: `npm start` → open `http://localhost:3333`

### 2. Multi-Gateway (Multiple Machines)

**Use case:** Visualize agents across multiple OpenClaw instances (e.g., laptop + desktop + VPS).

**autolab-config.json:**
```json
{
  "network": {
    "port": 3333,
    "gateways": [
      {
        "url": "ws://localhost:18789",
        "label": "Primary",
        "token": "token-from-machine-1"
      },
      {
        "url": "ws://192.168.1.100:18789",
        "label": "Secondary",
        "token": "token-from-machine-2"
      }
    ]
  }
}
```

AutoLab will connect to all gateways and merge agent lists. Remote agents show with `_remote: "Secondary"` tag.

### 3. Docker Container

**Use case:** Isolated deployment, easy updates, network portability.

**Dockerfile:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3333
CMD ["node", "server.js"]
```

**docker-compose.yml:**
```yaml
version: '3.8'
services:
  autolab:
    build: .
    ports:
      - "3333:3333"
    volumes:
      - ./autolab-config.json:/app/autolab-config.json:ro
    restart: unless-stopped
    environment:
      - NODE_ENV=production
```

Run: `docker-compose up -d`

### 4. Reverse Proxy (HTTPS, Remote Access)

**Use case:** Access AutoLab from internet with SSL, behind nginx/caddy.

**Nginx config:**
```nginx
server {
    listen 443 ssl http2;
    server_name autolab.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Caddy config (simpler):**
```
autolab.example.com {
    reverse_proxy localhost:3333
}
```

Restart proxy, access via `https://autolab.example.com`

### 5. Public GitHub Release

**Use case:** Share with community, no personal data.

**Before publishing:**

1. **Audit for personal data:**
   ```bash
   # Search for IPs, usernames, tokens
   grep -r "192.168\|10.0\|172.16" .
   grep -r "your-username\|your-hostname" .
   git log --all --full-history --source -- devices-config.json
   ```

2. **Clean git history (if needed):**
   ```bash
   # Remove sensitive file from all commits
   git filter-branch --index-filter \
     'git rm --cached --ignore-unmatch devices-config.json' HEAD
   ```

3. **Add deployment docs:**
   - Copy this DEPLOYMENT.md
   - Update README.md with public repo URL
   - Include autolab-config.example.json

4. **Create release:**
   ```bash
   git tag -a v1.0.0 -m "First public release"
   git push origin v1.0.0
   ```

5. **GitHub Release page:**
   - Attach pre-built Docker image
   - Include quick-start instructions
   - Link to configuration docs

## Environment-Specific Notes

### Home Network

- Use mDNS hostnames (e.g., `ws://gateway.local:18789`) for resilience to DHCP changes
- Consider static IP for gateway host
- Open port 3333 in router for remote access (optional)

### Office/Lab

- Deploy on dedicated server or always-on workstation
- Use internal DNS for gateway URLs
- Consider auth proxy (oauth2-proxy) for team access

### Cloud (VPS/VM)

- Gateway and AutoLab can run on same VPS
- Use systemd service for auto-start:
  ```ini
  [Unit]
  Description=AutoLab 3D Visualizer
  After=network.target

  [Service]
  Type=simple
  User=autolab
  WorkingDirectory=/opt/autolab
  ExecStart=/usr/bin/node server.js
  Restart=always

  [Install]
  WantedBy=multi-user.target
  ```
- Enable: `systemctl enable autolab && systemctl start autolab`

## Security Best Practices

1. **Never commit:**
   - autolab-config.json
   - devices-config.json
   - .env with real tokens
   - agent-appearances.json (may contain custom names)

2. **Gateway token management:**
   - Rotate tokens periodically
   - Use different tokens per gateway
   - Store in environment variables, not code

3. **Network exposure:**
   - Default: bind to 0.0.0.0 (all interfaces) for LAN access
   - Restrict: change server.listen to '127.0.0.1' for localhost-only
   - Public: Use reverse proxy + HTTPS + optional auth

4. **Agent file editor:**
   - Protected by password (set in autolab-settings.json)
   - Or disable entirely by removing API routes

## Troubleshooting

**Gateway connection fails:**
- Check token is correct: `grep token ~/.openclaw/openclaw.json`
- Verify gateway is reachable: `nc -zv gateway-host 18789`
- Check gateway logs: `openclaw gateway logs`

**Multi-gateway agents not merging:**
- Ensure gateway URLs are unique
- Check remote gateway health returns agent list
- Look for "Connected to [label]" in server logs

**Config not loading:**
- Verify JSON syntax: `cat autolab-config.json | jq .`
- Check file permissions: `ls -l autolab-config.json`
- See server startup logs for config errors

**Docker container can't reach host gateway:**
- Use `host.docker.internal:18789` instead of `localhost:18789`
- Or run with `--network=host` (Linux only)

## Performance Tuning

**High latency:**
- Reduce event polling interval in server.js (default: 5s)
- Increase event cache size (MAX_EVENTS in server.js)
- Use compression (already enabled via middleware)

**Browser performance:**
- Lower bloom quality in settings
- Reduce agent count (archive inactive agents)
- Disable fog or shadows for lower-end GPUs

**Server resources:**
- PM2 cluster mode: `pm2 start server.js -i 2`
- Increase Node.js heap: `node --max-old-space-size=4096 server.js`

---

For more help, see [README.md](README.md) or open an issue on GitHub.
