# AutoLab Viz — Roadmap

> Formerly "OpenClaw Agent Visualizer". Rebranded to **AutoLab** per Dan's direction.
> Goal: A deployable, open-source 3D agent management & visualization tool.

## Vision
A real-time 3D virtual lab where you can:
- **See** your AI agents working, chatting, thinking
- **Interact** with the environment (move furniture, click objects)
- **Manage** agents directly (edit config files, change settings, cosmetics)
- **Monitor** real data (live kanban boards, clocks, dashboards)
- **Deploy** anywhere — office labs, home setups, shared teams

---

## Phase 1: Foundation (Current — v0.6.x)
- [x] 3D room with agents, props, avatars
- [x] Chat with agents via speech bubbles
- [x] Dan's walking overseer avatar
- [x] UI toggle system (hide/show panels)
- [x] Chat history + copy
- [x] Live wall clock
- [ ] **Rebrand: OpenClaw → AutoLab** ← NOW
- [ ] **Live Kanban Board** (interactive, editable in-world) ← NOW
- [ ] Click-to-interact framework (raycasting + context menus)

## Phase 2: Object Interaction (v0.7)
- [ ] **Drag & drop furniture** — click an object, drag to reposition
- [ ] **Object settings** — right-click context menu on props (move, rotate, delete)
- [ ] **Lamp aiming** — drag lamps to shine light where you want
- [ ] **Save room layout** — persist furniture positions to JSON
- [ ] **Load room layout** — restore custom arrangements on refresh

## Phase 3: Agent Management (v0.8)
- [ ] **Agent cogwheel menu** — click agent → gear icon → settings panel
- [ ] **Edit agent files** — SOUL.md, USER.md, MEMORY.md, AGENTS.md inline editor
- [ ] **Cosmetic editor** — change agent avatar color, style, emoji, name
- [ ] **Agent config** — model selection, thinking level, channel routing
- [ ] **File browser** — navigate agent workspace from within the 3D world
- [ ] **Terminal per agent** — embedded terminal scoped to agent workspace

## Phase 4: Real Data Integrations (v0.9)
- [ ] **External kanban sync** — connect to Trello/GitHub Projects/Linear/custom API
- [ ] **Live metrics on monitors** — CPU, memory, API costs, token usage
- [ ] **Calendar on wall** — sync with Google Calendar or similar
- [ ] **Email/notification indicators** — real unread counts on desk objects
- [ ] **Git status displays** — repo state on agent monitors

## Phase 5: Deployable Package (v1.0)
- [ ] **Config file for room setup** — agents, layout, integrations, branding
- [ ] **Docker container** — one-command deploy
- [ ] **npm package** — `npx autolab-viz` to start
- [ ] **GitHub release** — public repo, README, screenshots, demo
- [ ] **Multi-instance support** — different rooms for different teams/labs
- [ ] **Auth layer** — optional password/token protection
- [ ] **Theme system** — cyberpunk, clean office, minimal, custom CSS

## Phase 6: Polish & Community (v1.x)
- [ ] Mobile-friendly touch controls
- [ ] VR/WebXR mode (stretch goal)
- [ ] Plugin system for custom objects/integrations
- [ ] Shared rooms (multiple users viewing same space)
- [ ] Sound effects & ambient audio

---

## Technical Notes
- **Stack:** Node.js + Express + Three.js (vanilla, no React)
- **Data:** Gateway WebSocket for agent state, REST API for interactions
- **Storage:** Room layout in `room-config.json`, agent config via gateway
- **Target:** 60fps on integrated GPU, <100K triangles, <20 textures
- **Style:** Low-poly cyberpunk, dark theme, blue+orange accents

## Branding
- **Name:** AutoLab (or "AutoLab Viz" for the visualization component)
- **No mention of OpenClaw** — all references replaced
- **Dan's deployment:** Office lab with different agents + external kanban

---

*Created: 2026-02-12*
*Last updated: 2026-02-12*
