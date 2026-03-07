# AutoLab Automation Guide

## For AI Agents: How to Navigate, Screenshot, and Record AutoLab

### Overview
AutoLab runs at `http://localhost:3333` (or `http://localhost:3333` locally). It's a 3D virtual world built with Three.js that you can control programmatically.

---

## Method 1: Canvas Tool (Simplest - Screenshots Only)

```javascript
// Take a quick snapshot
openclaw canvas snapshot --url http://localhost:3333 --output-format png
```

**Pros:** Simple one-liner  
**Cons:** Can't control camera angle, always captures default view

---

## Method 2: Browser Tool (Full Control)

### Step 1: Open AutoLab in Browser
```bash
openclaw browser open http://localhost:3333 --browser-profile clawd
```

**CRITICAL:** Always use `--browser-profile clawd` (NOT "chrome"). The chrome profile doesn't work.

### Step 2: Wait for Scene to Load
Wait 3-5 seconds for Three.js scene to initialize.

### Step 3: Control Camera with JavaScript

#### Option A: Orbit View (Third-Person)
```javascript
// Get snapshot first to find interactive elements
openclaw browser snapshot --browser-profile clawd

// Set camera position (x, y, z)
openclaw browser act evaluate --fn "window.camera.position.set(5, 4, 8); window.camera.lookAt(0, 1, 0)" --browser-profile clawd

// Zoom in/out
openclaw browser act evaluate --fn "window.orbitControls.dollyIn(1.5)" --browser-profile clawd

// Rotate around target
openclaw browser act evaluate --fn "window.orbitControls.rotateLeft(Math.PI / 4)" --browser-profile clawd
```

#### Option B: First-Person Mode
```javascript
// Enter FPS mode (Dan's perspective)
openclaw browser act press --key p --browser-profile clawd

// Move around with WASD
openclaw browser act press --key w --browser-profile clawd  # Forward
openclaw browser act press --key a --browser-profile clawd  # Left
openclaw browser act press --key s --browser-profile clawd  # Backward
openclaw browser act press --key d --browser-profile clawd  # Right

// Look around (mouse movements via JS)
openclaw browser act evaluate --fn "window.fpYaw += 0.5" --browser-profile clawd

// Exit FPS mode
openclaw browser act press --key Escape --browser-profile clawd
```

### Step 4: Take Screenshot
```bash
openclaw browser screenshot --type png --browser-profile clawd
```

### Step 5: Close Browser
```bash
openclaw browser close --browser-profile clawd
```

---

## Method 3: Keyboard Controls (Manual Recording)

If you want smooth video, use keyboard controls:

| Key | Action |
|-----|--------|
| `P` | Toggle first-person mode |
| `WASD` | Move in FPS mode |
| `Mouse` | Look around in FPS mode |
| `F` | Toggle fullscreen |
| `ESC` | Exit FPS mode |
| Click agents | View agent details |
| Click objects | Interact (Kanban, whiteboard, etc.) |

---

## Useful Camera Positions

### Overview Shot (All Agents)
```javascript
window.camera.position.set(0, 6, 12);
window.camera.lookAt(0, 1, 0);
```

### Hardware Bench Close-Up
```javascript
window.camera.position.set(10, 2, 2);
window.camera.lookAt(10, 1, 2);
```

### Command Center (Front Wall TVs)
```javascript
window.camera.position.set(0, 3, -8);
window.camera.lookAt(0, 3, -10);
```

### Agent Workstation Close-Up
```javascript
// Get agent position first from /api/agents
// Then set camera behind them:
window.camera.position.set(agentX, 2, agentZ + 2);
window.camera.lookAt(agentX, 1, agentZ);
```

---

## API Endpoints (For Context)

### Get Agent Positions
```bash
curl http://localhost:3333/api/agents
```

### Get Current State
```bash
curl http://localhost:3333/api/state
```

### Get Hardware Devices
```bash
curl http://localhost:3333/api/hardware
```

---

## Example Workflow: Twitter Post with Screenshot

```bash
# 1. Open AutoLab
openclaw browser open http://localhost:3333 --browser-profile clawd

# 2. Wait for load
sleep 5

# 3. Set nice camera angle
openclaw browser act evaluate --fn "window.camera.position.set(0, 6, 12); window.camera.lookAt(0, 1, 0)" --browser-profile clawd

# 4. Take screenshot
openclaw browser screenshot --type png --browser-profile clawd

# 5. Post to Twitter (use your X/Twitter tool)
# Screenshot will be saved to OpenClaw temp directory

# 6. Close browser
openclaw browser close --browser-profile clawd
```

---

## Video Recording

For video, you'll need to:

1. **Use native screen recording** (macOS: `screencapture -v`, Linux: `ffmpeg`)
2. **Or use browser recording**:
```bash
# Start recording (requires browser extension or separate tool)
# Then navigate and control camera
# Stop recording and save
```

**Note:** OpenClaw doesn't have built-in video recording yet. Use external tools like:
- macOS: `screencapture -V video.mov`
- Linux: `ffmpeg -f x11grab -i :0.0 output.mp4`

---

## Troubleshooting

### "Browser profile not found"
- Use `--browser-profile clawd` (NOT `chrome`)
- Check `openclaw browser profiles`

### "Camera not responding"
- Scene may still be loading, wait longer
- Check browser console: `openclaw browser console --browser-profile clawd`

### "Screenshot is black"
- Canvas may not be ready, wait 5+ seconds after open
- Try fullscreen first: `openclaw browser act press --key f --browser-profile clawd`

---

## Advanced: Animated Camera Paths

```javascript
// Smooth camera orbit animation
const startPos = {x: 0, y: 6, z: 12};
const endPos = {x: 10, y: 6, z: 0};
const duration = 3000; // ms

window.animateCamera = (start, end, duration) => {
  const startTime = Date.now();
  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const t = 0.5 - 0.5 * Math.cos(progress * Math.PI); // easeInOutSine
    
    window.camera.position.x = start.x + (end.x - start.x) * t;
    window.camera.position.y = start.y + (end.y - start.y) * t;
    window.camera.position.z = start.z + (end.z - start.z) * t;
    window.camera.lookAt(0, 1, 0);
    
    if (progress < 1) requestAnimationFrame(animate);
  };
  animate();
};

// Use it:
window.animateCamera(startPos, endPos, 3000);
```

---

## Quick Reference

```bash
# Screenshot with custom angle
openclaw browser open http://localhost:3333 --browser-profile clawd && \
sleep 5 && \
openclaw browser act evaluate --fn "camera.position.set(0,6,12); camera.lookAt(0,1,0)" --browser-profile clawd && \
openclaw browser screenshot --browser-profile clawd

# Enter FPS mode and move forward
openclaw browser act press --key p --browser-profile clawd && \
openclaw browser act press --key w --browser-profile clawd

# Get all agent positions for framing shots
curl http://localhost:3333/api/agents | jq '.agents[] | {id, position}'
```

---

**Last Updated:** 2026-02-14  
**AutoLab Version:** v0.9.4-customize  
**Maintained by:** Nova 🪄
