# OpenClaw Viz v0.6.0 — "Living World" Overhaul

## Vision
Transform the abstract floating-orbs view into a **Sims-like living world** where AI agents are characters in a digital environment. They have a room/office, furniture, objects that represent their tools and work, and they visually move and interact when doing things.

## Design Language
- **Low-poly / stylized** (not photorealistic — keeps performance and charm)
- **Isometric-ish camera** by default (can still orbit freely)
- **Dark theme maintained** — but the "room" is lit, warm, alive
- Think: cozy hacker office meets Sims meets cyberpunk

---

## Phase 1: The Room (Environment)
Replace the empty hex-grid void with an actual space.

### Floor
- Textured floor plane — dark wood or concrete with subtle grid lines
- Defined boundaries (not infinite void)
- Slight ambient occlusion / shadow at edges

### Walls (partial)
- Two back walls (L-shaped or corner) to give depth without enclosing
- Dark material, subtle glow strips along the edges
- Can display "screens" (data panels) on the walls

### Ceiling removed (open top for camera)

### Lighting
- Overhead area light (soft, warm)
- Desk lamps per agent station (accent color matches agent)
- Subtle volumetric glow from screens

---

## Phase 2: Agent Stations (replacing floating orbs)
Each agent gets a **desk/workstation** instead of a floating ball.

### Desk Setup per Agent
- **Desk**: Low-poly desk with agent's color accent (LED strip under desk edge)
- **Monitor(s)**: 1-3 screens showing activity state
  - Idle: screensaver / dim
  - Active: code scrolling / chat bubbles
  - Tool use: screen flashes tool color
- **Chair**: Swivel chair (can rotate when agent is active)
- **Agent avatar**: Simple character sitting at desk
  - Low-poly humanoid or robot figure
  - Agent's color as accent (hair, shirt, glow)
  - Emoji floating above head
  - **Animations**: typing (active), leaning back (idle), head turn (receiving message)
- **Status LED**: Small light on desk — green/amber/red

### Agent Avatar Options (pick one)
1. **Robot/Android** — simple geometric body, glowing core in agent color, minimal face
2. **Low-poly human** — Sims-style simple character with color-coded outfit
3. **Holographic** — semi-transparent figure sitting at desk, digital/glitch aesthetic

**Recommendation: Option 3 (Holographic)** — bridges the gap between "these are AI programs" and "they have presence." Plus it's achievable with shaders.

---

## Phase 3: Digital Objects (Tool/Task Visualization)
Objects in the room represent digital concepts.

### Shared Objects
- **Server rack**: Represents the gateway — LEDs blink with events
- **Network cables/beams**: Light beams between desks = agent communication
- **Bulletin board**: Shows recent events/logs as sticky notes
- **Clock**: Real-time clock on the wall

### Per-Agent Objects
- **Inbox tray**: Messages waiting — physical letters appear/disappear
- **Coffee mug**: Fills up as token burn increases (fuel metaphor)
- **Bookshelf**: Files/knowledge — books glow when read/write tools fire
- **Phone**: Lights up on Telegram/Signal/WhatsApp messages (channel colored)
- **Terminal screen**: Shows last command when exec tool fires

### Task Animations
| Tool | Visual |
|------|--------|
| `read/write/edit` | Books fly off shelf, pages turn on screen |
| `web_search` | Globe on desk spins, search beam shoots out |
| `web_fetch` | Monitor shows loading bar |
| `message` | Paper airplane flies from desk to destination |
| `exec` | Terminal screen flashes green, keyboard sounds |
| `browser` | Monitor shows browser window popping up |
| `tts` | Speaker on desk pulses with sound waves |
| `memory_search` | Filing cabinet drawer opens, papers shuffle |

---

## Phase 4: Device Platforms (Machines)
Instead of abstract hexagons, devices are **physical machines** in the room.

### MacA (Main — has agents)
- A desk cluster / pod — agents sit around it
- Central server tower in the middle with status LEDs
- Name plate on the desk cluster

### MacB / Framework (Secondary)
- Smaller desks off to the side
- Monitor in sleep mode (dim glow)
- Single name plate
- Connection beam to main cluster (thin line)

---

## Phase 5: Interactivity
- Click agent → camera zooms to their desk, detail panel opens
- Click monitor → shows that agent's recent activity
- Click server rack → shows gateway health
- Click inbox tray → shows messages for that agent

---

## Implementation Priority

### MVP (v0.6.0-alpha) — Do First
1. **Floor + back walls** (simple geometry, textured)
2. **Desks per agent** (box geometry with color accent)
3. **Monitor screens** (plane geometry with canvas texture showing state)
4. **Agent avatars** (holographic figure — simple mesh + shader)
5. **Desk lamp** (point light in agent color)

### Polish (v0.6.0-beta)
6. Server rack object
7. Task animations (paper airplane, book fly, globe spin)
8. Coffee mug fuel meter
9. Phone object for channels

### Full (v0.6.0)
10. Smooth camera transitions
11. Click interactions on objects
12. Wall-mounted data screens
13. Sound design (optional)

---

## Technical Approach
- Keep vanilla Three.js (no React Three Fiber migration)
- Use `GLTFLoader` for complex models OR build everything from primitives
- Canvas textures for dynamic screens (already doing this for labels)
- Simple vertex shaders for holographic effect
- Maintain 60 FPS — LOD if needed
- Keep existing WebSocket data pipeline, just change the rendering

## Performance Budget
- Target: 60 FPS on integrated GPU
- Max triangles: ~100K
- Max textures: ~20 (canvas textures are cheap)
- Low-poly everything — style over complexity

---

## Questions for Dan
1. **Avatar style preference?** Robot, low-poly human, or holographic?
2. **Camera default?** Keep free orbit, or default to isometric-ish angle?
3. **Room style?** Hacker den / clean office / cyberpunk lab?
4. **Priority?** Start with desks + avatars, or room first?
