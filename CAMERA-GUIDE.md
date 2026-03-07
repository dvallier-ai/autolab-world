# 📸 Camera System - Photography Guide for Liam

## Overview

AutoLab now has 25 pre-positioned camera angles throughout the lab. These are invisible "hooks" you can snap to programmatically for perfect screenshots and videos.

**No WASD controls needed!** You just tell the API which camera angle you want, and Dan's browser flies there automatically.

---

## Quick Start

### 1. List All Camera Positions

```bash
curl http://localhost:3333/api/camera/positions | jq '.cameras[] | {id, label, desc}'
```

### 2. Set Camera to Specific Position

```bash
curl -X POST http://localhost:3333/api/camera/set \
  -H "Content-Type: application/json" \
  -d '{"id": "front-overview"}'
```

### 3. Wait for Animation (2 seconds)

```bash
sleep 2
```

### 4. Capture Screenshot

```bash
openclaw browser snapshot \
  --browser-profile clawd \
  --target-url http://localhost:3333 \
  --output /tmp/autolab-shot.png
```

---

## Available Camera Positions

| ID | Label | Best For |
|----|-------|----------|
| `front-overview` | Front Wall Overview | Command center, TV array, wide shot |
| `agents-working` | Agents at Work | Team collaboration, side angle |
| `hardware-bench` | Hardware Bench | Device/monitor close-ups |
| `lounge-area` | Lounge Area | Back wall, couch, bean bags |
| `command-center` | Command Center | Main screen, neural nexus |
| `birds-eye` | Birds Eye View | Top-down layout view |
| `agent-nova` | Nova's Desk | Nova workstation close-up |
| `agent-nexus` | Nexus's Desk | Nexus workstation close-up |
| `agent-paradox` | Paradox's Desk | Paradox workstation close-up |
| `whiteboard` | Strategy Whiteboard | Left wall diagrams/planning |
| `kanban-board` | Kanban Task Board | Right wall tickets/tasks |
| `server-rack` | Server Rack | Infrastructure, blinking lights |
| `bookshelf` | Knowledge Library | Tech books/documentation |
| `water-cooler` | Water Cooler Zone | Social hub, agent chats |
| `entrance` | Lab Entrance | View from entry door |
| `cinematic-pan` | Cinematic Pan | Dramatic sweeping angle |
| `floor-level` | Floor Level Action | Ground perspective |
| `corner-overview` | Corner Overview | Diagonal full-lab view |
| `tv-screens` | Live TV Array | Front wall data screens |
| `overseer` | Overseer View | Boss perspective |
| `agent-huddle` | Team Huddle | Close group shot |
| `night-mode` | Night Operations | Moody late-night vibe |
| `hardware-closeup` | Hardware Detail | Extreme close-up monitors |
| `activity-tracking` | Activity Timeline | Timeline visualization |
| `conference-angle` | Conference Room View | Professional meeting angle |

---

## Complete Workflow Examples

### Example 1: Single Screenshot for Twitter

```bash
#!/bin/bash
# Capture front wall overview

curl -X POST http://localhost:3333/api/camera/set \
  -H "Content-Type: application/json" \
  -d '{"id": "front-overview"}'

sleep 2

openclaw browser snapshot \
  --browser-profile clawd \
  --target-url http://localhost:3333 \
  --output /tmp/autolab-front.png

echo "Screenshot saved to /tmp/autolab-front.png"
```

### Example 2: Multiple Angles (Photo Series)

```bash
#!/bin/bash
# Capture multiple angles for a thread

ANGLES=("front-overview" "agents-working" "hardware-bench" "birds-eye")

for angle in "${ANGLES[@]}"; do
  echo "Capturing: $angle"
  
  curl -s -X POST http://localhost:3333/api/camera/set \
    -H "Content-Type: application/json" \
    -d "{\"id\": \"$angle\"}"
  
  sleep 2
  
  openclaw browser snapshot \
    --browser-profile clawd \
    --target-url http://localhost:3333 \
    --output "/tmp/autolab-${angle}.png"
done

echo "Captured ${#ANGLES[@]} screenshots"
```

### Example 3: Cinematic Tour Video

```bash
#!/bin/bash
# Fly through multiple angles for a video

TOUR=("entrance" "front-overview" "agents-working" "hardware-bench" "water-cooler" "lounge-area" "birds-eye")

# Start screen recording (macOS)
screencapture -v -R 0,0,1920,1080 /tmp/autolab-tour.mp4 &
RECORDING_PID=$!

sleep 1

for angle in "${TOUR[@]}"; do
  curl -s -X POST http://localhost:3333/api/camera/set \
    -H "Content-Type: application/json" \
    -d "{\"id\": \"$angle\"}"
  
  # Hold at each position for 3 seconds
  sleep 5
done

# Stop recording
kill $RECORDING_PID

echo "Tour video saved to /tmp/autolab-tour.mp4"
```

---

## Photography Tips

### Composition
- **`front-overview`** - Best for showing the whole operation
- **`agents-working`** - Great for "team at work" shots
- **`birds-eye`** - Architectural layout view
- **`cinematic-pan`** - Most dramatic/professional angle
- **`agent-huddle`** - Intimate team shot

### Lighting
- Virtual world has day/night cycle based on real time
- Dan can override brightness in settings (⚙️ menu)
- Default: 130% brightness (already optimized)

### Resolution
- Browser snapshots default to current window size
- Dan's browser usually at 1920x1080
- Specify larger dimensions if needed:
  ```bash
  openclaw browser snapshot \
    --browser-profile clawd \
    --width 2560 \
    --height 1440 \
    --output /tmp/autolab-4k.png
  ```

### Timing
- Camera animations take 1.5 seconds
- Add 0.5s buffer = **wait 2 seconds** after setting camera
- For video tours: 3-5 seconds per position feels natural

---

## API Reference

### GET /api/camera/positions

Returns all available camera positions with metadata.

**Response:**
```json
{
  "cameras": [
    {
      "id": "front-overview",
      "label": "Front Wall Overview",
      "desc": "Wide view of front wall with command center, TVs, agents facing screens",
      "position": { "x": 0, "y": 2.5, "z": 8 },
      "target": { "x": 0, "y": 1, "z": -8 }
    },
    ...
  ]
}
```

### POST /api/camera/set

Sets camera to specific position (broadcasts to all browsers).

**Request Body:**
```json
{
  "id": "front-overview"
}
```

**Response:**
```json
{
  "ok": true,
  "camera": {
    "id": "front-overview",
    "label": "Front Wall Overview",
    "desc": "...",
    "position": {...},
    "target": {...}
  }
}
```

**Errors:**
- `400` - Missing camera id
- `404` - Camera position not found

---

## Troubleshooting

**Camera doesn't move:**
- Check that Dan's browser is open at `http://localhost:3333`
- Verify WebSocket connection is active (see browser console)
- Try refreshing Dan's browser

**Screenshot is blank:**
- Wait 2+ seconds after setting camera (animation needs to complete)
- Ensure `--browser-profile clawd` is specified (NOT "chrome")
- Check AutoLab is actually running: `curl http://localhost:3333/api/agents`

**API returns 404:**
- Verify camera ID exists: `curl http://localhost:3333/api/camera/positions | jq '.cameras[].id'`
- Check spelling (IDs are case-sensitive, use hyphens not underscores)

---

## Next Steps

1. **Test the system** - Try capturing a single screenshot
2. **Build a photo series** - Capture 4-5 key angles
3. **Share on Twitter/X** - Spread the word about AutoLab!
4. **Experiment** - Find your favorite angles for different stories

The world is your studio. Go make some killer content! 🎬
