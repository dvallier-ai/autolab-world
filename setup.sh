#!/usr/bin/env bash
# AutoLab First-Run Setup Script

set -e

echo "🪄 AutoLab Setup"
echo "════════════════════════════════════════════════════════"
echo ""

# Check if config already exists
if [ -f "autolab-config.json" ]; then
    echo "⚠️  autolab-config.json already exists."
    read -p "Overwrite? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi
fi

# Detect OpenClaw config
OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"
GATEWAY_TOKEN=""
GATEWAY_URL="ws://localhost:18789"

if [ -f "$OPENCLAW_CONFIG" ]; then
    echo "✅ Found OpenClaw config at $OPENCLAW_CONFIG"
    
    # Try to extract token using grep/sed (works without jq)
    if command -v jq &> /dev/null; then
        GATEWAY_TOKEN=$(jq -r '.gateway.auth.token // empty' "$OPENCLAW_CONFIG" 2>/dev/null || echo "")
    else
        # Fallback: simple grep
        GATEWAY_TOKEN=$(grep -o '"token"[[:space:]]*:[[:space:]]*"[^"]*"' "$OPENCLAW_CONFIG" | head -1 | sed 's/.*"\([^"]*\)".*/\1/' || echo "")
    fi
    
    if [ -n "$GATEWAY_TOKEN" ]; then
        echo "✅ Detected gateway token: ${GATEWAY_TOKEN:0:8}..."
    else
        echo "⚠️  Could not auto-detect token"
    fi
else
    echo "⚠️  No OpenClaw config found at $OPENCLAW_CONFIG"
fi

echo ""
echo "Configuration:"
echo "──────────────────────────────────────────────────────"

# Gateway URL
read -p "Gateway URL [$GATEWAY_URL]: " input
[ -n "$input" ] && GATEWAY_URL="$input"

# Gateway token (if not detected)
if [ -z "$GATEWAY_TOKEN" ]; then
    read -p "Gateway Token (leave empty for none): " GATEWAY_TOKEN
fi

# Port
read -p "AutoLab Port [3333]: " PORT
[ -z "$PORT" ] && PORT=3333

# Overseer name
read -p "Overseer Name [Admin]: " OVERSEER_NAME
[ -z "$OVERSEER_NAME" ] && OVERSEER_NAME="Admin"

echo ""
echo "Writing autolab-config.json..."

# Generate config
cat > autolab-config.json <<EOF
{
  "network": {
    "port": $PORT,
    "gateways": [
      {
        "url": "$GATEWAY_URL",
        "label": "Primary Gateway",
        "token": "$GATEWAY_TOKEN"
      }
    ]
  },
  "overseer": {
    "name": "$OVERSEER_NAME",
    "displayName": "Overseer"
  },
  "devices": [
    {
      "id": "local-machine",
      "name": "Local Gateway",
      "icon": "🖥️",
      "color": "#4a9eff",
      "desc": "Primary gateway host",
      "host": "localhost",
      "user": "admin",
      "isLocal": true,
      "services": [
        { "id": "ssh", "label": "🔐 SSH Terminal", "type": "ssh" },
        { "id": "gateway", "label": "🌐 Gateway API", "type": "http", "port": 18789, "path": "/" },
        { "id": "autolab", "label": "🪄 AutoLab", "type": "http", "port": $PORT, "path": "/" }
      ]
    }
  ],
  "agents": []
}
EOF

echo "✅ Configuration saved!"
echo ""
echo "══════════════════════════════════════════════════════"
echo "Setup complete! 🎉"
echo ""
echo "Next steps:"
echo "  1. npm install        # Install dependencies"
echo "  2. npm start          # Start AutoLab server"
echo "  3. Open http://localhost:$PORT"
echo ""
echo "To add more gateways, edit autolab-config.json"
echo "See DEPLOYMENT.md for advanced configuration."
echo "══════════════════════════════════════════════════════"
