# v0.5.0 — Interactivity 🎮

**Status:** Planning phase  
**Started:** 2026-02-11 23:05 PT  
**Estimated time:** 6-8 hours of focused work

---

## 🎯 Goal
Transform the viz from a passive dashboard into an **interactive control center** where you can directly manipulate agents, filter views, and send commands without leaving the 3D environment.

---

## 📋 Core Features

### 1. Agent Messaging Panel
**What:** Click an agent → send it a message directly from the viz

**Implementation:**
- Slide-in panel (right side or bottom) with text input
- Shows recent conversation history with that agent
- Send button triggers `/api/agent/{id}/message` endpoint
- Real-time response display as agent processes message
- Typing indicator when agent is responding

**Backend:**
- Server needs to proxy messages to gateway
- Gateway needs to accept external message injection
- Response streaming via WebSocket

**UI Design:**
- Clean chat interface (Discord/Slack style)
- Syntax highlighting for code blocks
- Markdown rendering for agent responses
- Copy button for responses
- Clear/close panel buttons

**Estimated time:** 2-3 hours

---

### 2. Mini Terminal / REPL
**What:** Built-in terminal to run OpenClaw CLI commands without leaving browser

**Implementation:**
- Terminal emulator component (xterm.js or custom)
- Executes commands via `/api/exec` endpoint
- Command history (up/down arrows)
- Autocomplete for common commands
- Output streaming (real-time command execution)

**Security:**
- Whitelist allowed commands (openclaw status, gateway status, etc.)
- No arbitrary shell access
- Rate limiting to prevent abuse

**Commands to support:**
- `openclaw status`
- `openclaw gateway status`
- `openclaw session list`
- `openclaw agent --help`
- Custom viz commands (`viz stats`, `viz reset`, etc.)

**Estimated time:** 2 hours

---

### 3. View Filters & Highlights
**What:** Filter/highlight agents by channel, activity, cost threshold

**Implementation:**
- Filter sidebar or top bar with toggles:
  - **By channel:** Show only Telegram agents, only Discord, etc.
  - **By status:** Active only, idle only, all
  - **By cost:** High burn rate (>200/min), medium, low
  - **By model:** Group/filter by claude-opus, gpt-4, etc.
- Dim/fade filtered-out agents (don't remove, just make less visible)
- Highlight matching agents (brighter glow, thicker rings)
- Timeline filter (show only specific event types)

**UI Controls:**
- Checkbox list for channels
- Radio buttons for status
- Slider for burn rate threshold
- Model dropdown

**Visual feedback:**
- Smooth opacity transitions (fade in/out over 0.3s)
- Color-coded highlights
- Event log filters in sync with 3D view

**Estimated time:** 1.5 hours

---

### 4. Mobile-Friendly Touch Controls
**What:** Optimize for tablets/phones with touch gestures

**Implementation:**
- Touch detection (use `TouchEvent` API)
- Pinch to zoom (two-finger pinch gesture)
- Two-finger drag to pan camera
- Single tap to select agent
- Long press for context menu
- Swipe left/right to cycle between agents
- Responsive UI panels (collapse/stack on mobile)

**Testing:**
- iPad/iPhone Safari
- Android Chrome
- Responsive breakpoints (<768px, <480px)

**Estimated time:** 1-1.5 hours

---

## 🔧 Technical Architecture

### New API Endpoints

```javascript
// Send message to agent
POST /api/agent/:id/message
Body: { message: "Hello agent" }
Response: { success: true, messageId: "..." }

// Execute command
POST /api/exec
Body: { command: "openclaw status" }
Response: { output: "...", exitCode: 0 }

// Update filter state
POST /api/filter
Body: { channel: "telegram", status: "active" }
Response: { filtered: [...agentIds] }
```

### WebSocket Events (additions)

```javascript
// Agent response streaming
{ type: 'agent-response', agentId: 'nova', chunk: '...' }

// Command output streaming
{ type: 'exec-output', line: '...' }

// Filter update confirmation
{ type: 'filter-applied', activeFilters: {...} }
```

### UI Components (new)

```
public/
├── components/
│   ├── MessagePanel.js      (agent chat UI)
│   ├── Terminal.js          (mini REPL)
│   ├── FilterSidebar.js     (view filters)
│   └── TouchControls.js     (mobile gestures)
├── app.js                   (main scene - updated)
├── index.html               (layout - updated)
└── styles/
    └── interactive.css      (new component styles)
```

---

## 🎨 Design Principles

### Visual Consistency
- Match existing dark theme (#030308 bg, #4a9eff accent)
- Use JetBrains Mono font throughout
- Panel animations match existing (0.3s ease-out)
- Maintain blur/backdrop effects

### User Experience
- **Zero-click access:** Hover to preview, click to interact
- **Keyboard shortcuts:** `M` for message panel, `T` for terminal, `F` for filters
- **Undo/reset:** Easy way to clear filters or close panels
- **Non-blocking:** Panels don't cover the 3D scene completely

### Performance
- Message panel renders only when open (not hidden with CSS)
- Filter calculations happen in Web Worker (don't block render loop)
- Debounce filter changes (300ms delay)
- Lazy load terminal emulator (only when first opened)

---

## 🚀 Implementation Plan

### Phase 1: Backend Foundation (1 hour)
1. Add `/api/agent/:id/message` endpoint in `server.js`
2. Gateway message injection via WebSocket
3. Add `/api/exec` endpoint with command whitelist
4. Test both endpoints with curl/Postman

### Phase 2: Message Panel (2-3 hours)
1. Create `MessagePanel.js` component
2. Click agent → open panel with agent context
3. Text input + send button
4. Display recent conversation history
5. Real-time response streaming
6. Markdown rendering for responses
7. Polish animations & styling

### Phase 3: Terminal (2 hours)
1. Create `Terminal.js` component
2. Keyboard shortcut (`T` key) to toggle
3. Command input + execution
4. Output display with ANSI color support
5. Command history (localStorage)
6. Autocomplete for common commands

### Phase 4: Filters (1.5 hours)
1. Create `FilterSidebar.js` component
2. Channel checkboxes (Telegram, Discord, Signal, etc.)
3. Status radio buttons (active/idle/all)
4. Burn rate slider
5. Apply filters to 3D scene (opacity changes)
6. Timeline event filtering

### Phase 5: Mobile Touch (1-1.5 hours)
1. Create `TouchControls.js` module
2. Detect touch vs mouse input
3. Implement pinch-to-zoom
4. Two-finger pan
5. Responsive UI layout
6. Test on actual mobile devices

### Phase 6: Integration & Polish (1 hour)
1. Wire up keyboard shortcuts
2. Add tooltips/help overlay
3. Persist filter state to localStorage
4. Error handling & user feedback
5. Performance optimization
6. Update README with new features

---

## 🧪 Testing Checklist

- [ ] Agent message sends successfully
- [ ] Response streams in real-time
- [ ] Terminal executes whitelisted commands
- [ ] Filters dim correct agents
- [ ] Timeline filters sync with 3D view
- [ ] Touch gestures work on iPad
- [ ] Keyboard shortcuts don't conflict
- [ ] Panels close with Escape key
- [ ] No performance degradation
- [ ] Mobile layout looks good (<768px)

---

## 📝 Documentation Updates

After completion:
- Update README.md with v0.5.0 features
- Add keyboard shortcuts section
- Document new API endpoints
- Add mobile usage guide
- Create GIF/video demo of interactivity

---

## 🎯 Success Criteria

v0.5.0 is complete when:
1. ✅ Can send message to any agent from viz
2. ✅ Can run `openclaw status` in built-in terminal
3. ✅ Can filter view by channel (e.g., "show only Telegram agents")
4. ✅ Touch gestures work smoothly on iPad
5. ✅ All features are documented
6. ✅ No crashes or console errors
7. ✅ Performance stays at 60 FPS

---

## 🔮 Future Enhancements (v0.6.0+)

Ideas to consider later:
- **Voice commands:** "Nova, what's the status?" via Web Speech API
- **VR mode:** WebXR support for immersive view
- **Multi-user:** Show other people viewing the viz
- **Playback mode:** Scrub timeline and replay past events
- **Agent creation:** Spawn new agents from the viz
- **Config editor:** Edit agent settings live
- **Alert rules:** Set up notifications for high costs
- **Export:** Download logs/stats as JSON/CSV

---

**Let's build v0.5.0! 🚀**

_If I crash before completion, the next Nova should read this file and continue from the last completed phase._
