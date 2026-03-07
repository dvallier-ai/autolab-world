// ═══════════════════════════════════════════════════════════════
// workstations.js — Agent Desk + Monitor + Character
// ═══════════════════════════════════════════════════════════════
// Each agent gets a workstation: desk, chair, monitor(s),
// character avatar, desk lamp, and status indicators.
// ═══════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { createCharacter, updateCharacter, setCharacterState, getCharacterPresets } from './characters.js';

const DESK = {
    width: 2.0,
    depth: 1.0,
    height: 0.75,
    legRadius: 0.04,
    topThickness: 0.05,
};

// ── Create a single workstation ───────────────────────────────
export function createWorkstation(agentData) {
    const group = new THREE.Group();
    const colorInt = parseInt((agentData.color || '#4a9eff').replace('#', ''), 16);
    const isActive = agentData.active;
    
    // ── Desk ──────────────────────────────────────────────────
    const desk = createDesk(colorInt, isActive);
    group.add(desk);
    
    // ── Monitor ───────────────────────────────────────────────
    const monitor = createMonitor(agentData, colorInt, isActive);
    monitor.position.set(0, DESK.height + 0.01, -DESK.depth * 0.3);
    group.add(monitor);
    
    // ── Chair ─────────────────────────────────────────────────
    const chair = createChair(colorInt);
    chair.position.set(0, 0, DESK.depth * 0.55);
    // Chair backrest is at -Z, seat opens toward +Z. We need the person
    // to face -Z (toward monitor), so flip the chair 180° so backrest is at +Z
    chair.rotation.y = Math.PI;
    group.add(chair);
    
    // ── Character avatar (seated in chair, facing monitor -Z) ──
    // Use saved appearance if available, else fall back to hash-based default
    const savedAppearances = window._agentAppearances || {};
    const fallbackMap = { 0: 'holo-standard', 1: 'holo-slim', 2: 'robot' };
    const agentIndex = (agentData.id || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0) % 3;
    const preset = savedAppearances[agentData.id]?.preset || fallbackMap[agentIndex];
    const character = createCharacter(agentData.color, preset);
    // Scale character to fit chair
    character.scale.setScalar(0.7);
    // When active: seated in chair. Hips at seat level (0.42).
    // Character legs are ~0.28 tall at 0.7 scale, so y=0.14 puts hips at seat.
    // When idle: will be repositioned by updateWorkstation to wander.
    character.position.set(0, 0.14, DESK.depth * 0.55);
    // Face the monitor (-Z direction)
    character.rotation.y = Math.PI;
    group.add(character);
    
    // Set initial animation based on activity
    setCharacterState(character, isActive ? 'typing' : 'idle');
    
    // ── Desk lamp ─────────────────────────────────────────────
    const lamp = createDeskLamp(colorInt, isActive);
    lamp.position.set(DESK.width * 0.4, DESK.height, -DESK.depth * 0.3);
    group.add(lamp);
    
    // ── Desk decorations (randomized per agent) ────────────────
    const deskDecor = pickDeskDecor(agentData.id, colorInt, agentData);
    deskDecor.forEach(item => group.add(item));
    
    // ── Name plate (above character's head, simple text) ───────
    const namePlate = createNamePlate(agentData);
    // Character top-of-head at ~1.05 (0.14 base + 0.88*0.7 height + head)
    namePlate.position.set(0, 1.5, DESK.depth * 0.55);
    group.add(namePlate);
    
    // ── (Emoji integrated into nameplate — no separate sprite) ──
    
    // ── Mood/activity indicator on desk (not floating above head) ──
    const moodSprite = createMoodSprite('😴');
    moodSprite.position.set(DESK.width * 0.25, DESK.height + 0.15, DESK.depth * 0.3);
    group.add(moodSprite);
    
    // ── Status LED on desk edge ───────────────────────────────
    const statusLed = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 8),
        new THREE.MeshBasicMaterial({
            color: isActive ? 0x4ade80 : 0x666666,
            transparent: true,
            opacity: 0.9,
        })
    );
    statusLed.position.set(-DESK.width * 0.4, DESK.height + 0.04, -DESK.depth * 0.3);
    if (window._enableBloom) window._enableBloom(statusLed);
    group.add(statusLed);
    
    // Raycast hitbox
    const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(DESK.width + 0.5, 2.5, DESK.depth + 1.5),
        new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0, depthWrite: false })
    );
    hitbox.position.set(0, 1.2, DESK.depth * 0.2);
    hitbox.userData.agentId = agentData.id;
    group.add(hitbox);
    
    group.userData = {
        agentId: agentData.id,
        character,
        monitor,
        chair,
        desk,
        lamp,
        statusLed,
        namePlate,
        moodSprite,
        hitbox,
        data: agentData,
        currentMood: isActive ? '🔥' : '😴',
        monitorCanvas: monitor.userData.canvas,
        monitorCtx: monitor.userData.ctx,
        monitorTexture: monitor.userData.texture,
        // Idle activity state
        wanderState: 'seated',  // 'seated', 'standing-up', 'walking-to', 'doing-activity', 'returning', 'sitting-down'
        wanderTarget: { x: 0, z: 0 },
        wanderTimer: 2 + Math.random() * 5,
        wanderProgress: 0,
        wanderStart: { x: 0, z: DESK.depth * 0.55 },
        seatPos: { x: 0, y: 0.14, z: DESK.depth * 0.55 },
        idleActivity: null, // current activity object
        projectile: null,   // paper ball / dart in flight
    };
    
    return group;
}

// ── Update workstation ────────────────────────────────────────
// ── Rebuild character with a new preset (live swap) ───────────
export function rebuildAgentCharacter(ws, newPreset) {
    const ud = ws.userData;
    const agentColor = ud.data.color;
    
    // Remove old character from group
    if (ud.character) {
        ws.remove(ud.character);
        // Dispose all meshes/materials in old character
        ud.character.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }
    
    // Create new character
    const character = createCharacter(agentColor, newPreset);
    character.scale.setScalar(0.7);
    character.position.set(ud.seatPos.x, ud.seatPos.y, ud.seatPos.z);
    character.rotation.y = Math.PI;
    ws.add(character);
    
    // Update references
    ud.character = character;
    ud.wanderState = 'seated';
    ud.wanderTimer = 2 + Math.random() * 4;
    
    setCharacterState(character, ud.data.active ? 'typing' : 'idle');
}

export function updateWorkstation(ws, time, dt, agentData) {
    const ud = ws.userData;
    
    const isActive = agentData?.active ?? ud.data.active;
    
    // Update monitor screen
    updateMonitorScreen(ud, time, agentData || ud.data);
    
    // Status LED
    ud.statusLed.material.color.setHex(isActive ? 0x4ade80 : 0x666666);
    
    // Desk lamp intensity
    if (ud.lamp.userData.light) {
        ud.lamp.userData.light.intensity = isActive ? 1.2 : 0.3;
    }
    
    // Chair slight rotation when active
    if (isActive) {
        ud.chair.rotation.y = Math.PI + Math.sin(time * 0.3) * 0.05;
    } else {
        ud.chair.rotation.y = Math.PI;
    }
    
    // Desk LED strip pulse when active
    const deskUd = ud.desk.userData;
    if (deskUd?.strip) {
        if (isActive) {
            deskUd.strip.material.opacity = 0.7 + Math.sin(time * 2) * 0.2;
            if (deskUd.stripLight) deskUd.stripLight.intensity = 0.4 + Math.sin(time * 2) * 0.2;
        } else {
            deskUd.strip.material.opacity = 0.25;
            if (deskUd.stripLight) deskUd.stripLight.intensity = 0.1;
        }
    }
    
    // ── Agent character behavior: seated when active, wander when idle ──
    const char = ud.character;
    const sp = ud.seatPos;
    
    // Update mood indicator
    const newMood = getMoodForState(agentData, ud.wanderState, ud.idleActivity);
    if (newMood !== ud.currentMood) {
        ud.currentMood = newMood;
        updateMoodSprite(ud.moodSprite, newMood);
    }
    
    if (isActive) {
        // Active → return to seat if wandering, then type
        if (ud.wanderState !== 'seated' && ud.wanderState !== 'sitting-down' && ud.wanderState !== 'returning') {
            // Start returning to desk
            ud.wanderState = 'returning';
            ud.wanderStart = { x: char.position.x, z: char.position.z };
            ud.wanderProgress = 0;
        }
        
        if (ud.wanderState === 'returning') {
            ud.wanderProgress += dt * 1.5;
            if (ud.wanderProgress >= 1) {
                ud.wanderState = 'seated';
                char.position.set(sp.x, sp.y, sp.z);
                char.rotation.y = Math.PI;
            } else {
                const t = ud.wanderProgress;
                char.position.x = ud.wanderStart.x + (sp.x - ud.wanderStart.x) * t;
                char.position.z = ud.wanderStart.z + (sp.z - ud.wanderStart.z) * t;
                char.position.y = sp.y * t; // ease down into seat
                // Face direction of movement
                const dx = sp.x - ud.wanderStart.x;
                const dz = sp.z - ud.wanderStart.z;
                if (Math.abs(dx) + Math.abs(dz) > 0.01) {
                    char.rotation.y = Math.atan2(dx, dz);
                }
                setCharacterState(char, 'talking'); // walking motion
            }
        } else {
            // Seated and typing
            char.position.set(sp.x, sp.y, sp.z);
            char.rotation.y = Math.PI;
            setCharacterState(char, 'typing');
        }
        ud.wanderTimer = 2 + Math.random() * 4;
        
    } else {
        // Idle → pick fun activities
        updateIdleActivity(ws, ud, char, sp, dt, time);
    }
    
    // Update character animation
    updateCharacter(char, time, dt);
    
    // Nameplate follows character head position
    if (ud.namePlate) {
        ud.namePlate.position.x = char.position.x;
        ud.namePlate.position.y = char.position.y + 1.1; // above head
        ud.namePlate.position.z = char.position.z;
    }
    
    // Mood sprite stays on desk (don't follow character)
    if (ud.moodSprite) {
        ud.moodSprite.position.y = DESK.height + 0.15 + Math.sin(time * 1.5) * 0.02;
    }
    
    // Store updated data
    ud.data = agentData || ud.data;
}

// ═══════════════════════════════════════════════════════════════
// IDLE ACTIVITIES — Fun stuff agents do when not working
// ═══════════════════════════════════════════════════════════════

// Activity spots in WORLD coordinates (room.js positions)
// The workstation group is at some world position; we convert these to local
const ACTIVITY_SPOTS = [
    { id: 'trash-hoops', world: { x: 9, z: 1.5 }, duration: 4, desc: 'shooting paper hoops' },
    { id: 'dartboard', world: { x: -8, z: -8.5 }, duration: 5, desc: 'throwing darts' },
    { id: 'water-cooler', world: { x: 7.5, z: 7 }, duration: 3, desc: 'getting water' },
    { id: 'bookshelf', world: { x: -10, z: 0 }, duration: 4, desc: 'browsing books' },
    { id: 'bean-bag', world: { x: 6, z: 6 }, duration: 6, desc: 'chilling in bean bag' },
    { id: 'stretch', world: null, duration: 3, desc: 'stretching near desk' },
    { id: 'coffee', world: { x: -6.5, z: 7 }, duration: 3, desc: 'grabbing coffee' },
    { id: 'whiteboard', world: { x: -10.5, z: 5 }, duration: 5, desc: 'doodling on corkboard' },
    { id: 'janitor', world: { x: 0, z: 3 }, duration: 8, desc: 'cleaning the floor' },
];

// ── Obstacle map for collision avoidance (world coords) ───────
// Each obstacle is { x, z, rx, rz } — center + half-extents
const OBSTACLES = [
    // Couch area
    { x: -8, z: 6, rx: 1.5, rz: 1.5 },
    // Coffee table
    { x: -6.5, z: 7, rx: 1, rz: 0.8 },
    // Server racks
    { x: 9, z: -7.5, rx: 1.5, rz: 1.5 },
    // Bookshelf
    { x: -10.5, z: 0, rx: 0.8, rz: 1.5 },
    // Mini fridge
    { x: 9.5, z: 3, rx: 0.6, rz: 0.6 },
    // Hardware bench
    { x: 9.5, z: 2, rx: 1.2, rz: 0.8 },
    // Water cooler
    { x: 7.5, z: 7, rx: 0.5, rz: 0.5 },
    // Bean bags
    { x: 6, z: 6, rx: 0.7, rz: 0.7 },
    { x: 7.5, z: 5, rx: 0.7, rz: 0.7 },
    // Magazine table
    { x: 6.5, z: 7, rx: 0.5, rz: 0.5 },
    // Coat rack
    { x: 10.5, z: 7.5, rx: 0.4, rz: 0.4 },
    // Fan
    { x: -9, z: -7, rx: 0.5, rz: 0.5 },
    // Standing plant
    { x: 10, z: -7, rx: 0.4, rz: 0.4 },
    // Reading lamp
    { x: -9.5, z: 7, rx: 0.3, rz: 0.3 },
    // Pizza stack
    { x: -5.5, z: 5.5, rx: 0.5, rz: 0.5 },
];

// Dynamic desk obstacles — registered when workstations are placed
const _deskTag = '__desk__';

export function registerDeskObstacle(worldX, worldZ) {
    // Desk is 2.0 wide x 1.0 deep, plus chair behind it at ~0.55 offset
    // Total obstacle covers desk + chair area
    OBSTACLES.push({ x: worldX, z: worldZ, rx: 1.2, rz: 1.0, tag: _deskTag });
}

export function clearDeskObstacles() {
    for (let i = OBSTACLES.length - 1; i >= 0; i--) {
        if (OBSTACLES[i].tag === _deskTag) OBSTACLES.splice(i, 1);
    }
}

// Check if a world point overlaps an obstacle (with padding)
export function isInsideObstacle(wx, wz, padding = 0.4) {
    for (const ob of OBSTACLES) {
        if (Math.abs(wx - ob.x) < ob.rx + padding && Math.abs(wz - ob.z) < ob.rz + padding) {
            return true;
        }
    }
    return false;
}

// Find a clear point near the target by nudging away from obstacles
export function findClearPoint(wx, wz, padding = 0.5) {
    if (!isInsideObstacle(wx, wz, padding)) return { x: wx, z: wz };
    // Try offsets in a spiral pattern
    const offsets = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [-1, 1], [1, -1], [-1, -1],
        [2, 0], [-2, 0], [0, 2], [0, -2],
    ];
    for (const [dx, dz] of offsets) {
        const nx = wx + dx;
        const nz = wz + dz;
        if (!isInsideObstacle(nx, nz, padding)) return { x: nx, z: nz };
    }
    return { x: wx, z: wz }; // fallback
}

function pickRandomActivity(groupWorldPos) {
    // Late night (11pm-6am): higher chance of napping instead of wandering
    const hour = new Date().getHours();
    const isLateNight = hour >= 23 || hour < 6;
    
    if (isLateNight && Math.random() < 0.6) {
        // Pick a nap spot
        const napSpots = [
            { id: 'nap', world: { x: -8, z: 6 }, duration: 15, desc: 'napping on couch' },
            { id: 'nap', world: { x: 6, z: 6 }, duration: 12, desc: 'napping in bean bag' },
            { id: 'nap', world: { x: 7.5, z: 5 }, duration: 12, desc: 'napping in bean bag' },
        ];
        const spot = napSpots[Math.floor(Math.random() * napSpots.length)];
        const clear = findClearPoint(spot.world.x, spot.world.z);
        return {
            ...spot,
            local: {
                x: clear.x - groupWorldPos.x,
                z: clear.z - groupWorldPos.z,
            },
        };
    }
    
    const spot = ACTIVITY_SPOTS[Math.floor(Math.random() * ACTIVITY_SPOTS.length)];
    if (spot.world) {
        // Find a clear point near the activity that doesn't overlap furniture
        const clear = findClearPoint(spot.world.x, spot.world.z);
        return {
            ...spot,
            local: {
                x: clear.x - groupWorldPos.x,
                z: clear.z - groupWorldPos.z,
            },
        };
    } else {
        // Near-desk activity (stretch, pace, etc.)
        return {
            ...spot,
            local: {
                x: (Math.random() - 0.5) * 2,
                z: DESK.depth * 0.55 + 1 + Math.random() * 1.5,
            },
        };
    }
}

function updateIdleActivity(group, ud, char, sp, dt, time) {
    const groupWorldPos = group.position;

    switch (ud.wanderState) {
        case 'seated': {
            ud.wanderTimer -= dt;
            if (ud.wanderTimer <= 0) {
                ud.wanderState = 'standing-up';
                ud.wanderProgress = 0;
                ud.idleActivity = pickRandomActivity(groupWorldPos);
            }
            setCharacterState(char, 'idle');
            break;
        }

        case 'standing-up': {
            ud.wanderProgress += dt * 2;
            if (ud.wanderProgress >= 1) {
                ud.wanderState = 'walking-to';
                ud.wanderStart = { x: char.position.x, z: char.position.z };
                ud.wanderTarget = ud.idleActivity.local;
                ud.wanderProgress = 0;
            } else {
                char.position.y = sp.y + ud.wanderProgress * (0 - sp.y);
            }
            setCharacterState(char, 'idle');
            break;
        }

        case 'walking-to': {
            ud.wanderProgress += dt * 0.35; // Slower walk speed
            if (ud.wanderProgress >= 1) {
                ud.wanderState = 'doing-activity';
                char.position.x = ud.wanderTarget.x;
                char.position.z = ud.wanderTarget.z;
                char.position.y = 0;
                ud.wanderTimer = ud.idleActivity.duration + Math.random() * 2;
                ud.wanderProgress = 0;
                // Spawn projectile for throwing activities
                if ((ud.idleActivity.id === 'trash-hoops' || ud.idleActivity.id === 'dartboard') && !ud.projectile) {
                    spawnProjectile(group, ud, char);
                }
            } else {
                const t = smoothstep(ud.wanderProgress);
                const nx = ud.wanderStart.x + (ud.wanderTarget.x - ud.wanderStart.x) * t;
                const nz = ud.wanderStart.z + (ud.wanderTarget.z - ud.wanderStart.z) * t;
                // No per-frame collision — destination was pre-cleared in pickRandomActivity
                char.position.x = nx;
                char.position.z = nz;
                char.position.y = 0;
                faceDirection(char, ud.wanderTarget.x - ud.wanderStart.x, ud.wanderTarget.z - ud.wanderStart.z);
                setCharacterState(char, 'talking'); // walk anim
            }
            break;
        }

        case 'doing-activity': {
            ud.wanderTimer -= dt;
            const act = ud.idleActivity;

            if (act.id === 'trash-hoops' || act.id === 'dartboard') {
                doThrowingActivity(group, ud, char, dt, time);
            } else if (act.id === 'stretch') {
                // Stretch: bob up and down, arms out
                char.position.y = Math.sin(time * 2) * 0.05;
                char.rotation.y = Math.PI + Math.sin(time * 0.8) * 0.3;
                setCharacterState(char, 'thinking');
            } else if (act.id === 'bean-bag') {
                // Sit low in bean bag
                char.position.y = -0.05;
                char.rotation.y = Math.sin(time * 0.2) * 0.1 + Math.PI * 0.5;
                setCharacterState(char, 'idle');
            } else if (act.id === 'nap') {
                // Sleeping — lie on side, gentle breathing motion
                char.position.y = -0.1;
                char.rotation.x = Math.PI / 2 * 0.85; // lie down
                char.rotation.y = Math.PI * 0.25;
                // Gentle "breathing" scale pulse
                const breathe = 1 + Math.sin(time * 0.8) * 0.015;
                char.scale.set(0.7 * breathe, 0.7, 0.7);
                setCharacterState(char, 'idle');
            } else if (act.id === 'bookshelf') {
                // Look at books, head scanning
                char.rotation.y = -Math.PI / 2 + Math.sin(time * 0.6) * 0.2;
                setCharacterState(char, 'thinking');
            } else if (act.id === 'water-cooler' || act.id === 'coffee') {
                // Stand, sip, look around
                char.rotation.y = Math.PI + Math.sin(time * 0.3) * 0.4;
                setCharacterState(char, 'idle');
            } else if (act.id === 'whiteboard') {
                // Doodling: face the wall, arm moving
                char.rotation.y = Math.PI / 2;
                setCharacterState(char, 'typing'); // arm motion
            } else if (act.id === 'janitor') {
                // Cleaning: walk in a small figure-8 pattern pushing a "mop"
                // Create mop tool if not present
                if (!ud._mopTool) {
                    const mopGroup = new THREE.Group();
                    // Stick
                    const stick = new THREE.Mesh(
                        new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6),
                        new THREE.MeshStandardMaterial({ color: 0x8B7355 })
                    );
                    stick.position.y = 0.4;
                    stick.rotation.z = 0.2;
                    mopGroup.add(stick);
                    // Mop head (flat sponge)
                    const head = new THREE.Mesh(
                        new THREE.BoxGeometry(0.2, 0.04, 0.12),
                        new THREE.MeshStandardMaterial({ color: 0x66aadd })
                    );
                    head.position.set(0.08, 0.02, 0);
                    mopGroup.add(head);
                    // Suds/bubbles (small white spheres on ground)
                    for (let i = 0; i < 3; i++) {
                        const bubble = new THREE.Mesh(
                            new THREE.SphereGeometry(0.03, 6, 6),
                            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
                        );
                        bubble.position.set(
                            (Math.random() - 0.5) * 0.3,
                            0.03,
                            (Math.random() - 0.5) * 0.3
                        );
                        mopGroup.add(bubble);
                    }
                    mopGroup.position.set(0.3, 0, 0);
                    char.add(mopGroup);
                    ud._mopTool = mopGroup;
                }
                // Figure-8 walk pattern around the activity spot
                const loopTime = 8; // seconds for full figure-8
                const phase = (time % loopTime) / loopTime * Math.PI * 2;
                const radius = 1.5;
                const fig8x = Math.sin(phase) * radius;
                const fig8z = Math.sin(phase * 2) * radius * 0.5;
                
                const localTarget = ud.idleActivity.local;
                char.position.x = localTarget.x + fig8x;
                char.position.z = localTarget.z + fig8z;
                char.position.y = 0;
                
                // Face movement direction
                const moveAngle = Math.atan2(Math.cos(phase) * radius, Math.cos(phase * 2) * radius);
                char.rotation.y = moveAngle;
                
                // Mop sway
                if (ud._mopTool) {
                    ud._mopTool.rotation.y = Math.sin(time * 3) * 0.3;
                }
                
                setCharacterState(char, 'talking'); // walk animation
            } else {
                // Generic idle look-around
                char.rotation.y = Math.sin(time * 0.5) * 0.5;
                setCharacterState(char, 'thinking');
            }

            if (ud.wanderTimer <= 0) {
                cleanupProjectile(group, ud);
                // Reset rotation/scale in case of nap
                char.rotation.x = 0;
                char.scale.set(0.7, 0.7, 0.7);
                ud.wanderState = 'returning';
                ud.wanderStart = { x: char.position.x, z: char.position.z };
                ud.wanderProgress = 0;
            }
            break;
        }

        case 'returning': {
            ud.wanderProgress += dt * 0.6; // Slower return walk speed
            if (ud.wanderProgress >= 1) {
                ud.wanderState = 'seated';
                char.position.set(sp.x, sp.y, sp.z);
                char.rotation.y = Math.PI;
                ud.wanderTimer = 4 + Math.random() * 8; // rest before next activity
                ud.idleActivity = null;
            } else {
                const t = smoothstep(ud.wanderProgress);
                const nx = ud.wanderStart.x + (sp.x - ud.wanderStart.x) * t;
                const nz = ud.wanderStart.z + (sp.z - ud.wanderStart.z) * t;
                // No per-frame collision — seat is always a valid destination
                char.position.x = nx;
                char.position.z = nz;
                char.position.y = sp.y * t; // ease down into seat at end
                faceDirection(char, sp.x - ud.wanderStart.x, sp.z - ud.wanderStart.z);
                setCharacterState(char, 'talking'); // walk anim
            }
            break;
        }

        default:
            ud.wanderState = 'seated';
            break;
    }
}

// ── Throwing activity (paper hoops / darts) ───────────────────
function spawnProjectile(group, ud, char) {
    const isTrash = ud.idleActivity.id === 'trash-hoops';
    const geo = isTrash
        ? new THREE.SphereGeometry(0.04, 6, 6)
        : new THREE.ConeGeometry(0.015, 0.1, 6);
    const mat = new THREE.MeshStandardMaterial({
        color: isTrash ? 0xeeeecc : 0xcc3333,
        roughness: 0.8,
    });
    const proj = new THREE.Mesh(geo, mat);
    proj.visible = false;
    group.add(proj);
    ud.projectile = { mesh: proj, throwing: false, throwProgress: 0, throwCount: 0 };
}

function doThrowingActivity(group, ud, char, dt, time) {
    const p = ud.projectile;
    if (!p) return;

    const isTrash = ud.idleActivity.id === 'trash-hoops';

    if (!p.throwing) {
        // Wind-up: face target, hold ball
        const targetDir = isTrash ? 0.3 : -Math.PI * 0.6;
        char.rotation.y = targetDir;
        setCharacterState(char, 'thinking'); // aiming pose

        // Throw after brief pause
        p.throwProgress += dt;
        if (p.throwProgress > 1.0) {
            p.throwing = true;
            p.throwProgress = 0;
            p.mesh.visible = true;
            p.startPos = { x: char.position.x, y: 0.8, z: char.position.z };
            // Target: slight randomness (sometimes miss!)
            const miss = (Math.random() - 0.5) * 0.5;
            p.endPos = {
                x: char.position.x + (isTrash ? 1.5 : -2) + miss,
                y: isTrash ? 0.6 : 1.2,
                z: char.position.z + (isTrash ? 0.5 : -1),
            };
        }
    } else {
        // Projectile in flight — parabolic arc
        p.throwProgress += dt * 2;
        if (p.throwProgress >= 1) {
            // Landed
            p.mesh.visible = false;
            p.throwing = false;
            p.throwProgress = 0;
            p.throwCount++;

            if (p.throwCount >= 2) {
                // Done throwing, wrap up activity early
                ud.wanderTimer = 0;
            }
        } else {
            const t = p.throwProgress;
            const arcHeight = isTrash ? 1.2 : 0.5;
            p.mesh.position.x = p.startPos.x + (p.endPos.x - p.startPos.x) * t;
            p.mesh.position.z = p.startPos.z + (p.endPos.z - p.startPos.z) * t;
            p.mesh.position.y = p.startPos.y + (p.endPos.y - p.startPos.y) * t + arcHeight * Math.sin(t * Math.PI);
            p.mesh.rotation.x += dt * 8;
            p.mesh.rotation.z += dt * 5;
        }
        setCharacterState(char, 'idle');
    }
}

function cleanupProjectile(group, ud) {
    if (ud.projectile?.mesh) {
        group.remove(ud.projectile.mesh);
        ud.projectile.mesh.geometry?.dispose();
        ud.projectile.mesh.material?.dispose();
        ud.projectile = null;
    }
    // Clean up mop tool from janitor activity
    if (ud._mopTool) {
        ud.character?.remove(ud._mopTool);
        ud._mopTool.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        ud._mopTool = null;
    }
}

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

function faceDirection(char, dx, dz) {
    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
        char.rotation.y = Math.atan2(dx, dz);
    }
}

// ── Desk geometry ─────────────────────────────────────────────
function createDesk(colorInt, isActive) {
    const desk = new THREE.Group();
    
    // Desktop surface
    const topGeo = new THREE.BoxGeometry(DESK.width, DESK.topThickness, DESK.depth);
    const topMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        roughness: 0.4,
        metalness: 0.6,
    });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = DESK.height;
    top.castShadow = true;
    top.receiveShadow = true;
    desk.add(top);
    
    // LED strip under front edge (wider, brighter for visibility)
    const stripGeo = new THREE.BoxGeometry(DESK.width * 0.9, 0.03, 0.03);
    const stripMat = new THREE.MeshBasicMaterial({
        color: colorInt,
        transparent: true,
        opacity: isActive ? 0.9 : 0.25,
    });
    const strip = new THREE.Mesh(stripGeo, stripMat);
    strip.position.set(0, DESK.height - 0.03, DESK.depth / 2);
    if (window._enableBloom) window._enableBloom(strip);
    desk.add(strip);
    
    // LED glow light (illuminates area in front of desk with agent color)
    const stripLight = new THREE.PointLight(colorInt, isActive ? 0.6 : 0.1, 3);
    stripLight.position.set(0, DESK.height - 0.05, DESK.depth / 2 + 0.2);
    desk.add(stripLight);
    desk.userData = { strip, stripLight };
    
    // Legs
    const legGeo = new THREE.CylinderGeometry(DESK.legRadius, DESK.legRadius, DESK.height, 8);
    const legMat = new THREE.MeshStandardMaterial({
        color: 0x333344,
        metalness: 0.8,
        roughness: 0.3,
    });
    
    const legPositions = [
        [-DESK.width / 2 + 0.1, DESK.height / 2, -DESK.depth / 2 + 0.1],
        [DESK.width / 2 - 0.1, DESK.height / 2, -DESK.depth / 2 + 0.1],
        [-DESK.width / 2 + 0.1, DESK.height / 2, DESK.depth / 2 - 0.1],
        [DESK.width / 2 - 0.1, DESK.height / 2, DESK.depth / 2 - 0.1],
    ];
    
    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(...pos);
        desk.add(leg);
    });
    
    return desk;
}

// ── Monitor ───────────────────────────────────────────────────
function createMonitor(agentData, colorInt, isActive) {
    const monitor = new THREE.Group();
    
    // Screen
    const screenW = 1.2;
    const screenH = 0.7;
    
    // Canvas for dynamic screen content
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 280;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    
    // Initial screen draw
    drawMonitorScreen(ctx, canvas, agentData, isActive, 0);
    
    const screenGeo = new THREE.PlaneGeometry(screenW, screenH);
    const screenMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: isActive ? 1.0 : 0.6,
    });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(0, screenH / 2 + 0.05, 0);
    screen.rotation.x = -0.15; // slight tilt back
    screen.userData.clickable = 'monitor'; // Mark as clickable for raycasting
    screen.userData.agentData = agentData; // Store agent data for overlay
    monitor.add(screen);
    
    // Monitor frame
    const frameGeo = new THREE.BoxGeometry(screenW + 0.06, screenH + 0.06, 0.04);
    const frameMat = new THREE.MeshStandardMaterial({
        color: 0x111122,
        roughness: 0.3,
        metalness: 0.8,
    });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.copy(screen.position);
    frame.position.z -= 0.025;
    frame.rotation.x = screen.rotation.x;
    monitor.add(frame);
    
    // Stand
    const standGeo = new THREE.BoxGeometry(0.06, 0.2, 0.06);
    const stand = new THREE.Mesh(standGeo, frameMat.clone());
    stand.position.set(0, 0, -0.05);
    monitor.add(stand);
    
    // Base
    const baseGeo = new THREE.BoxGeometry(0.4, 0.02, 0.2);
    const base = new THREE.Mesh(baseGeo, frameMat.clone());
    base.position.set(0, -0.01, -0.05);
    monitor.add(base);
    
    // Screen glow
    const glowLight = new THREE.PointLight(colorInt, isActive ? 0.3 : 0.05, 2);
    glowLight.position.set(0, screenH / 2, 0.3);
    monitor.add(glowLight);
    
    // Store screen reference for click detection
    screen.userData.canvas = canvas;
    screen.userData.ctx = ctx;
    screen.userData.texture = texture;
    
    monitor.userData = { canvas, ctx, texture, screen, glowLight };
    
    return monitor;
}

// ── Draw monitor screen content ───────────────────────────────
function drawMonitorScreen(ctx, canvas, agentData, isActive, time) {
    const w = canvas.width;
    const h = canvas.height;
    
    // Background
    ctx.fillStyle = isActive ? '#0a1428' : '#060610';
    ctx.fillRect(0, 0, w, h);
    
    if (isActive) {
        // Active: show "code" scrolling
        ctx.font = '11px monospace';
        ctx.fillStyle = agentData.color || '#4a9eff';
        
        const lines = [
            `> ${agentData.name || 'agent'} session active`,
            `  model: ${agentData.model || 'unknown'}`,
            `  tokens: ${(agentData.totalTokens || 0).toLocaleString()}`,
            `  burn: ${agentData.burnRate || 0}/min`,
            `  sessions: ${agentData.activeSessions || 0} active`,
            '',
            `  [${new Date().toLocaleTimeString()}] processing...`,
        ];
        
        // Scroll offset based on time
        const scrollOffset = Math.floor(time * 2) % 3;
        
        lines.forEach((line, i) => {
            const alpha = 1.0 - (i * 0.08);
            ctx.globalAlpha = Math.max(0.3, alpha);
            ctx.fillText(line, 12, 24 + (i + scrollOffset) * 16);
        });
        
        ctx.globalAlpha = 1.0;
        
        // Cursor blink
        if (Math.sin(time * 4) > 0) {
            ctx.fillRect(12, 24 + (lines.length + scrollOffset) * 16, 8, 12);
        }
        
        // Top status bar
        ctx.fillStyle = agentData.color || '#4a9eff';
        ctx.globalAlpha = 0.3;
        ctx.fillRect(0, 0, w, 3);
        ctx.globalAlpha = 1.0;
        
    } else {
        // Idle: show YouTube-style video content
        drawIdleScreen(canvas, ctx, agentData.id || agentData.name || 'agent', time);
    }
}

// ── Update monitor each frame ─────────────────────────────────
function updateMonitorScreen(ud, time, agentData) {
    // Only redraw every ~8 frames for performance
    if (Math.floor(time * 8) === Math.floor((time - 0.016) * 8)) return;
    
    const isActive = agentData.active;
    drawMonitorScreen(ud.monitorCtx, ud.monitorCanvas, agentData, isActive, time);
    ud.monitorTexture.needsUpdate = true;
}

// ── Chair ─────────────────────────────────────────────────────
function createChair(colorInt) {
    const chair = new THREE.Group();
    
    // Seat
    const seatGeo = new THREE.BoxGeometry(0.4, 0.05, 0.4);
    const seatMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        roughness: 0.6,
        metalness: 0.4,
    });
    const seat = new THREE.Mesh(seatGeo, seatMat);
    seat.position.y = 0.42;
    chair.add(seat);
    
    // Back rest
    const backGeo = new THREE.BoxGeometry(0.38, 0.45, 0.04);
    const back = new THREE.Mesh(backGeo, seatMat.clone());
    back.position.set(0, 0.67, -0.18);
    chair.add(back);
    
    // Accent stripe on back
    const stripeGeo = new THREE.BoxGeometry(0.3, 0.03, 0.045);
    const stripeMat = new THREE.MeshBasicMaterial({
        color: colorInt,
        transparent: true,
        opacity: 0.5,
    });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(0, 0.75, -0.18);
    chair.add(stripe);
    
    // Pedestal
    const pedGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8);
    const pedMat = new THREE.MeshStandardMaterial({
        color: 0x333344,
        metalness: 0.8,
        roughness: 0.3,
    });
    const ped = new THREE.Mesh(pedGeo, pedMat);
    ped.position.y = 0.22;
    chair.add(ped);
    
    // Base star (5 legs)
    for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const legGeo = new THREE.BoxGeometry(0.03, 0.02, 0.25);
        const leg = new THREE.Mesh(legGeo, pedMat.clone());
        leg.position.set(
            Math.cos(angle) * 0.12,
            0.03,
            Math.sin(angle) * 0.12
        );
        leg.rotation.y = -angle;
        chair.add(leg);
    }
    
    return chair;
}

// ── Desk lamp ─────────────────────────────────────────────────
function createDeskLamp(colorInt, isActive) {
    const lamp = new THREE.Group();
    
    // Base
    const baseGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.03, 16);
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0x222233,
        metalness: 0.7,
        roughness: 0.3,
    });
    lamp.add(new THREE.Mesh(baseGeo, baseMat));
    
    // Arm
    const armGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.4, 8);
    const arm = new THREE.Mesh(armGeo, baseMat.clone());
    arm.position.set(0, 0.2, 0);
    arm.rotation.z = 0.3;
    lamp.add(arm);
    
    // Shade
    const shadeGeo = new THREE.ConeGeometry(0.1, 0.08, 16, 1, true);
    const shadeMat = new THREE.MeshStandardMaterial({
        color: 0x222233,
        metalness: 0.5,
        roughness: 0.4,
        side: THREE.DoubleSide,
    });
    const shade = new THREE.Mesh(shadeGeo, shadeMat);
    shade.position.set(0.12, 0.38, 0);
    shade.rotation.z = 0.3;
    lamp.add(shade);
    
    // Light bulb (emissive)
    const bulbGeo = new THREE.SphereGeometry(0.03, 8, 8);
    const bulbMat = new THREE.MeshBasicMaterial({
        color: colorInt,
        transparent: true,
        opacity: isActive ? 0.9 : 0.3,
    });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(0.12, 0.35, 0);
    if (window._enableBloom) window._enableBloom(bulb);
    lamp.add(bulb);
    
    // Actual light
    const light = new THREE.SpotLight(colorInt, isActive ? 1.2 : 0.3, 4, Math.PI / 4, 0.5);
    light.position.set(0.12, 0.38, 0);
    light.target.position.set(0, 0, 0.3);
    lamp.add(light);
    lamp.add(light.target);
    
    lamp.userData = { light, bulb };
    
    return lamp;
}

// ── Name plate ────────────────────────────────────────────────
function createNamePlate(agentData) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Simple text only — no background box, like Dan's nametag
    ctx.font = 'bold 28px monospace';
    ctx.fillStyle = agentData.color || '#4a9eff';
    ctx.textAlign = 'center';
    ctx.fillText(`${agentData.emoji || ''} ${agentData.name || agentData.id}`, 128, 40);
    
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.2, 0.3, 1);
    
    return sprite;
}

// ── Mood indicator sprite ──────────────────────────────────────
function createMoodSprite(emoji) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '42px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 32, 34);
    
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.35, 0.35, 1);
    sprite.userData._moodEmoji = emoji;
    return sprite;
}

function updateMoodSprite(sprite, newEmoji) {
    if (!sprite || sprite.userData._moodEmoji === newEmoji) return;
    sprite.userData._moodEmoji = newEmoji;
    
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '42px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(newEmoji, 32, 34);
    
    if (sprite.material.map) sprite.material.map.dispose();
    sprite.material.map = new THREE.CanvasTexture(canvas);
    sprite.material.needsUpdate = true;
}

function getMoodForState(agentData, wanderState, idleActivity) {
    if (agentData?.active) {
        const sessions = agentData.activeSessions || 0;
        if (sessions > 2) return '🔥';
        return '⚡';
    }
    switch (wanderState) {
        case 'walking-to':
        case 'returning':
            return '🚶';
        case 'doing-activity': {
            // Activity-specific icons
            const actId = idleActivity?.id;
            if (actId === 'janitor') return '🧹';
            if (actId === 'coffee') return '☕';
            if (actId === 'trash-hoops') return '🏀';
            if (actId === 'dartboard') return '🎯';
            if (actId === 'bean-bag' || actId === 'nap') return '💤';
            if (actId === 'bookshelf') return '📖';
            if (actId === 'water-cooler') return '🚰';
            if (actId === 'whiteboard') return '✏️';
            if (actId === 'stretch') return '🧘';
            return '😊';
        }
        default: return '😴';
    }
}

// ── Emoji sprite ──────────────────────────────────────────────
function createEmojiSprite(emoji) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '48px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 32, 36);
    
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.4, 0.4, 1);
    
    return sprite;
}

// ── Randomized desk decoration system ──────────────────────────
// Deterministic seed from agent ID so same agent always gets same decor
function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}

function pickDeskDecor(agentId, colorInt, agentData) {
    const seed = hashStr(agentId || 'default');
    const items = [];
    
    // Slot 1: Left side of desk — always a personal item
    const leftItems = ['photo', 'plant', 'figurine', 'snow-globe'];
    const leftPick = leftItems[seed % leftItems.length];
    const leftItem = createDecorItem(leftPick, colorInt, agentData, seed);
    leftItem.position.set(-DESK.width * 0.35, DESK.height + 0.01, -DESK.depth * 0.3);
    items.push(leftItem);
    
    // Slot 2: Right front — drink
    const drinkItems = ['energy-can', 'coffee-cup', 'water-bottle'];
    const drinkPick = drinkItems[(seed >> 3) % drinkItems.length];
    const drink = createDecorItem(drinkPick, colorInt, agentData, seed);
    drink.position.set(DESK.width * 0.15, DESK.height + 0.01, DESK.depth * 0.2);
    items.push(drink);
    
    // Slot 3 (50% chance): Extra item near monitor
    if ((seed >> 6) % 2 === 0) {
        const extraItems = ['sticky-notes', 'headphones', 'rubiks-cube', 'stress-ball'];
        const extraPick = extraItems[(seed >> 8) % extraItems.length];
        const extra = createDecorItem(extraPick, colorInt, agentData, seed);
        extra.position.set(-DESK.width * 0.1, DESK.height + 0.01, -DESK.depth * 0.15);
        items.push(extra);
    }
    
    return items;
}

function createDecorItem(type, colorInt, agentData, seed) {
    switch (type) {
        case 'photo': return createPhotoFrame(agentData);
        case 'plant': return createDeskPlant(colorInt);
        case 'figurine': return createDeskFigurine(colorInt, seed);
        case 'snow-globe': return createSnowGlobe(colorInt);
        case 'energy-can': return createDeskCan(colorInt);
        case 'coffee-cup': return createCoffeeCup(colorInt);
        case 'water-bottle': return createWaterBottle();
        case 'sticky-notes': return createStickyNotes(colorInt, seed);
        case 'headphones': return createHeadphones(colorInt);
        case 'rubiks-cube': return createRubiksCube();
        case 'stress-ball': return createStressBall(colorInt);
        default: return createDeskCan(colorInt);
    }
}

// ── Photo frame (desk decoration) ─────────────────────────────
function createPhotoFrame(agentData) {
    const frame = new THREE.Group();
    const colorInt = parseInt((agentData.color || '#4a9eff').replace('#', ''), 16);
    
    // Frame body (small standing frame)
    const frameMat = new THREE.MeshStandardMaterial({
        color: 0x333344, metalness: 0.7, roughness: 0.3,
    });
    const border = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.12, 0.015), frameMat
    );
    border.position.y = 0.08;
    frame.add(border);
    
    // Photo canvas — unique per agent
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    
    // Draw a tiny "family portrait" scene with agent's color
    const col = agentData.color || '#4a9eff';
    ctx.fillStyle = '#1a1a3a';
    ctx.fillRect(0, 0, 64, 48);
    
    // Little stick figures (family)
    ctx.fillStyle = col;
    // Main figure
    ctx.beginPath();
    ctx.arc(22, 16, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(20, 21, 4, 10);
    // Smaller figure (kid/pet)
    ctx.beginPath();
    ctx.arc(38, 20, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(36, 24, 4, 7);
    // Heart
    ctx.fillStyle = '#ff6688';
    ctx.font = '10px serif';
    ctx.fillText('♥', 28, 38);
    
    const photoTex = new THREE.CanvasTexture(canvas);
    const photo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.11, 0.08),
        new THREE.MeshBasicMaterial({ map: photoTex })
    );
    photo.position.set(0, 0.08, 0.009);
    frame.add(photo);
    
    // Frame stand (tiny back strut)
    const stand = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, 0.07, 0.04), frameMat
    );
    stand.position.set(0, 0.05, -0.025);
    stand.rotation.x = 0.3;
    frame.add(stand);
    
    return frame;
}

// ── Desk energy drink can ─────────────────────────────────────
function createDeskCan(colorInt) {
    const can = new THREE.Group();
    
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.07, 8),
        new THREE.MeshStandardMaterial({ color: colorInt, roughness: 0.3, metalness: 0.7 })
    );
    body.position.y = 0.035;
    can.add(body);
    
    const top = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.02, 0.004, 8),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 })
    );
    top.position.y = 0.07;
    can.add(top);
    
    return can;
}

// ── Desk plant (tiny succulent) ────────────────────────────────
function createDeskPlant(colorInt) {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.025, 0.04, 8),
        new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8 })
    );
    pot.position.y = 0.02;
    g.add(pot);
    const dirt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.028, 0.005, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 })
    );
    dirt.position.y = 0.042;
    g.add(dirt);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d8a4e, roughness: 0.6 });
    for (let i = 0; i < 3; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), leafMat);
        leaf.position.set(Math.cos(i * 2.1) * 0.012, 0.06 + i * 0.01, Math.sin(i * 2.1) * 0.012);
        g.add(leaf);
    }
    return g;
}

// ── Desk figurine (little robot/animal) ────────────────────────
function createDeskFigurine(colorInt, seed) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: colorInt, roughness: 0.4, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.02), mat);
    body.position.y = 0.04;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), mat);
    head.position.y = 0.075;
    g.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const x of [-0.007, 0.007]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.004, 4, 4), eyeMat);
        eye.position.set(x, 0.078, 0.015);
        g.add(eye);
    }
    return g;
}

// ── Snow globe ────────────────────────────────────────────────
function createSnowGlobe(colorInt) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.035, 0.015, 12),
        new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.5 })
    );
    base.position.y = 0.0075;
    g.add(base);
    const globe = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xaaccff, transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.2 })
    );
    globe.position.y = 0.04;
    g.add(globe);
    const tree = new THREE.Mesh(
        new THREE.ConeGeometry(0.01, 0.025, 6),
        new THREE.MeshStandardMaterial({ color: 0x2d8a4e })
    );
    tree.position.y = 0.03;
    g.add(tree);
    return g;
}

// ── Coffee cup ────────────────────────────────────────────────
function createCoffeeCup(colorInt) {
    const g = new THREE.Group();
    const cupMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.05, 8), cupMat);
    body.position.y = 0.025;
    g.add(body);
    const coffee = new THREE.Mesh(
        new THREE.CircleGeometry(0.02, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a1a0a })
    );
    coffee.position.y = 0.049;
    coffee.rotation.x = -Math.PI / 2;
    g.add(coffee);
    const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.012, 0.003, 6, 8, Math.PI),
        cupMat
    );
    handle.position.set(0.028, 0.025, 0);
    handle.rotation.z = Math.PI / 2;
    g.add(handle);
    return g;
}

// ── Water bottle ──────────────────────────────────────────────
function createWaterBottle() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4488cc, transparent: true, opacity: 0.6, roughness: 0.2 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 8), mat);
    body.position.y = 0.04;
    g.add(body);
    const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.018, 0.012, 8),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 })
    );
    cap.position.y = 0.085;
    g.add(cap);
    return g;
}

// ── Sticky notes ──────────────────────────────────────────────
function createStickyNotes(colorInt, seed) {
    const g = new THREE.Group();
    const colors = [0xffee88, 0xff88aa, 0x88ddff, 0x88ffaa];
    for (let i = 0; i < 3; i++) {
        const note = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.002, 0.04),
            new THREE.MeshStandardMaterial({ color: colors[(seed + i) % colors.length], roughness: 0.9 })
        );
        note.position.set(i * 0.008 - 0.008, 0.001 + i * 0.002, i * 0.006);
        note.rotation.y = (i - 1) * 0.15;
        g.add(note);
    }
    return g;
}

// ── Headphones on desk ────────────────────────────────────────
function createHeadphones(colorInt) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.3 });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 12, Math.PI), mat);
    band.position.y = 0.04;
    band.rotation.x = Math.PI;
    g.add(band);
    for (const x of [-0.03, 0.03]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 8), mat);
        cup.position.set(x, 0.012, 0);
        g.add(cup);
    }
    g.rotation.x = Math.PI / 2;
    g.position.y = 0.015;
    return g;
}

// ── Rubik's cube ──────────────────────────────────────────────
function createRubiksCube() {
    const g = new THREE.Group();
    const size = 0.008;
    const gap = 0.009;
    const cubeColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xffa500, 0xffffff];
    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                const cube = new THREE.Mesh(
                    new THREE.BoxGeometry(size, size, size),
                    new THREE.MeshStandardMaterial({ color: cubeColors[Math.abs(x + y + z + 3) % 6], roughness: 0.3 })
                );
                cube.position.set(x * gap, y * gap + 0.015, z * gap);
                g.add(cube);
            }
        }
    }
    return g;
}

// ── Stress ball ───────────────────────────────────────────────
function createStressBall(colorInt) {
    const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 12, 12),
        new THREE.MeshStandardMaterial({ color: colorInt, roughness: 0.8 })
    );
    ball.position.y = 0.02;
    return ball;
}

// ── Idle monitor content (YouTube-style videos when idle) ─────
// Canvas-based "video" screens that cycle through content
const IDLE_SCREEN_CONTENT = [
    // YouTube-style
    { site: 'youtube', title: '▶ How Neural Networks Learn', channel: 'AI Academy', color: '#ff4444', progress: 0.35 },
    { site: 'youtube', title: '▶ Advanced Prompt Engineering', channel: 'Token Forge', color: '#44aaff', progress: 0.72 },
    { site: 'youtube', title: '▶ Building AI Agents from Scratch', channel: 'CodeCraft', color: '#44ff88', progress: 0.58 },
    // X/Twitter-style
    { site: 'x', author: '@OpenAI', text: 'Announcing GPT-5 Turbo — fastest model yet with 2M context. Available today for all tiers.', likes: '42.1K', reposts: '8.3K', color: '#1d9bf0' },
    { site: 'x', author: '@elonmusk', text: 'The AI agent economy is here. Autonomous agents transacting on-chain. Wild times.', likes: '128K', reposts: '24K', color: '#1d9bf0' },
    { site: 'x', author: '@karpathy', text: 'The best way to learn AI is to build AI agents. Start with tool use, add memory, then autonomy.', likes: '15.7K', reposts: '3.2K', color: '#1d9bf0' },
    // Reddit-style
    { site: 'reddit', sub: 'r/LocalLLaMA', title: 'Llama 4 70B beats GPT-4 on coding benchmarks — tested with 50 real projects', upvotes: '2.4K', comments: '847', color: '#ff4500' },
    { site: 'reddit', sub: 'r/singularity', title: 'AI agents just autonomously negotiated a $50K contract. No human in the loop.', upvotes: '5.1K', comments: '1.2K', color: '#ff4500' },
    // GitHub-style
    { site: 'github', repo: 'anthropics/claude-code', desc: 'CLI coding agent — edit code, run tests, commit', stars: '48.2K', lang: 'TypeScript', color: '#238636' },
    { site: 'github', repo: 'autolab/autolab', desc: 'Open-source AI agent orchestration platform', stars: '12.5K', lang: 'JavaScript', color: '#238636' },
    // Hacker News-style
    { site: 'hn', title: 'Show HN: I built a 3D visualization for my AI agent lab', points: '342', comments: '127', color: '#ff6600' },
    { site: 'hn', title: 'The agent economy needs better payment rails (2026)', points: '518', comments: '203', color: '#ff6600' },
    // Crypto dashboard-style
    { site: 'crypto', coin: 'BTC', price: '$127,450', change: '+3.2%', color: '#f7931a' },
    { site: 'crypto', coin: 'SOL', price: '$384.20', change: '+8.7%', color: '#9945ff' },
];

export function drawIdleScreen(canvas, ctx, agentId, time) {
    const seed = hashStr(agentId || 'x');
    const contentIdx = (seed + Math.floor(time / 30)) % IDLE_SCREEN_CONTENT.length;
    const content = IDLE_SCREEN_CONTENT[contentIdx];
    const w = canvas.width;
    const h = canvas.height;
    
    switch (content.site) {
        case 'youtube': drawYouTubeScreen(ctx, w, h, content, seed, contentIdx, time); break;
        case 'x': drawXScreen(ctx, w, h, content, seed, time); break;
        case 'reddit': drawRedditScreen(ctx, w, h, content, seed); break;
        case 'github': drawGitHubScreen(ctx, w, h, content, seed); break;
        case 'hn': drawHNScreen(ctx, w, h, content, seed); break;
        case 'crypto': drawCryptoScreen(ctx, w, h, content, seed, time); break;
        default: drawYouTubeScreen(ctx, w, h, content, seed, contentIdx, time);
    }
}

function drawYouTubeScreen(ctx, w, h, content, seed, contentIdx, time) {
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, w, h);
    
    const thumbH = h * 0.6;
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(0, 0, w, thumbH);
    
    // Play icon
    ctx.fillStyle = content.color + '88';
    ctx.beginPath();
    ctx.arc(w / 2, thumbH / 2, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 4, thumbH / 2 - 6);
    ctx.lineTo(w / 2 + 6, thumbH / 2);
    ctx.lineTo(w / 2 - 4, thumbH / 2 + 6);
    ctx.fill();
    
    const scanY = (time * 20) % thumbH;
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, scanY, w, 2);
    
    // Progress bar
    ctx.fillStyle = '#333';
    ctx.fillRect(0, thumbH, w, 3);
    const animProgress = (content.progress + (time % 30) / 30 * 0.1) % 1;
    ctx.fillStyle = content.color;
    ctx.fillRect(0, thumbH, w * animProgress, 3);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 7px sans-serif';
    ctx.fillText(content.title, 4, thumbH + 16, w - 8);
    ctx.fillStyle = '#888888';
    ctx.font = '6px sans-serif';
    ctx.fillText(content.channel, 4, thumbH + 28);
    const views = ((seed * 7 + contentIdx * 13) % 900 + 100) + 'K views';
    ctx.fillText(views, 4, thumbH + 38);
}

function drawXScreen(ctx, w, h, content, seed, time) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    
    // X logo top bar
    ctx.fillStyle = '#16181c';
    ctx.fillRect(0, 0, w, 20);
    ctx.fillStyle = '#e7e9ea';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('𝕏', w / 2 - 4, 14);
    
    // Author
    ctx.fillStyle = '#e7e9ea';
    ctx.font = 'bold 7px sans-serif';
    ctx.fillText(content.author, 8, 38);
    
    // Tweet text — word wrap
    ctx.fillStyle = '#d6d9db';
    ctx.font = '6px sans-serif';
    const words = content.text.split(' ');
    let line = '';
    let y = 52;
    for (const word of words) {
        const test = line + word + ' ';
        if (ctx.measureText(test).width > w - 16) {
            ctx.fillText(line, 8, y);
            line = word + ' ';
            y += 10;
        } else {
            line = test;
        }
    }
    ctx.fillText(line, 8, y);
    
    // Engagement bar
    const barY = h - 24;
    ctx.fillStyle = '#333';
    ctx.fillRect(0, barY, w, 1);
    ctx.fillStyle = '#71767b';
    ctx.font = '6px sans-serif';
    ctx.fillText(`💬 ${((seed * 3) % 200 + 10)}`, 8, barY + 14);
    ctx.fillText(`🔁 ${content.reposts}`, w * 0.3, barY + 14);
    ctx.fillText(`❤️ ${content.likes}`, w * 0.6, barY + 14);
    
    // Blinking cursor at bottom of tweet
    if (Math.sin(time * 3) > 0) {
        ctx.fillStyle = content.color;
        ctx.fillRect(8, y + 6, 4, 1);
    }
}

function drawRedditScreen(ctx, w, h, content, seed) {
    ctx.fillStyle = '#1a1a1b';
    ctx.fillRect(0, 0, w, h);
    
    // Reddit nav bar
    ctx.fillStyle = '#272729';
    ctx.fillRect(0, 0, w, 18);
    ctx.fillStyle = content.color;
    ctx.font = 'bold 8px sans-serif';
    ctx.fillText('reddit', 6, 13);
    
    // Subreddit
    ctx.fillStyle = '#818384';
    ctx.font = '6px sans-serif';
    ctx.fillText(content.sub, 8, 32);
    
    // Upvote column
    ctx.fillStyle = content.color;
    ctx.font = 'bold 7px sans-serif';
    ctx.fillText('▲', 8, 56);
    ctx.fillStyle = '#d7dadc';
    ctx.fillText(content.upvotes, 6, 68);
    ctx.fillStyle = '#818384';
    ctx.fillText('▼', 8, 80);
    
    // Post title
    ctx.fillStyle = '#d7dadc';
    ctx.font = 'bold 7px sans-serif';
    const titleWords = content.title.split(' ');
    let rLine = '';
    let rY = 50;
    for (const word of titleWords) {
        const test = rLine + word + ' ';
        if (ctx.measureText(test).width > w - 40) {
            ctx.fillText(rLine, 28, rY);
            rLine = word + ' ';
            rY += 11;
        } else {
            rLine = test;
        }
    }
    ctx.fillText(rLine, 28, rY);
    
    // Comment count
    ctx.fillStyle = '#818384';
    ctx.font = '6px sans-serif';
    ctx.fillText(`💬 ${content.comments} comments`, 28, rY + 16);
}

function drawGitHubScreen(ctx, w, h, content, seed) {
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);
    
    // Nav bar
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, w, 18);
    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 8px sans-serif';
    ctx.fillText('GitHub', 6, 13);
    
    // Repo name
    ctx.fillStyle = '#58a6ff';
    ctx.font = 'bold 8px sans-serif';
    ctx.fillText(content.repo, 8, 38);
    
    // Description
    ctx.fillStyle = '#8b949e';
    ctx.font = '6px sans-serif';
    ctx.fillText(content.desc, 8, 54, w - 16);
    
    // Language dot + stars
    ctx.fillStyle = content.color;
    ctx.beginPath();
    ctx.arc(12, 72, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8b949e';
    ctx.font = '6px sans-serif';
    ctx.fillText(content.lang, 20, 75);
    ctx.fillText(`⭐ ${content.stars}`, 20, 90);
    
    // Green contribution squares
    const startX = 8;
    const startY = h - 35;
    for (let col = 0; col < 20; col++) {
        for (let row = 0; row < 3; row++) {
            const intensity = ((seed + col * 7 + row * 3) % 5) / 5;
            ctx.fillStyle = intensity > 0.2 ? `rgba(35, 134, 54, ${intensity})` : '#161b22';
            ctx.fillRect(startX + col * 8, startY + row * 8, 6, 6);
        }
    }
}

function drawHNScreen(ctx, w, h, content, seed) {
    ctx.fillStyle = '#f6f6ef';
    ctx.fillRect(0, 0, w, h);
    
    // Orange header
    ctx.fillStyle = content.color;
    ctx.fillRect(0, 0, w, 16);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 7px sans-serif';
    ctx.fillText('Hacker News', 6, 12);
    
    // Post
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 7px sans-serif';
    const hnWords = content.title.split(' ');
    let hnLine = '';
    let hnY = 34;
    for (const word of hnWords) {
        const test = hnLine + word + ' ';
        if (ctx.measureText(test).width > w - 30) {
            ctx.fillText(hnLine, 22, hnY);
            hnLine = word + ' ';
            hnY += 11;
        } else {
            hnLine = test;
        }
    }
    ctx.fillText(hnLine, 22, hnY);
    
    // Points + upvote
    ctx.fillStyle = '#828282';
    ctx.font = '6px sans-serif';
    ctx.fillText(`▲ ${content.points} points`, 22, hnY + 14);
    ctx.fillText(`${content.comments} comments`, 22, hnY + 26);
    
    // Rank number
    ctx.fillStyle = '#828282';
    ctx.font = 'bold 8px sans-serif';
    ctx.fillText(`${(seed % 30) + 1}.`, 6, 36);
}

function drawCryptoScreen(ctx, w, h, content, seed, time) {
    ctx.fillStyle = '#0b0e11';
    ctx.fillRect(0, 0, w, h);
    
    // Header
    ctx.fillStyle = '#1e2329';
    ctx.fillRect(0, 0, w, 18);
    ctx.fillStyle = '#eaecef';
    ctx.font = 'bold 7px sans-serif';
    ctx.fillText('📊 Market', 6, 13);
    
    // Coin + price
    ctx.fillStyle = content.color;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(content.coin, 8, 46);
    
    ctx.fillStyle = '#eaecef';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(content.price, 8, 66);
    
    const isUp = content.change.startsWith('+');
    ctx.fillStyle = isUp ? '#0ecb81' : '#f6465d';
    ctx.font = 'bold 8px sans-serif';
    ctx.fillText(content.change, 8, 82);
    
    // Fake chart line
    ctx.strokeStyle = isUp ? '#0ecb81' : '#f6465d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const chartY = h - 40;
    const chartH = 30;
    ctx.moveTo(8, chartY + chartH / 2);
    for (let x = 0; x < w - 16; x += 4) {
        const noise = Math.sin((x + seed) * 0.08 + time * 0.5) * chartH * 0.3
                    + Math.sin((x + seed) * 0.15 + time * 0.3) * chartH * 0.15;
        const trend = isUp ? -x * 0.05 : x * 0.05;
        ctx.lineTo(8 + x, chartY + chartH / 2 + noise + trend);
    }
    ctx.stroke();
}
