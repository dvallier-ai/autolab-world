# v0.6.0 Architecture — Modular Living World

## Current Problem
`app.js` is 2187 lines. Adding a full world with characters, rooms, and animations
will push it past 5000+ and make it unmaintainable.

## New Module Structure
```
public/
├── app.js              ← Main entry: scene setup, render loop, WebSocket, UI
├── modules/
│   ├── scene.js        ← Scene, camera, controls, lighting, renderer
│   ├── room.js         ← Room geometry: floor, walls, props, ambient objects
│   ├── agents.js       ← Agent workstations, avatars, animations
│   ├── devices.js      ← Device platforms/machines
│   ├── effects.js      ← Connection arcs, tool bursts, message pulses
│   ├── characters.js   ← Character models, customization, presets
│   ├── ui.js           ← Sidebar, panels, message panel, terminal, filters
│   └── data.js         ← WebSocket connection, state management, API calls
├── index.html
└── favicon.svg
```

## Migration Plan
1. Build new modules alongside existing app.js
2. Once room + agents modules work, swap app.js to import them
3. Move existing code into modules section by section
4. Each module exports init() + update(dt) functions

## Build Order
1. room.js — the environment (can overlay on current scene immediately)
2. characters.js — avatar system with presets
3. agents.js — workstation objects that replace floating orbs
4. Migrate effects.js from existing code
5. Migrate ui.js from existing code
6. Wire everything through data.js
