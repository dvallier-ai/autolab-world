import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FlyControls } from 'three/addons/controls/FlyControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createRoom, createMacDevice } from './modules/room.js';
import { createWorkstation, updateWorkstation, isInsideObstacle, findClearPoint, registerDeskObstacle, clearDeskObstacles, rebuildAgentCharacter } from './modules/workstations.js';
import { getCharacterPresets } from './modules/characters.js';
import { createCharacter, updateCharacter, setCharacterState, createOverseer, updateOverseer } from './modules/characters.js';
import { initRPG, handleRPGUpdate, getAgentLevel, getAgentStats } from './modules/rpg-ui.js';
import { createCartoonAgent, setCartoonState, setCartoonExpression } from './modules/cartoon-characters.js';
import { cartoonifyScene, createCartoonLights, CARTOON_COLORS } from './modules/toon-materials.js';

// ═══════════════════════════════════════════════════════════════
// SCENE SETUP
// ═══════════════════════════════════════════════════════════════
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060610);
scene.fog = new THREE.FogExp2(0x060610, 0.018);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 3.5, 6); // Start closer to ground level, near agents
camera.lookAt(0, 0, 0);

const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ═══════════════════════════════════════════════════════════════
// SELECTIVE BLOOM (post-processing)
// ═══════════════════════════════════════════════════════════════
const BLOOM_LAYER = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);

const bloomComposer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
bloomComposer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.6,   // strength — subtle glow, not blinding
    0.4,   // radius — tight, not blurry
    0.85   // threshold — only bright things bloom
);
bloomComposer.addPass(bloomPass);
bloomComposer.renderToScreen = false;

// Final composite: blend bloom layer on top of normal render
const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(renderPass);

const mixPass = new ShaderPass(
    new THREE.ShaderMaterial({
        uniforms: {
            baseTexture: { value: null },
            bloomTexture: { value: bloomComposer.renderTarget2.texture },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main() { gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }`,
    }),
    'baseTexture'
);
mixPass.needsSwap = true;
finalComposer.addPass(mixPass);
finalComposer.addPass(new OutputPass());

// Dark material used to hide non-bloom objects during bloom pass
const bloomDarkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const storedMaterials = {};

function darkenNonBloomed(obj) {
    if (obj.isMesh && !bloomLayer.test(obj.layers)) {
        storedMaterials[obj.uuid] = obj.material;
        obj.material = bloomDarkMaterial;
    }
    // Hide sprites entirely during bloom pass (prevents blur on text)
    if (obj.isSprite) {
        obj.userData._bloomVisible = obj.visible;
        obj.visible = false;
    }
}

function restoreMaterials(obj) {
    if (storedMaterials[obj.uuid]) {
        obj.material = storedMaterials[obj.uuid];
        delete storedMaterials[obj.uuid];
    }
    if (obj.isSprite && obj.userData._bloomVisible !== undefined) {
        obj.visible = obj.userData._bloomVisible;
        delete obj.userData._bloomVisible;
    }
}

// Helper: mark a mesh for bloom
function enableBloom(mesh) {
    if (mesh) mesh.layers.enable(BLOOM_LAYER);
}
// Expose globally for modules
window._enableBloom = enableBloom;
window._BLOOM_LAYER = BLOOM_LAYER;

// ═══════════════════════════════════════════════════════════════
// CAMERA CONTROLS — Dual mode: Fly (WASD) + Orbit (mouse)
// ═══════════════════════════════════════════════════════════════

// Orbit controls (for mouse rotation, zoom, pan — always active for mouse)
const orbitControls = new OrbitControls(camera, canvas);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.minDistance = 0.3;
orbitControls.maxDistance = 60;
orbitControls.maxPolarAngle = Math.PI * 0.98;
orbitControls.minPolarAngle = 0.01;
orbitControls.rotateSpeed = 0.8;
orbitControls.zoomSpeed = 1.2;
orbitControls.panSpeed = 1.0;
orbitControls.enablePan = true;
orbitControls.screenSpacePanning = true;
orbitControls.enableZoom = false; // We handle zoom ourselves (reverse scroll support)
orbitControls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN,
};
orbitControls.target.set(0, 1, 0);

// Alias for backward compat (many references to `controls`)
const controls = orbitControls;

// ── WASD Keyboard Movement ────────────────────────────────────
const moveKeys = { w: false, a: false, s: false, d: false, space: false, c: false, shift: false,
                    q: false, e: false, x: false,
                    arrowup: false, arrowdown: false, arrowleft: false, arrowright: false };
const MOVE_SPEED = 8;
const FAST_MULTIPLIER = 2.5;

// ── First-Person Mode ─────────────────────────────────────────
let firstPersonMode = false;
const FP_EYE_HEIGHT = 1.7;        // Dan's eye level
const FP_TURN_SPEED = 2.0;        // A/D turn speed (rad/s)
const FP_MOUSE_SENS = 0.002;      // Mouse look sensitivity
const GRAVITY = 20;               // Gravity acceleration
const JUMP_VELOCITY = 8;          // Jump impulse
const GROUND_Y = 0;               // Floor level
let fpYaw = 0;                    // Horizontal rotation
let fpPitch = 0;                  // Vertical look angle
let fpVelocityY = 0;              // Vertical velocity (for jump/gravity)
let fpOnGround = true;            // Is player on ground?
let pointerLocked = false;

function isTypingInInput() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.contentEditable === 'true') return true;
    // Check if inside message panel or terminal
    if (el.closest && (el.closest('#message-panel') || el.closest('#terminal'))) return true;
    return false;
}

document.addEventListener('keydown', (e) => {
    // NEVER capture movement keys when typing in any input
    if (isTypingInInput()) return;
    
    // Don't intercept browser shortcuts (Cmd+R, Cmd+Shift+R, Ctrl+R, etc.)
    if (e.metaKey || e.ctrlKey) return;
    
    const key = e.key.toLowerCase();
    if (key in moveKeys) moveKeys[key] = true;
    if (key === ' ') moveKeys.space = true;
    if (key === 'shift') moveKeys.shift = true;
    
    // V = toggle first-person mode
    if (key === 'v') {
        toggleFirstPerson();
        e.preventDefault();
        return;
    }
    
    // Prevent defaults for movement keys
    if (['w','a','s','d','q','e','c','x'].includes(key) || key === ' ') {
        e.preventDefault();
    }
    if (['arrowup','arrowdown','arrowleft','arrowright'].includes(key)) {
        e.preventDefault();
    }
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key in moveKeys) moveKeys[key] = false;
    if (key === ' ') moveKeys.space = false;
    if (key === 'shift') moveKeys.shift = false;
});

// ── First-Person Toggle ───────────────────────────────────────
function toggleFirstPerson() {
    firstPersonMode = !firstPersonMode;
    
    if (firstPersonMode) {
        // Enter first-person: place camera at Dan's position, hide Dan
        const danPos = danAvatar.position.clone();
        camera.position.set(danPos.x, GROUND_Y + FP_EYE_HEIGHT, danPos.z);
        
        // Calculate initial yaw from current camera direction
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        fpYaw = Math.atan2(-dir.x, -dir.z);
        fpPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
        
        fpVelocityY = 0;
        fpOnGround = true;
        
        // Disable orbit controls
        orbitControls.enabled = false;
        
        // Hide Dan's avatar (you ARE Dan)
        danAvatar.visible = false;
        
        // Request pointer lock for mouse look
        canvas.requestPointerLock();
        
        showModeIndicator('🎮 First Person — WASD move, Mouse look, Space jump, V exit');
    } else {
        // Exit first-person: restore spectator mode
        agentPOVId = null; // clear agent POV
        const camPos = camera.position.clone();
        
        // Re-enable orbit controls
        orbitControls.enabled = true;
        orbitControls.target.set(camPos.x, camPos.y - 1, camPos.z - 3);
        
        // Show Dan's avatar again
        danAvatar.visible = true;
        danAvatar.position.set(camPos.x, GROUND_Y, camPos.z);
        
        // Release pointer lock
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
        
        showModeIndicator('👁️ Spectator Mode — V for first person');
    }
}

// ── Reverse Mouse Wheel Scroll ───────────────────────────────
let reverseScroll = localStorage.getItem('autolab_reverseScroll') === 'true';
canvas.addEventListener('wheel', (e) => {
    if (firstPersonMode) return; // first-person doesn't zoom
    e.preventDefault();
    const dir = reverseScroll ? -1 : 1;
    const amount = e.deltaY * 0.005 * dir;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    camera.position.addScaledVector(forward, amount);
}, { passive: false });

function setReverseScroll(checked) {
    reverseScroll = checked;
    localStorage.setItem('autolab_reverseScroll', checked);
}
window.setReverseScroll = setReverseScroll;

// ── Pointer Lock (Mouse Look) ────────────────────────────────
document.addEventListener('pointerlockchange', () => {
    pointerLocked = !!document.pointerLockElement;
});

// Right-click to re-engage pointer lock in first-person
canvas.addEventListener('mousedown', (e) => {
    if (firstPersonMode && !pointerLocked && e.button === 2) {
        canvas.requestPointerLock();
        e.preventDefault();
    }
});

// Also allow click to lock
canvas.addEventListener('click', () => {
    if (firstPersonMode && !pointerLocked) {
        canvas.requestPointerLock();
    }
});

document.addEventListener('mousemove', (e) => {
    if (!firstPersonMode || !pointerLocked) return;
    
    fpYaw -= e.movementX * FP_MOUSE_SENS;
    const yMult = invertMouseY ? 1 : -1;
    fpPitch += yMult * e.movementY * FP_MOUSE_SENS;
    fpPitch = THREE.MathUtils.clamp(fpPitch, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);
});

// Prevent context menu in first-person
canvas.addEventListener('contextmenu', (e) => {
    if (firstPersonMode) e.preventDefault();
});

// ── Mode Indicator UI ─────────────────────────────────────────
function showModeIndicator(text) {
    let indicator = document.getElementById('mode-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'mode-indicator';
        indicator.style.cssText = `
            position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%);
            background: rgba(8, 8, 24, 0.9); border: 1px solid rgba(74, 158, 255, 0.3);
            color: #4a9eff; padding: 8px 20px; border-radius: 20px;
            font-family: 'JetBrains Mono', monospace; font-size: 12px;
            z-index: 2000; transition: opacity 0.5s; pointer-events: none;
        `;
        document.body.appendChild(indicator);
    }
    indicator.textContent = text;
    indicator.style.opacity = '1';
    clearTimeout(indicator._fadeTimer);
    indicator._fadeTimer = setTimeout(() => { indicator.style.opacity = '0'; }, 3000);
}

// When any input gets focus, kill all movement immediately
document.addEventListener('focusin', (e) => {
    if (isTypingInInput()) {
        for (const k in moveKeys) moveKeys[k] = false;
    }
});

function updateKeyboardMovement(dt) {
    if (isTypingInInput()) return;
    
    const speed = MOVE_SPEED * dt * (moveKeys.shift ? FAST_MULTIPLIER : 1);
    
    if (firstPersonMode) {
        // ── First-Person FPS-shooter movement ──
        
        // Calculate forward and right vectors from yaw (horizontal only)
        const forward = new THREE.Vector3(-Math.sin(fpYaw), 0, -Math.cos(fpYaw));
        const right = new THREE.Vector3(-Math.cos(fpYaw), 0, Math.sin(fpYaw));
        
        const move = new THREE.Vector3(0, 0, 0);
        
        // W/S = walk forward/back
        if (moveKeys.w || moveKeys.arrowup) move.add(forward.clone().multiplyScalar(speed));
        if (moveKeys.s || moveKeys.arrowdown) move.add(forward.clone().multiplyScalar(-speed));
        
        // A/D = strafe left/right (FPS standard)
        if (moveKeys.a || moveKeys.arrowleft) move.add(right.clone().multiplyScalar(-speed));
        if (moveKeys.d || moveKeys.arrowright) move.add(right.clone().multiplyScalar(speed));
        
        // Q/E = also strafe (extra binds)
        if (moveKeys.q) move.add(right.clone().multiplyScalar(-speed));
        if (moveKeys.e) move.add(right.clone().multiplyScalar(speed));
        
        // Jump (Space)
        if (moveKeys.space && fpOnGround) {
            fpVelocityY = JUMP_VELOCITY;
            fpOnGround = false;
        }
        
        // Gravity
        fpVelocityY -= GRAVITY * dt;
        let newY = camera.position.y + fpVelocityY * dt;
        
        // Ground collision
        if (newY <= GROUND_Y + FP_EYE_HEIGHT) {
            newY = GROUND_Y + FP_EYE_HEIGHT;
            fpVelocityY = 0;
            fpOnGround = true;
        }
        
        // Apply horizontal movement with collision check
        let newX = camera.position.x + move.x;
        let newZ = camera.position.z + move.z;
        if (isInsideObstacle(newX, newZ, 0.4)) {
            // Try sliding along axes
            if (!isInsideObstacle(newX, camera.position.z, 0.4)) {
                newZ = camera.position.z; // slide along X
            } else if (!isInsideObstacle(camera.position.x, newZ, 0.4)) {
                newX = camera.position.x; // slide along Z
            } else {
                newX = camera.position.x;
                newZ = camera.position.z; // full block
            }
        }
        camera.position.x = newX;
        camera.position.z = newZ;
        camera.position.y = newY;
        
        // Update camera rotation from yaw + pitch
        const lookDir = new THREE.Vector3(
            -Math.sin(fpYaw) * Math.cos(fpPitch),
            Math.sin(fpPitch),
            -Math.cos(fpYaw) * Math.cos(fpPitch)
        );
        const lookTarget = camera.position.clone().add(lookDir);
        camera.lookAt(lookTarget);
        
        cameraAnimating = false;
    } else {
        // ── Spectator mode (A/D pivot like FPS) ──
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        
        const right = new THREE.Vector3();
        right.crossVectors(forward, camera.up).normalize();
        
        const move = new THREE.Vector3(0, 0, 0);
        
        // A/D = pivot camera left/right (turn in place, MMO-style)
        const SPECTATOR_TURN_SPEED = 1.8;
        if (moveKeys.a || moveKeys.arrowleft) {
            const angle = SPECTATOR_TURN_SPEED * dt;
            // Rotate the orbit target around the camera position
            const offset = orbitControls.target.clone().sub(camera.position);
            offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            orbitControls.target.copy(camera.position).add(offset);
        }
        if (moveKeys.d || moveKeys.arrowright) {
            const angle = -SPECTATOR_TURN_SPEED * dt;
            const offset = orbitControls.target.clone().sub(camera.position);
            offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            orbitControls.target.copy(camera.position).add(offset);
        }
        
        if (moveKeys.w || moveKeys.arrowup) move.add(forward.clone().multiplyScalar(speed));
        if (moveKeys.s || moveKeys.arrowdown) move.add(forward.clone().multiplyScalar(-speed));
        if (moveKeys.q) move.add(right.clone().multiplyScalar(-speed));  // Q strafe left
        if (moveKeys.e) move.add(right.clone().multiplyScalar(speed));   // E strafe right
        if (moveKeys.space) move.y += speed;   // Space = float up
        if (moveKeys.c) move.y -= speed;       // C = descend
        if (moveKeys.x) move.y -= speed;       // X = descend (alt)
        
        if (move.lengthSq() > 0) {
            camera.position.add(move);
            orbitControls.target.add(move);
            cameraAnimating = false;
        }
    }
}

// Cancel camera animation the moment user interacts
orbitControls.addEventListener('start', () => {
    cameraAnimating = false;
});

// ═══════════════════════════════════════════════════════════════
// LIGHTING
// ═══════════════════════════════════════════════════════════════
const ambientLight = new THREE.AmbientLight(0x3a3a6a, 2.0);
scene.add(ambientLight);

const mainLight = new THREE.DirectionalLight(0xffffff, 2.2);
mainLight.position.set(8, 20, 8);
mainLight.castShadow = true;
mainLight.shadow.mapSize.set(2048, 2048);
mainLight.shadow.camera.far = 50;
scene.add(mainLight);

const rimLight = new THREE.DirectionalLight(0x4a9eff, 0.8);
rimLight.position.set(-5, 5, -10);
scene.add(rimLight);

// ═══════════════════════════════════════════════════════════════
// ROOM ENVIRONMENT (replaces old hex grid + ground)
// ═══════════════════════════════════════════════════════════════
const room = createRoom(scene);
window._roomObject = room; // Store for theme system

// Initialize RPG System
initRPG(scene);

// ── Dan's avatar (the overseer, walks around the room) ────────
const danAvatar = createOverseer();
scene.add(danAvatar);

// Add hitbox for Dan's overseer so he's clickable
const danHitbox = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.6, 0.8),
    new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0, depthWrite: false })
);
danHitbox.position.y = 0.8;
danHitbox.userData.agentId = '__dan__';
danAvatar.add(danHitbox);
danAvatar.userData.hitbox = danHitbox;

// ── Speech Bubble System ──────────────────────────────────────
const speechBubbles = []; // { mesh, startTime, duration, owner }

function createSpeechBubble(text, color = '#4a9eff', maxWidth = 40) {
    // Truncate long text for visual display
    const displayText = text.length > 120 ? text.substring(0, 117) + '...' : text;
    
    // Split into lines
    const words = displayText.split(' ');
    const lines = [];
    let currentLine = '';
    words.forEach(word => {
        if ((currentLine + ' ' + word).length > maxWidth) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = currentLine ? currentLine + ' ' + word : word;
        }
    });
    if (currentLine) lines.push(currentLine);
    
    const lineHeight = 18;
    const padding = 12;
    const canvasW = 512;
    const canvasH = Math.max(64, lines.length * lineHeight + padding * 2 + 20);
    
    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    
    // Rounded rect background
    ctx.fillStyle = 'rgba(8, 8, 24, 0.9)';
    ctx.beginPath();
    ctx.roundRect(4, 4, canvasW - 8, canvasH - 20, 12);
    ctx.fill();
    
    // Border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(4, 4, canvasW - 8, canvasH - 20, 12);
    ctx.stroke();
    
    // Speech tail (triangle at bottom)
    ctx.fillStyle = 'rgba(8, 8, 24, 0.9)';
    ctx.beginPath();
    ctx.moveTo(canvasW / 2 - 10, canvasH - 20);
    ctx.lineTo(canvasW / 2, canvasH - 4);
    ctx.lineTo(canvasW / 2 + 10, canvasH - 20);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(canvasW / 2 - 10, canvasH - 20);
    ctx.lineTo(canvasW / 2, canvasH - 4);
    ctx.lineTo(canvasW / 2 + 10, canvasH - 20);
    ctx.stroke();
    
    // Text
    ctx.font = '14px monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    lines.forEach((line, i) => {
        ctx.fillText(line, canvasW / 2, padding + 16 + i * lineHeight);
    });
    
    const texture = new THREE.CanvasTexture(canvas);
    const aspect = canvasW / canvasH;
    const spriteH = 0.5 + lines.length * 0.15;
    const mat = new THREE.SpriteMaterial({ 
        map: texture, transparent: true, opacity: 0,
        depthTest: false, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(spriteH * aspect, spriteH, 1);
    sprite.renderOrder = 999;
    
    return sprite;
}

function showSpeechBubble(owner3D, text, color, duration = 5) {
    // Remove existing bubble for this owner
    for (let i = speechBubbles.length - 1; i >= 0; i--) {
        if (speechBubbles[i].owner === owner3D) {
            scene.remove(speechBubbles[i].mesh);
            speechBubbles.splice(i, 1);
        }
    }
    
    const bubble = createSpeechBubble(text, color);
    bubble.position.copy(owner3D.position);
    bubble.position.y += 2.8;
    scene.add(bubble);
    
    speechBubbles.push({
        mesh: bubble,
        owner: owner3D,
        startTime: performance.now() / 1000,
        duration,
        fadeIn: true,
    });
}

function updateSpeechBubbles(time) {
    const now = performance.now() / 1000;
    for (let i = speechBubbles.length - 1; i >= 0; i--) {
        const b = speechBubbles[i];
        const age = now - b.startTime;
        
        // Follow owner
        b.mesh.position.copy(b.owner.position);
        b.mesh.position.y += 2.8;
        
        // Fade in
        if (age < 0.3) {
            b.mesh.material.opacity = age / 0.3;
        } 
        // Visible
        else if (age < b.duration - 0.5) {
            b.mesh.material.opacity = 1;
        }
        // Fade out
        else if (age < b.duration) {
            b.mesh.material.opacity = 1 - (age - (b.duration - 0.5)) / 0.5;
        }
        // Remove
        else {
            scene.remove(b.mesh);
            speechBubbles.splice(i, 1);
        }
    }
}

// ── Walk Dan to a specific agent ──────────────────────────────
let lastChatTime = 0;
const CHAT_IDLE_TIMEOUT = 15; // seconds before Dan walks away

function walkDanToAgent(agentId) {
    const agentGroup = agentObjects.get(agentId);
    if (!agentGroup) return;
    
    const ud = danAvatar.userData;
    // Set target to slightly in front of agent's desk
    ud.targetPos = {
        x: agentGroup.position.x,
        z: agentGroup.position.z + 1.5, // stand behind the agent's chair
        pause: 999, // will be overridden by idle check
    };
    ud.state = 'walking';
    ud.moveProgress = 0;
    ud.talkingToAgent = agentId;
    lastChatTime = performance.now() / 1000;
}

function checkChatIdle() {
    if (!danAvatar.userData.talkingToAgent) return;
    const now = performance.now() / 1000;
    if (now - lastChatTime > CHAT_IDLE_TIMEOUT) {
        // Resume normal patrol
        danAvatar.userData.talkingToAgent = null;
        danAvatar.userData.pauseTimer = 0; // trigger next waypoint immediately
    }
}

// ═══════════════════════════════════════════════════════════════
// STARFIELD / PARTICLES
// ═══════════════════════════════════════════════════════════════
const starCount = 500;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(starCount * 3);
const starSizes = new Float32Array(starCount);
for (let i = 0; i < starCount; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 50;
    starPos[i * 3 + 1] = Math.random() * 25 + 2;
    starPos[i * 3 + 2] = (Math.random() - 0.5) * 50;
    starSizes[i] = Math.random() * 0.08 + 0.02;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
const starMat = new THREE.PointsMaterial({ 
    color: 0x334466, 
    size: 0.05, 
    transparent: true, 
    opacity: 0.7,
    sizeAttenuation: true 
});
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// ═══════════════════════════════════════════════════════════════
// CHANNEL COLORS
// ═══════════════════════════════════════════════════════════════
const CHANNEL_COLORS = {
    telegram: 0x0088cc,
    discord: 0x5865F2,
    signal: 0x2c6bed,
    whatsapp: 0x25D366,
    imessage: 0x34C759,
    slack: 0x4A154B,
    default: 0x888888
};

function getChannelColor(channel) {
    if (!channel) return CHANNEL_COLORS.default;
    const key = channel.toLowerCase();
    return CHANNEL_COLORS[key] || CHANNEL_COLORS.default;
}

// ═══════════════════════════════════════════════════════════════
// TOOL COLOR MAPPING
// ═══════════════════════════════════════════════════════════════
const TOOL_COLORS = {
    'read': 0x4ade80,
    'write': 0x4ade80,
    'edit': 0x4ade80,
    'web_search': 0x4a9eff,
    'web_fetch': 0x4a9eff,
    'browser': 0x4a9eff,
    'message': 0xff6b4a,
    'tts': 0xff6b4a,
    'exec': 0xffaa4a,
    'process': 0xffaa4a,
    'nodes': 0xb44aff,
    'canvas': 0xff6b9d,
    'default': 0x888888,
};

function getToolColor(toolName) {
    if (!toolName) return TOOL_COLORS.default;
    for (const [key, color] of Object.entries(TOOL_COLORS)) {
        if (toolName.toLowerCase().includes(key.toLowerCase())) {
            return color;
        }
    }
    return TOOL_COLORS.default;
}

// ═══════════════════════════════════════════════════════════════
// DEVICE PLATFORMS (legacy — kept for data tracking, room handles visuals)
// ═══════════════════════════════════════════════════════════════
const devicePlatforms = new Map();

// ═══════════════════════════════════════════════════════════════
// AGENT OBJECTS (now workstation-based)
// ═══════════════════════════════════════════════════════════════
const agentObjects = new Map(); // id → workstation group
const sessionOrbs = new Map();  // sessionKey → mesh
let selectedAgentId = null;
let hoveredAgentId = null;

// Camera animation state
const cameraTarget = { x: 0, y: 1, z: 0 };
const cameraPosition = { x: 0, y: 10, z: 14 };
let cameraAnimating = false;

function hexToInt(hex) {
    return parseInt(hex.replace('#', ''), 16);
}

function createTextSprite(text, color = '#ffffff', size = 0.6) {
    const canvas2d = document.createElement('canvas');
    const ctx = canvas2d.getContext('2d');
    canvas2d.width = 512;
    canvas2d.height = 128;
    
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = 'bold 48px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 64);
    
    ctx.shadowBlur = 0;
    ctx.fillText(text, 256, 64);
    
    const tex = new THREE.CanvasTexture(canvas2d);
    tex.needsUpdate = true;
    
    const mat = new THREE.SpriteMaterial({ 
        map: tex, 
        transparent: true, 
        depthWrite: false,
        opacity: 0.9
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(size * 4, size, 1);
    return sprite;
}

// ── Workstation layout positions ──────────────────────────────
// Arrange desks in a semicircle facing the back wall
function getWorkstationPosition(index, total) {
    if (total === 1) return { x: 0, z: 1.5 };
    
    // For small counts (2-4): single row with generous spacing
    // For 5-8: two rows (front + back)
    // For 9+: three rows
    
    const DESK_WIDTH = 1.8; // actual desk footprint + clearance
    const MIN_SPACING = 3.2; // minimum gap between desk centers
    const ROOM_HALF_WIDTH = 10; // room extends ±10 on x-axis
    const BASE_Z = 0.5; // first row z position
    const ROW_GAP = 3.5; // z gap between rows
    
    const maxPerRow = Math.floor((ROOM_HALF_WIDTH * 2 - 1) / MIN_SPACING);
    const rows = Math.ceil(total / maxPerRow) || 1;
    const perRow = Math.ceil(total / rows);
    
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const countInRow = Math.min(perRow, total - row * perRow);
    
    const spread = Math.min((countInRow - 1) * MIN_SPACING, ROOM_HALF_WIDTH * 2 - 2);
    const startX = -spread / 2;
    const spacing = countInRow > 1 ? spread / (countInRow - 1) : 0;
    
    return {
        x: startX + col * spacing,
        z: BASE_Z + row * ROW_GAP,
    };
}

function updateAgentObjects(agents) {
    const currentIds = new Set(agents.map(a => a.id));
    
    // Remove old agents
    agentObjects.forEach((group, id) => {
        if (!currentIds.has(id)) {
            scene.remove(group);
            agentObjects.delete(id);
        }
    });
    
    // Re-register desk obstacles (in case agent count changed)
    clearDeskObstacles();
    
    // Update or create agents
    agents.forEach((agent, index) => {
        const pos = getWorkstationPosition(index, agents.length);
        
        if (agentObjects.has(agent.id)) {
            // Update existing workstation
            const group = agentObjects.get(agent.id);
            updateWorkstation(group, time, 0.016, agent);
            group.userData.data = agent;
        } else {
            // Create new workstation
            const group = createWorkstation(agent);
            group.position.set(pos.x, 0, pos.z);
            // No rotation — desks face -Z (toward back wall / command center)
            scene.add(group);
            agentObjects.set(agent.id, group);
        }
        
        // Register desk as obstacle for collision avoidance
        registerDeskObstacle(pos.x, pos.z);
    });
}

// ═══════════════════════════════════════════════════════════════
// VISUAL EFFECTS
// ═══════════════════════════════════════════════════════════════
const connectionArcs = [];
const toolBursts = [];
const toolLabels = [];
const messagePulses = [];
const subAgentSatellites = new Map();

function createConnectionArc(from, to) {
    const start = from.position.clone();
    const end = to.position.clone();
    const midHeight = 3;
    const mid = new THREE.Vector3(
        (start.x + end.x) / 2,
        Math.max(start.y, end.y) + midHeight,
        (start.z + end.z) / 2
    );
    
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const points = curve.getPoints(50);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    
    const material = new THREE.LineBasicMaterial({
        color: 0x4a9eff,
        transparent: true,
        opacity: 0.3
    });
    
    const arc = new THREE.Line(geometry, material);
    arc.userData = { curve, age: 0, maxAge: 3 };
    
    // Traveling particle
    const particleGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({ color: 0x4a9eff });
    const particle = new THREE.Mesh(particleGeo, particleMat);
    arc.userData.particle = particle;
    scene.add(particle);
    
    scene.add(arc);
    connectionArcs.push(arc);
}

function createToolBurst(agent, toolName) {
    const group = agentObjects.get(agent.id);
    if (!group) return;
    
    const color = getToolColor(toolName);
    const count = 8;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    
    // Spawn particles at desk surface level (DESK.height ≈ 0.75), not at floor
    const deskY = 0.85;
    
    for (let i = 0; i < count; i++) {
        positions[i * 3] = group.position.x + (Math.random() - 0.5) * 0.8;
        positions[i * 3 + 1] = deskY + Math.random() * 0.2;
        positions[i * 3 + 2] = group.position.z + (Math.random() - 0.5) * 0.4;
        
        velocities.push({
            x: (Math.random() - 0.5) * 0.03,
            y: Math.random() * 0.04 + 0.02,
            z: (Math.random() - 0.5) * 0.03
        });
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color,
        size: 0.08,
        transparent: true,
        opacity: 1
    });
    
    const burst = new THREE.Points(geometry, material);
    burst.userData = { velocities, life: 1.5, maxLife: 1.5 };
    scene.add(burst);
    toolBursts.push(burst);
    
    // Floating tool name label
    const label = createTextSprite(toolName, `#${color.toString(16).padStart(6, '0')}`, 0.4);
    label.position.copy(group.position);
    label.position.y += 2;
    scene.add(label);
    toolLabels.push({
        sprite: label,
        life: 1.5,
        vy: 0.02
    });
}

function createHeartbeatPulse(agentId) {
    const group = agentObjects.get(agentId);
    if (!group) return;
    // Flash the desk lamp warm amber for heartbeat
    if (group.userData.lamp?.userData?.light) {
        const light = group.userData.lamp.userData.light;
        const origColor = light.color.getHex();
        light.color.setHex(0xffaa4a);
        light.intensity = 2;
        setTimeout(() => {
            light.color.setHex(origColor);
            light.intensity = group.userData.data?.active ? 1.2 : 0.3;
        }, 1000);
    }
}

function createMessagePulse(from, to) {
    const fromGroup = agentObjects.get(from);
    const toGroup = agentObjects.get(to);
    if (!fromGroup || !toGroup) return;
    
    const start = fromGroup.position.clone();
    const end = toGroup.position.clone();
    const mid = new THREE.Vector3(
        (start.x + end.x) / 2,
        Math.max(start.y, end.y) + 2,
        (start.z + end.z) / 2
    );
    
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    
    const pulseGeo = new THREE.SphereGeometry(0.15, 16, 16);
    const pulseMat = new THREE.MeshBasicMaterial({
        color: 0xff6b4a,
        transparent: true,
        opacity: 1
    });
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    
    const trailGeo = new THREE.BufferGeometry();
    const trailPos = new Float32Array(10 * 3);
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    const trailMat = new THREE.LineBasicMaterial({
        color: 0xff6b4a,
        transparent: true,
        opacity: 0.5
    });
    const trail = new THREE.Line(trailGeo, trailMat);
    
    pulse.userData = {
        curve,
        progress: 0,
        speed: 0.015,
        trail,
        trailHistory: []
    };
    
    scene.add(pulse);
    scene.add(trail);
    messagePulses.push(pulse);
}

// Server rack work zone — where sub-agent workers go
const WORK_ZONE = { x: 8, z: -6 };

// ── Helpers for sub-agent movement ────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function getDistance(a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return Math.sqrt(dx * dx + dz * dz);
}

function createSubAgentSatellite(sessionKey, parentId) {
    const parentGroup = agentObjects.get(parentId);
    if (!parentGroup) return;
    
    // Get parent agent's color for the mini worker
    const agentColor = parentGroup.userData?.data?.color || '#ffaa4a';
    const parentName = parentGroup.userData?.data?.name || parentId;
    
    // Create a mini character (scaled down)
    const worker = createCharacter(agentColor, 'holo-slim');
    worker.scale.setScalar(0.45);
    
    // Add floating label above the mini worker
    const label = createTextSprite(`⚡ ${parentName}'s worker`, agentColor, 0.35);
    label.position.set(0, 2.2, 0);
    worker.add(label);
    
    // Add a subtle pulsing glow ring at its feet
    const ringGeo = new THREE.RingGeometry(0.3, 0.45, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: agentColor, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    worker.add(ring);
    
    // Start at the parent's desk
    const startX = parentGroup.position.x;
    const startZ = parentGroup.position.z + 0.8; // just in front of the desk
    worker.position.set(startX, 0, startZ);
    
    // Pick a work zone spot with slight randomness
    const destX = WORK_ZONE.x + (Math.random() - 0.5) * 2;
    const destZ = WORK_ZONE.z + (Math.random() - 0.5) * 2;
    
    worker.userData = {
        ...worker.userData,
        parentId,
        sessionKey,
        birthTime: Date.now(),
        completing: false,
        completionTime: 0,
        glowRing: ring,
        // Movement state
        phase: 'walking-to', // 'walking-to', 'working', 'walking-back', 'done'
        startPos: { x: startX, z: startZ },
        destPos: { x: destX, z: destZ },
        moveProgress: 0,
        walkSpeed: 1.8,
    };
    
    setCharacterState(worker, 'typing'); // looks purposeful while walking
    
    scene.add(worker);
    subAgentSatellites.set(sessionKey, worker);
}

function completeSubAgentSatellite(sessionKey) {
    const worker = subAgentSatellites.get(sessionKey);
    if (worker) {
        worker.userData.completing = true;
        worker.userData.completionTime = Date.now();
        worker.userData.phase = 'walking-back';
        worker.userData.moveProgress = 0;
    }
}

// ═══════════════════════════════════════════════════════════════
// UI UPDATES
// ═══════════════════════════════════════════════════════════════
let eventHistory = [];
const activitySparklineCanvas = document.getElementById('activity-sparkline');
const sparklineCtx = activitySparklineCanvas.getContext('2d');

function updateActivitySparkline() {
    const width = activitySparklineCanvas.width;
    const height = activitySparklineCanvas.height;
    
    sparklineCtx.clearRect(0, 0, width, height);
    
    if (eventHistory.length < 2) return;
    
    const maxPoints = 60;
    const points = eventHistory.slice(0, maxPoints).reverse();
    const maxValue = Math.max(...points.map(p => p.count), 1);
    
    sparklineCtx.strokeStyle = '#4a9eff';
    sparklineCtx.lineWidth = 2;
    sparklineCtx.beginPath();
    
    points.forEach((point, i) => {
        const x = (i / (maxPoints - 1)) * width;
        const y = height - (point.count / maxValue) * height;
        if (i === 0) sparklineCtx.moveTo(x, y);
        else sparklineCtx.lineTo(x, y);
    });
    
    sparklineCtx.stroke();
    
    // Fill under curve
    sparklineCtx.lineTo(width, height);
    sparklineCtx.lineTo(0, height);
    sparklineCtx.closePath();
    sparklineCtx.fillStyle = 'rgba(74, 158, 255, 0.1)';
    sparklineCtx.fill();
}

function updateAgentList(agents) {
    const list = document.getElementById('agent-list');
    list.innerHTML = '';
    
    agents.forEach(agent => {
        const div = document.createElement('div');
        div.className = 'agent';
        if (selectedAgentId === agent.id) div.classList.add('selected');
        
        const channelBadges = agent.channels?.map(ch => {
            const color = `#${getChannelColor(ch).toString(16).padStart(6, '0')}`;
            return `<span class="channel-badge" style="background: ${color};" title="${ch}"></span>`;
        }).join('') || '';
        
        div.innerHTML = `
            <div class="agent-name">
                <span class="agent-dot" style="background: ${agent.color}"></span>
                ${agent.emoji} ${agent.name}
                <div class="channel-badges">${channelBadges}</div>
                <span class="agent-badge ${agent.active ? 'active' : 'idle'}">${agent.active ? 'ACTIVE' : 'IDLE'}</span>
            </div>
            <div class="agent-stat">${agent.sessions} sessions · ${(agent.totalTokens || 0).toLocaleString()} tokens</div>
        `;
        
        div.onclick = () => selectAgent(agent.id, true); // true = snap camera from sidebar
        list.appendChild(div);
    });
}

function updatePresenceList(presence) {
    const list = document.getElementById('presence-list');
    if (!presence || presence.length === 0) {
        list.innerHTML = '<div class="presence-item"><span class="presence-icon">—</span><span>No connections</span></div>';
        return;
    }
    
    list.innerHTML = '';
    presence.forEach(p => {
        const div = document.createElement('div');
        div.className = 'presence-item';
        
        // Try multiple field names for client type
        const clientType = p.clientType || p.client?.id || p.type || 'agent';
        
        let icon = '🤖';
        if (clientType.includes('tui')) icon = '🖥️';
        else if (clientType.includes('web') || clientType.includes('chat')) icon = '🌐';
        else if (clientType.includes('mobile')) icon = '📱';
        else if (clientType.includes('viz')) icon = '📊';
        
        const duration = p.connectedAt ? formatDuration(Date.now() - p.connectedAt) : '—';
        
        div.innerHTML = `
            <span class="presence-icon">${icon}</span>
            <span>${clientType} · ${duration}</span>
        `;
        list.appendChild(div);
    });
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
}

function updateEventLog(event) {
    const log = document.getElementById('event-log');
    const entry = document.createElement('div');
    entry.className = 'event-entry';
    
    const time = new Date(event.ts).toLocaleTimeString('en-US', { hour12: false });
    let color = '#4a9eff';
    let name = event.type || event.event;
    let detail = '';
    
    if (event.event === 'chat') {
        color = '#4ade80';
        // Show actual agent thinking/response content if available
        if (event.data?.content) {
            detail = event.data.content.substring(0, 60) + (event.data.content.length > 60 ? '...' : '');
        } else if (event.data?.state) {
            detail = event.data.state;
        }
    } else if (event.event === 'agent') {
        color = '#ff6b4a';
        detail = event.data?.event || '';
    } else if (event.type === 'tool-call' || event.data?.toolCalls) {
        color = '#ffaa4a';
        detail = event.data?.toolCalls?.join(', ') || '';
    }
    
    entry.innerHTML = `
        <span class="event-time">${time}</span>
        <span class="event-name" style="color: ${color}">${name}</span>
        <span class="event-detail">${detail}</span>
    `;
    
    log.insertBefore(entry, log.firstChild);
    
    // Keep last 50
    while (log.children.length > 50) {
        log.removeChild(log.lastChild);
    }
    
    // Track for sparkline
    const now = Date.now();
    const lastBucket = eventHistory[0];
    if (!lastBucket || now - lastBucket.ts > 1000) {
        eventHistory.unshift({ ts: now, count: 1 });
        if (eventHistory.length > 120) eventHistory.pop();
    } else {
        lastBucket.count++;
    }
}

function updateHeader(state) {
    document.getElementById('agent-count').textContent = state.agents?.length || 0;
    document.getElementById('session-count').textContent = state.sessions?.length || 0;
    document.getElementById('total-cost').textContent = (state.stats?.totalCost || 0).toFixed(2);
    document.getElementById('events-today').textContent = state.stats?.eventsToday || 0;
    
    // Update uptime
    if (state.gatewayStartTime) {
        const uptime = Date.now() - state.gatewayStartTime;
        document.getElementById('uptime').textContent = formatDuration(uptime);
    }
    
    // Gateway status
    const status = document.getElementById('gateway-status').firstElementChild;
    if (state.gatewayConnected) {
        status.textContent = '● Connected';
        status.className = 'status-active';
    } else {
        status.textContent = '○ Disconnected';
        status.className = 'status-inactive';
    }
}

function updateClock() {
    const now = new Date();
    document.getElementById('clock').textContent = now.toLocaleTimeString('en-US', { hour12: false });
}

setInterval(updateClock, 1000);
updateClock();

// ═══════════════════════════════════════════════════════════════
// TIMELINE (v2 — agent lanes, time labels, backfill, better markers)
// ═══════════════════════════════════════════════════════════════
const timelineCanvas = document.getElementById('timeline-canvas');
const timelineCtx = timelineCanvas.getContext('2d');
const timelineEvents = []; // {ts, type, agentId, color}
const TIMELINE_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

// Event type colors
const TIMELINE_COLORS = {
    chat: '#4a9eff',
    agent: '#ff6b4a',
    tool: '#4ade80',
    cron: '#ffaa4a',
    heartbeat: '#ffaa4a',
    spawn: '#b44aff',
    health: '#333',
    tick: '#333',
    default: '#666',
};

// Known agent list (populated from state)
let timelineAgentIds = [];

function updateTimelineAgents() {
    const ids = [];
    if (currentState?.agents) {
        for (const a of currentState.agents) {
            if (!ids.includes(a.id)) ids.push(a.id);
        }
    }
    for (const evt of timelineEvents) {
        if (evt.agentId && evt.agentId !== 'unknown' && !ids.includes(evt.agentId)) ids.push(evt.agentId);
    }
    timelineAgentIds = ids;
}

function resizeTimeline() {
    const rect = timelineCanvas.getBoundingClientRect();
    timelineCanvas.width = rect.width;
    timelineCanvas.height = rect.height;
}

window.addEventListener('resize', resizeTimeline);
resizeTimeline();

function addTimelineEvent(type, agentId, color) {
    if (!color) color = TIMELINE_COLORS[type] || TIMELINE_COLORS.default;
    timelineEvents.push({ ts: Date.now(), type, agentId, color });
    
    const cutoff = Date.now() - TIMELINE_WINDOW_MS;
    while (timelineEvents.length > 0 && timelineEvents[0].ts < cutoff) {
        timelineEvents.shift();
    }
}

// Backfill from cached events on page load
async function backfillTimeline() {
    try {
        const resp = await fetch('/api/events');
        const events = await resp.json();
        const cutoff = Date.now() - TIMELINE_WINDOW_MS;
        
        for (const evt of events) {
            const ts = evt.ts || evt.data?.ts;
            if (!ts || ts < cutoff) continue;
            
            const type = evt.type || 'unknown';
            if (type === 'health' || type === 'tick') continue;
            
            let agentId = evt.data?.agentId || 'unknown';
            if (agentId === 'unknown' && evt.data?.sessionKey) {
                const parts = evt.data.sessionKey.split(':');
                if (parts[0] === 'agent' && parts[1]) agentId = parts[1];
            }
            
            const color = TIMELINE_COLORS[type] || TIMELINE_COLORS.default;
            timelineEvents.push({ ts, type, agentId, color });
        }
        
        timelineEvents.sort((a, b) => a.ts - b.ts);
        updateTimelineAgents();
        console.log(`[timeline] Backfilled ${timelineEvents.length} events`);
    } catch (e) {
        console.warn('[timeline] Backfill failed:', e);
    }
}

function drawTimeline() {
    const rect = timelineCanvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const now = Date.now();
    const start = now - TIMELINE_WINDOW_MS;
    
    timelineCtx.save();
    timelineCtx.clearRect(0, 0, width, height);
    
    updateTimelineAgents();
    const agents = timelineAgentIds;
    const laneCount = Math.max(agents.length, 1);
    const headerH = 12;
    const laneH = (height - headerH) / laneCount;
    
    // Background
    timelineCtx.fillStyle = 'rgba(0,0,0,0.3)';
    timelineCtx.fillRect(0, 0, width, height);
    
    // Agent lane backgrounds
    agents.forEach((id, i) => {
        const y = headerH + i * laneH;
        if (i % 2 === 0) {
            timelineCtx.fillStyle = 'rgba(255,255,255,0.02)';
            timelineCtx.fillRect(0, y, width, laneH);
        }
        timelineCtx.fillStyle = '#555';
        timelineCtx.font = '8px monospace';
        timelineCtx.textBaseline = 'middle';
        timelineCtx.fillText(id.slice(0, 6), 2, y + laneH / 2);
    });
    
    // Time grid + labels
    const labelAreaX = 40;
    const plotWidth = width - labelAreaX;
    
    timelineCtx.strokeStyle = 'rgba(255,255,255,0.06)';
    timelineCtx.lineWidth = 1;
    timelineCtx.font = '8px monospace';
    timelineCtx.fillStyle = '#444';
    timelineCtx.textBaseline = 'top';
    
    for (let i = 0; i <= 6; i++) {
        const t = start + (i / 6) * TIMELINE_WINDOW_MS;
        const x = labelAreaX + (i / 6) * plotWidth;
        
        timelineCtx.beginPath();
        timelineCtx.moveTo(x, headerH);
        timelineCtx.lineTo(x, height);
        timelineCtx.stroke();
        
        const d = new Date(t);
        const label = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        timelineCtx.fillText(label, x + 2, 1);
    }
    
    // Plot events
    timelineEvents.forEach(evt => {
        if (evt.ts < start || evt.ts > now) return;
        if (evt.type === 'health' || evt.type === 'tick') return;
        
        const xFrac = (evt.ts - start) / TIMELINE_WINDOW_MS;
        const x = labelAreaX + xFrac * plotWidth;
        
        const laneIdx = agents.indexOf(evt.agentId);
        const y = laneIdx >= 0 
            ? headerH + laneIdx * laneH + laneH / 2
            : headerH + height / 2;
        
        timelineCtx.fillStyle = evt.color;
        timelineCtx.globalAlpha = 0.85;
        
        switch (evt.type) {
            case 'chat':
                timelineCtx.beginPath();
                timelineCtx.arc(x, y, 4, 0, Math.PI * 2);
                timelineCtx.fill();
                break;
            case 'tool':
                timelineCtx.fillRect(x - 2.5, y - 2.5, 5, 5);
                break;
            case 'spawn':
                timelineCtx.beginPath();
                timelineCtx.moveTo(x, y - 4);
                timelineCtx.lineTo(x + 4, y);
                timelineCtx.lineTo(x, y + 4);
                timelineCtx.lineTo(x - 4, y);
                timelineCtx.closePath();
                timelineCtx.fill();
                break;
            case 'cron':
            case 'heartbeat':
                timelineCtx.beginPath();
                timelineCtx.moveTo(x, y - 4);
                timelineCtx.lineTo(x + 3.5, y + 3);
                timelineCtx.lineTo(x - 3.5, y + 3);
                timelineCtx.closePath();
                timelineCtx.fill();
                break;
            default:
                timelineCtx.beginPath();
                timelineCtx.arc(x, y, 3, 0, Math.PI * 2);
                timelineCtx.fill();
        }
        timelineCtx.globalAlpha = 1.0;
    });
    
    // Pulsing now line
    const pulse = 0.5 + 0.5 * Math.sin(now / 500);
    timelineCtx.strokeStyle = `rgba(74, 158, 255, ${0.4 + pulse * 0.6})`;
    timelineCtx.lineWidth = 2;
    timelineCtx.beginPath();
    timelineCtx.moveTo(width - 1, headerH);
    timelineCtx.lineTo(width - 1, height);
    timelineCtx.stroke();
    
    // Lane separators
    timelineCtx.strokeStyle = 'rgba(255,255,255,0.05)';
    timelineCtx.lineWidth = 1;
    agents.forEach((_, i) => {
        if (i > 0) {
            const y = headerH + i * laneH;
            timelineCtx.beginPath();
            timelineCtx.moveTo(0, y);
            timelineCtx.lineTo(width, y);
            timelineCtx.stroke();
        }
    });
    
    timelineCtx.restore();
}

// Timeline hover tooltip
const timelineTooltip = document.getElementById('timeline-tooltip');
timelineCanvas.addEventListener('mousemove', (e) => {
    const rect = timelineCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const labelAreaX = 40;
    const plotWidth = width - labelAreaX;
    const now = Date.now();
    const start = now - TIMELINE_WINDOW_MS;
    
    const hoveredTime = start + ((x - labelAreaX) / plotWidth) * TIMELINE_WINDOW_MS;
    const tolerance = 20000;
    
    const nearbyEvents = timelineEvents.filter(evt => 
        Math.abs(evt.ts - hoveredTime) < tolerance && evt.type !== 'health' && evt.type !== 'tick'
    );
    
    if (nearbyEvents.length > 0 && x > labelAreaX) {
        const date = new Date(nearbyEvents[0].ts);
        const timeStr = date.toLocaleTimeString('en-US', { hour12: false });
        const types = [...new Set(nearbyEvents.map(e => e.type))].join(', ');
        const agentNames = [...new Set(nearbyEvents.map(e => e.agentId))].join(', ');
        timelineTooltip.textContent = `${timeStr} · ${nearbyEvents.length} event(s) · ${types} · ${agentNames}`;
        timelineTooltip.style.left = `${e.clientX}px`;
        timelineTooltip.classList.add('visible');
    } else {
        timelineTooltip.classList.remove('visible');
    }
});

timelineCanvas.addEventListener('mouseleave', () => {
    timelineTooltip.classList.remove('visible');
});

timelineCanvas.addEventListener('click', (e) => {
    const rect = timelineCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const labelAreaX = 40;
    const plotWidth = width - labelAreaX;
    const now = Date.now();
    const start = now - TIMELINE_WINDOW_MS;
    
    const clickedTime = start + ((x - labelAreaX) / plotWidth) * TIMELINE_WINDOW_MS;
    const tolerance = 20000;
    
    const nearbyEvents = timelineEvents.filter(evt => 
        Math.abs(evt.ts - clickedTime) < tolerance
    );
    
    if (nearbyEvents.length > 0 && nearbyEvents[0].agentId) {
        selectAgent(nearbyEvents[0].agentId, true);
        const group = agentObjects.get(nearbyEvents[0].agentId);
        if (group && group.userData.lamp?.userData?.light) {
            group.userData.lamp.userData.light.intensity = 3;
            setTimeout(() => {
                group.userData.lamp.userData.light.intensity = group.userData.data?.active ? 1.2 : 0.3;
            }, 500);
        }
    }
});

// Kick off backfill
backfillTimeline();

// ═══════════════════════════════════════════════════════════════
// LIVE SCREEN DATA (feeds TVs in room)
// ═══════════════════════════════════════════════════════════════
const _appStartTime = Date.now();

function buildLiveScreenData() {
    const agents = currentState?.agents || [];
    const now = Date.now();
    
    // Events per hour
    const oneHourAgo = now - 60 * 60 * 1000;
    const recentEventsCount = timelineEvents.filter(e => e.ts > oneHourAgo && e.type !== 'health' && e.type !== 'tick').length;
    
    // Sparkline: divide last hour into 20 buckets
    const buckets = 20;
    const bucketMs = 60 * 60 * 1000 / buckets;
    const sparkline = new Array(buckets).fill(0);
    timelineEvents.forEach(e => {
        if (e.ts > oneHourAgo && e.type !== 'health' && e.type !== 'tick') {
            const bucket = Math.floor((e.ts - oneHourAgo) / bucketMs);
            if (bucket >= 0 && bucket < buckets) sparkline[bucket]++;
        }
    });
    
    // Uptime
    const uptimeSec = (now - _appStartTime) / 1000;
    const uptimeH = Math.floor(uptimeSec / 3600);
    const uptimeM = Math.floor((uptimeSec % 3600) / 60);
    const uptime = uptimeH > 0 ? `${uptimeH}h ${uptimeM}m` : `${uptimeM}m`;
    
    // Recent events for feed (last 20, newest first)
    const recentEvents = [...timelineEvents]
        .filter(e => e.type !== 'health' && e.type !== 'tick')
        .slice(-20);
    
    // Devices from hardware config (cached)
    const devices = (window._hardwareDevices || []).map(d => ({
        name: d.name || d.id,
        online: true, // assume online if we have data
    }));
    
    // Fake but plausible system resources (we don't have real OS stats)
    // Use a slowly varying function so they look alive
    const t = now / 1000;
    const resources = [
        { name: 'CPU', value: 15 + Math.sin(t * 0.07) * 10 + Math.sin(t * 0.23) * 5 + (agents.some(a => a.active) ? 20 : 0), color: '#4ade80' },
        { name: 'MEM', value: 45 + Math.sin(t * 0.03) * 8, color: '#4a9eff' },
        { name: 'DISK', value: 62 + Math.sin(t * 0.001) * 2, color: '#ffaa4a' },
        { name: 'NET', value: 5 + Math.sin(t * 0.1) * 5 + (agents.some(a => a.active) ? 15 : 0) + Math.random() * 3, color: '#b44aff' },
    ];
    
    return {
        agents: agents.map(a => ({
            id: a.id,
            name: a.name,
            emoji: a.emoji,
            color: a.color,
            active: a.active,
            idleSec: a.idleSec || 0,
        })),
        eventsPerHour: recentEventsCount,
        gateways: 2, // MacA + MacB
        uptime,
        sparkline,
        recentEvents,
        resources,
        devices,
        kanban: kanbanData, // Pass real kanban data to room
    };
}

// Fetch hardware devices for system screen
(async () => {
    try {
        const resp = await fetch('/api/hardware');
        const data = await resp.json();
        window._hardwareDevices = data.devices || [];
    } catch (e) { window._hardwareDevices = []; }
})();

// Load saved agent appearances
(async () => {
    try {
        const resp = await fetch('/api/appearances');
        window._agentAppearances = await resp.json();
    } catch (e) { window._agentAppearances = {}; }
})();

// Load initial Kanban data for wall texture
(async () => {
    try {
        const resp = await fetch('/api/kanban');
        kanbanData = await resp.json();
    } catch (e) { console.warn('[kanban] Initial load failed', e); }
})();

// ═══════════════════════════════════════════════════════════════
// AGENT DETAIL PANEL
// ═══════════════════════════════════════════════════════════════
function selectAgent(id, snapCamera = false) {
    selectedAgentId = id;
    
    if (!id) {
        document.getElementById('detail-panel').classList.remove('visible');
        updateAgentList(currentState?.agents || []);
        return;
    }
    
    const agent = currentState?.agents?.find(a => a.id === id);
    if (!agent) return;
    
    // Only snap camera when clicking from the sidebar list
    if (snapCamera) {
        const group = agentObjects.get(id);
        if (group) {
            const targetPos = group.position.clone();
            cameraTarget.x = targetPos.x;
            cameraTarget.y = targetPos.y + 1;
            cameraTarget.z = targetPos.z;
            
            cameraPosition.x = targetPos.x + 3;
            cameraPosition.y = targetPos.y + 4;
            cameraPosition.z = targetPos.z + 5;
            
            cameraAnimating = true;
        }
    }
    
    const panel = document.getElementById('detail-panel');
    const sessions = currentState?.sessions?.filter(s => s.agentId === id) || [];
    
    const channelTags = agent.channels?.map(ch => {
        const color = `#${getChannelColor(ch).toString(16).padStart(6, '0')}`;
        return `<span class="channel-tag" style="background: ${color}33; color: ${color}">${ch}</span>`;
    }).join('') || '<span style="color: #555">No channels</span>';
    
    panel.innerHTML = `
        <button class="close-detail" onclick="selectAgent(null)">✕</button>
        <h2>${agent.emoji} ${agent.name}</h2>
        <div class="detail-header">
            <div style="color: #888; font-size: 11px;">${agent.model}</div>
            <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;">
                <button onclick="openMessagePanel('${id}')" style="padding: 6px 12px; background: #4a9eff; border: none; border-radius: 4px; color: #fff; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                    💬 Chat
                </button>
                <button onclick="enterAgentPOV('${id}')" style="padding: 6px 12px; background: #ff6b2b33; border: 1px solid #ff6b2b66; border-radius: 4px; color: #ff6b2b; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                    👁️ POV
                </button>
                <button onclick="openLiveFeed('${id}')" style="padding: 6px 12px; background: #4ade8033; border: 1px solid #4ade8066; border-radius: 4px; color: #4ade80; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                    📺 Live Feed
                </button>
                <button onclick="openCustomizePanel('${id}')" style="padding: 6px 12px; background: #b44aff33; border: 1px solid #b44aff66; border-radius: 4px; color: #b44aff; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                    🎨 Customize
                </button>
            </div>
        </div>
        
        <h3>Stats</h3>
        <div class="stats-grid">
            <div class="stat-box">
                <div class="stat-label">Tokens</div>
                <div class="stat-value">${(agent.totalTokens || 0).toLocaleString()}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Cost</div>
                <div class="stat-value">$${(agent.cost || 0).toFixed(2)}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Burn Rate</div>
                <div class="stat-value">${agent.burnRate || 0}/min</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Status</div>
                <div class="stat-value" style="font-size: 12px; color: ${agent.active ? '#4ade80' : '#888'}">${agent.active ? 'ACTIVE' : 'IDLE'}</div>
            </div>
        </div>
        
        <h3>Channels</h3>
        <div class="channel-list">${channelTags}</div>
        
        <h3 style="display: flex; align-items: center; gap: 8px;">
            Core Files
            <span onclick="toggleAgentUnlock('${id}')" id="agent-lock-icon" style="cursor: pointer; font-size: 14px;" title="Click to unlock editing">🔒</span>
            <span id="agent-add-file-btn" onclick="createAgentFile('${id}')" style="cursor: pointer; font-size: 12px; display: none;" title="Create new file">➕</span>
        </h3>
        <div id="agent-core-files" style="font-size: 11px; color: #666;">Loading files...</div>
        
        <h3>Sessions (${sessions.length})</h3>
        <div>
            ${sessions.slice(0, 10).map(s => `
                <div class="session-entry">
                    <span class="session-dot ${s.active ? 'active' : ''}"></span>
                    <span class="session-label">${s.label || s.key}</span>
                    <span class="session-channel">${s.channel || '—'}</span>
                </div>
            `).join('')}
            ${sessions.length > 10 ? `<div style="color: #555; font-size: 10px; margin-top: 4px;">... and ${sessions.length - 10} more</div>` : ''}
        </div>
    `;
    
    panel.classList.add('visible');
    updateAgentList(currentState?.agents || []);
    
    // Load core files
    loadAgentCoreFiles(id);
}

// Make selectAgent global for onclick
window.selectAgent = selectAgent;

// ═══════════════════════════════════════════════════════════════
// AGENT CORE FILES + UNLOCK SYSTEM
// ═══════════════════════════════════════════════════════════════
let agentUnlocked = {}; // { agentId: true } — tracks which agents are unlocked for editing

function toggleAgentUnlock(agentId) {
    // If locking (currently unlocked), just lock
    if (agentUnlocked[agentId]) {
        agentUnlocked[agentId] = false;
        updateLockUI(agentId);
        loadAgentCoreFiles(agentId);
        return;
    }
    
    // If require password is on, prompt
    if (requirePasswordForEdits) {
        const pw = prompt('Enter password to unlock agent editing:');
        // For now, placeholder — accept anything non-empty
        if (!pw) return;
    }
    
    agentUnlocked[agentId] = true;
    updateLockUI(agentId);
    loadAgentCoreFiles(agentId);
}

function updateLockUI(agentId) {
    const icon = document.getElementById('agent-lock-icon');
    if (icon) {
        icon.textContent = agentUnlocked[agentId] ? '🔓' : '🔒';
        icon.title = agentUnlocked[agentId] ? 'Editing unlocked — click to lock' : 'Click to unlock editing';
    }
    const addBtn = document.getElementById('agent-add-file-btn');
    if (addBtn) addBtn.style.display = agentUnlocked[agentId] ? 'inline' : 'none';
}

async function loadAgentCoreFiles(agentId) {
    const container = document.getElementById('agent-core-files');
    if (!container) return;
    
    try {
        const resp = await fetch(`/api/agent/${agentId}/files`);
        const data = await resp.json();
        
        if (!data.files?.length) {
            container.innerHTML = '<div style="color: #555;">No core files found</div>';
            return;
        }
        
        const unlocked = agentUnlocked[agentId];
        container.innerHTML = data.files.map(f => `
            <div style="display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
                <span style="color: #888;">📄</span>
                <span onclick="viewAgentFile('${agentId}', '${f.name}')" style="color: #aaa; cursor: pointer; flex: 1; font-size: 11px;" title="${f.preview.replace(/"/g, '&quot;').slice(0, 80)}...">${f.name}</span>
                <span style="color: #444; font-size: 9px;">${(f.size / 1024).toFixed(1)}KB</span>
                ${unlocked ? `<span onclick="editAgentFile('${agentId}', '${f.name}')" style="cursor: pointer; font-size: 10px;" title="Edit">✏️</span>` : ''}
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<div style="color: #ff4a4a;">Failed to load files</div>';
    }
}

async function viewAgentFile(agentId, filename) {
    try {
        const resp = await fetch(`/api/agent/${agentId}/file/${filename}`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        
        showFileViewer(agentId, filename, data.content, false);
    } catch (e) {
        console.error('Failed to load file:', e);
    }
}

async function editAgentFile(agentId, filename) {
    if (!agentUnlocked[agentId]) return;
    
    try {
        const resp = await fetch(`/api/agent/${agentId}/file/${filename}`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        
        showFileViewer(agentId, filename, data.content, true);
    } catch (e) {
        console.error('Failed to load file for editing:', e);
    }
}

function showFileViewer(agentId, filename, content, editable) {
    let overlay = document.getElementById('fileviewer-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'fileviewer-overlay';
        document.body.appendChild(overlay);
    }
    
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.75); z-index: 2100;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(4px);
    `;
    
    const agent = currentState?.agents?.find(a => a.id === agentId);
    const color = agent?.color || '#4a9eff';
    
    overlay.innerHTML = `
        <div style="
            background: #0e0e18; border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px; padding: 0; width: 90%; max-width: 700px;
            max-height: 85vh; display: flex; flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        ">
            <div style="padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0; color: ${color}; font-size: 14px;">${agent?.emoji || '📄'} ${agentId} / ${filename}</h3>
                    <div style="color: #555; font-size: 10px; margin-top: 2px;">${editable ? '✏️ Editing — changes saved to disk' : '👁️ Read-only — unlock to edit'}</div>
                </div>
                <button onclick="closeFileViewer()" style="background: none; border: none; color: #666; font-size: 18px; cursor: pointer;">✕</button>
            </div>
            <div style="flex: 1; overflow: auto; padding: 0;">
                <textarea id="file-editor-content" 
                    ${editable ? '' : 'readonly'}
                    style="
                        width: 100%; height: 100%; min-height: 400px;
                        background: ${editable ? '#0a0a14' : '#080810'}; 
                        color: ${editable ? '#ddd' : '#999'}; 
                        border: none; padding: 16px 20px;
                        font-family: 'JetBrains Mono', monospace; font-size: 12px;
                        line-height: 1.6; resize: none; outline: none;
                        ${editable ? 'border-left: 2px solid ' + color + '44;' : ''}
                    ">${escapeHtml(content)}</textarea>
            </div>
            ${editable ? `
                <div style="padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: flex-end; gap: 8px;">
                    <button onclick="closeFileViewer()" style="padding: 6px 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: #888; font-size: 11px; cursor: pointer; font-family: 'JetBrains Mono', monospace;">Cancel</button>
                    <button onclick="saveAgentFile('${agentId}', '${filename}')" id="file-save-btn" style="padding: 6px 16px; background: ${color}33; border: 1px solid ${color}66; border-radius: 4px; color: ${color}; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'JetBrains Mono', monospace;">💾 Save</button>
                </div>
            ` : ''}
        </div>
    `;
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeFileViewer();
    });
    
    // Prevent ESC/keyboard controls while editing
    if (editable) {
        const textarea = document.getElementById('file-editor-content');
        textarea?.focus();
    }
}

function closeFileViewer() {
    const overlay = document.getElementById('fileviewer-overlay');
    if (overlay) overlay.remove();
}

async function saveAgentFile(agentId, filename) {
    const textarea = document.getElementById('file-editor-content');
    const saveBtn = document.getElementById('file-save-btn');
    if (!textarea) return;
    
    const content = textarea.value;
    if (saveBtn) saveBtn.textContent = 'Saving...';
    
    try {
        const resp = await fetch(`/api/agent/${agentId}/file/${filename}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        
        if (saveBtn) {
            saveBtn.textContent = '✓ Saved!';
            saveBtn.style.borderColor = '#4ade80';
            saveBtn.style.color = '#4ade80';
        }
        setTimeout(() => {
            if (saveBtn) saveBtn.textContent = '💾 Save';
        }, 2000);
    } catch (e) {
        if (saveBtn) {
            saveBtn.textContent = '✗ Failed';
            saveBtn.style.color = '#ff4a4a';
        }
    }
}

async function createAgentFile(agentId) {
    if (!agentUnlocked[agentId]) return;
    
    const filename = prompt('New file name (must end in .md):', 'NEW-FILE.md');
    if (!filename) return;
    if (!filename.endsWith('.md')) {
        alert('File must end in .md');
        return;
    }
    
    // Create the file on the server with empty content
    try {
        const resp = await fetch(`/api/agent/${agentId}/file/${filename}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `# ${filename.replace('.md', '')}\n\n` }),
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        
        // Refresh file list and open the new file in edit mode
        await loadAgentCoreFiles(agentId);
        editAgentFile(agentId, filename);
    } catch (e) {
        alert('Failed to create file: ' + e.message);
    }
}

window.toggleAgentUnlock = toggleAgentUnlock;
window.loadAgentCoreFiles = loadAgentCoreFiles;
window.viewAgentFile = viewAgentFile;
window.editAgentFile = editAgentFile;
window.showFileViewer = showFileViewer;
window.closeFileViewer = closeFileViewer;
window.saveAgentFile = saveAgentFile;
window.createAgentFile = createAgentFile;

// ── Agent POV Mode ────────────────────────────────────────────
let agentPOVId = null; // which agent we're riding

function enterAgentPOV(agentId) {
    const group = agentObjects.get(agentId);
    if (!group) return;
    
    agentPOVId = agentId;
    firstPersonMode = true;
    
    // Position camera at agent's head
    const pos = group.position;
    camera.position.set(pos.x, pos.y + FP_EYE_HEIGHT * 0.7, pos.z); // agents are 0.7 scale
    
    // Face the agent's current direction
    const rot = group.rotation.y;
    fpYaw = rot + Math.PI; // agents face their desk which is -z relative
    fpPitch = 0;
    fpVelocityY = 0;
    fpOnGround = true;
    
    orbitControls.enabled = false;
    danAvatar.visible = false;
    
    // Close detail panel
    document.getElementById('detail-panel').classList.remove('visible');
    
    canvas.requestPointerLock();
    
    const agent = currentState?.agents?.find(a => a.id === agentId);
    const name = agent?.name || agentId;
    showModeIndicator(`👁️ ${name}'s POV — WASD move, Mouse look, V exit`);
}

// Patch the FP update loop to follow agent when in POV mode
const _origToggleFirstPerson = toggleFirstPerson;

window.enterAgentPOV = enterAgentPOV;

// ═══════════════════════════════════════════════════════════════
// CHARACTER CUSTOMIZATION PANEL
// ═══════════════════════════════════════════════════════════════
function openCustomizePanel(agentId) {
    const agent = currentState?.agents?.find(a => a.id === agentId);
    if (!agent) return;
    
    const presets = getCharacterPresets();
    const currentPreset = (window._agentAppearances || {})[agentId]?.preset || 'holo-standard';
    
    // Build preset grid
    const presetCards = Object.entries(presets).map(([key, p]) => {
        const isSelected = key === currentPreset;
        return `
            <div class="preset-card ${isSelected ? 'selected' : ''}" 
                 data-preset="${key}" 
                 onclick="selectPreset('${agentId}', '${key}')"
                 style="
                    background: ${isSelected ? agent.color + '22' : 'rgba(255,255,255,0.03)'};
                    border: 2px solid ${isSelected ? agent.color : 'rgba(255,255,255,0.08)'};
                    border-radius: 8px;
                    padding: 12px 8px;
                    cursor: pointer;
                    text-align: center;
                    transition: all 0.2s;
                 ">
                <div style="font-size: 28px; margin-bottom: 6px;">${p.icon}</div>
                <div style="font-size: 11px; font-weight: 600; color: ${isSelected ? agent.color : '#aaa'};">${p.name}</div>
                <div style="font-size: 9px; color: #555; margin-top: 2px;">${p.style}</div>
            </div>
        `;
    }).join('');
    
    // Create/reuse modal overlay
    let overlay = document.getElementById('customize-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'customize-overlay';
        document.body.appendChild(overlay);
    }
    
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7); z-index: 2000;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(4px);
    `;
    
    overlay.innerHTML = `
        <div style="
            background: #12121a; border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px; padding: 24px; max-width: 500px; width: 90%;
            max-height: 80vh; overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        ">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h2 style="margin: 0; font-size: 18px; color: ${agent.color};">${agent.emoji} ${agent.name} — Character</h2>
                <button onclick="closeCustomizePanel()" style="
                    background: none; border: none; color: #666; font-size: 20px; cursor: pointer;
                ">✕</button>
            </div>
            <p style="color: #666; font-size: 12px; margin: 0 0 16px 0;">Choose an avatar type for this agent in the 3D space.</p>
            <div id="preset-grid" style="
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 8px;
            ">${presetCards}</div>
            <div id="customize-status" style="
                margin-top: 12px; font-size: 11px; color: #555; text-align: center; min-height: 16px;
            "></div>
        </div>
    `;
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeCustomizePanel();
    });
}

function closeCustomizePanel() {
    const overlay = document.getElementById('customize-overlay');
    if (overlay) overlay.remove();
}

async function selectPreset(agentId, presetKey) {
    const statusEl = document.getElementById('customize-status');
    if (statusEl) statusEl.textContent = 'Applying...';
    
    try {
        const resp = await fetch(`/api/appearances/${agentId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preset: presetKey }),
        });
        
        if (!resp.ok) throw new Error('Save failed');
        
        // Update local cache
        if (!window._agentAppearances) window._agentAppearances = {};
        window._agentAppearances[agentId] = { preset: presetKey };
        
        // Rebuild the character in 3D
        applyAppearanceChange(agentId, presetKey);
        
        // Update selected state in UI
        document.querySelectorAll('#preset-grid .preset-card').forEach(card => {
            const isSelected = card.dataset.preset === presetKey;
            const agent = currentState?.agents?.find(a => a.id === agentId);
            const color = agent?.color || '#4a9eff';
            card.classList.toggle('selected', isSelected);
            card.style.background = isSelected ? color + '22' : 'rgba(255,255,255,0.03)';
            card.style.borderColor = isSelected ? color : 'rgba(255,255,255,0.08)';
            card.querySelector('div:nth-child(2)').style.color = isSelected ? color : '#aaa';
        });
        
        if (statusEl) statusEl.textContent = '✓ Applied!';
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 1500);
    } catch (e) {
        if (statusEl) statusEl.textContent = '✗ Failed to save';
    }
}

function applyAppearanceChange(agentId, presetKey) {
    const group = agentObjects.get(agentId);
    if (group) {
        rebuildAgentCharacter(group, presetKey);
    }
}

window.openCustomizePanel = openCustomizePanel;
window.closeCustomizePanel = closeCustomizePanel;
window.selectPreset = selectPreset;

window.selectPreset = selectPreset;

// ═══════════════════════════════════════════════════════════════
// WATER COOLER CHAT SYSTEM
// ═══════════════════════════════════════════════════════════════
const waterCoolerPos = { x: 7.5, z: 7 }; // matches room.js water cooler
let waterCoolerBubbles = []; // active speech bubbles
let waterCoolerAgents = []; // agent IDs currently chatting
let waterCoolerMessageQueue = [];

function handleWaterCoolerStart(msg) {
    console.log('[watercooler] Chat starting:', msg.agents, 'topic:', msg.topic);
    waterCoolerAgents = msg.agents || [];
    waterCoolerBubbles = [];
    waterCoolerMessageQueue = [];
    
    // Walk both agents to the water cooler area (side by side)
    waterCoolerAgents.forEach((agentId, i) => {
        const group = agentObjects.get(agentId);
        if (!group) return;
        const ud = group.userData;
        
        // Override their idle state — force walk to water cooler
        const offsetX = i === 0 ? -0.6 : 0.6;
        const targetWorld = {
            x: waterCoolerPos.x + offsetX,
            z: waterCoolerPos.z + 0.8
        };
        
        // Convert to local space (group is positioned at desk)
        ud.wanderState = 'walking-to';
        ud.wanderTarget = new THREE.Vector3(
            targetWorld.x - group.position.x,
            0.14,
            targetWorld.z - group.position.z
        );
        ud.wanderOrigin = ud.character.position.clone();
        ud.wanderProgress = 0;
        ud.wanderSpeed = 0.35;
        ud._waterCoolerMode = true;
    });
    
    // Show topic indicator
    showWaterCoolerNotification(`💬 ${msg.agents.map(id => {
        const a = currentState?.agents?.find(a => a.id === id);
        return a?.name || id;
    }).join(' & ')} at the water cooler`);
}

function handleWaterCoolerMessage(msg) {
    console.log(`[watercooler] ${msg.name}: ${msg.text}`);
    
    // Sound
    if (window._playWaterCoolerBubble) window._playWaterCoolerBubble();
    
    // Queue message (will be shown as speech bubble)
    waterCoolerMessageQueue.push({
        agentId: msg.agent,
        name: msg.name,
        text: msg.text,
        time: Date.now(),
    });
    
    // Show speech bubble above the agent
    const group = agentObjects.get(msg.agent);
    if (group) {
        showWaterCoolerBubble(group, msg.name, msg.text);
    }
    
    // Also add to timeline/events if visible
    addWaterCoolerToChat(msg);
}

function handleWaterCoolerEnd(msg) {
    console.log('[watercooler] Chat ended');
    
    // Walk agents back to their desks
    (msg.agents || waterCoolerAgents).forEach(agentId => {
        const group = agentObjects.get(agentId);
        if (!group) return;
        const ud = group.userData;
        
        ud._waterCoolerMode = false;
        ud.wanderState = 'returning';
        ud.wanderTarget = new THREE.Vector3(ud.seatPos.x, ud.seatPos.y, ud.seatPos.z);
        ud.wanderOrigin = ud.character.position.clone();
        ud.wanderProgress = 0;
        ud.wanderSpeed = 0.6;
    });
    
    waterCoolerAgents = [];
    
    // Clear bubbles after a delay
    setTimeout(() => {
        waterCoolerBubbles.forEach(b => {
            if (b.sprite && b.sprite.parent) b.sprite.parent.remove(b.sprite);
        });
        waterCoolerBubbles = [];
    }, 5000);
}

function showWaterCoolerBubble(group, name, text) {
    // Create a text sprite bubble above the agent
    const canvas2d = document.createElement('canvas');
    const ctx = canvas2d.getContext('2d');
    canvas2d.width = 512;
    canvas2d.height = 128;
    
    // Background
    ctx.fillStyle = 'rgba(10, 10, 20, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, 504, 120, 12);
    ctx.fill();
    ctx.stroke();
    
    // Name
    const agent = currentState?.agents?.find(a => a.name === name);
    ctx.fillStyle = agent?.color || '#4a9eff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(name + ':', 16, 36);
    
    // Text (word wrap)
    ctx.fillStyle = '#e0e0e0';
    ctx.font = '18px sans-serif';
    const words = (text || '').split(' ');
    let line = '';
    let y = 64;
    const maxWidth = 480;
    for (const word of words) {
        const test = line + word + ' ';
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line.trim(), 16, y);
            line = word + ' ';
            y += 24;
            if (y > 110) { ctx.fillText('...', 16, y); break; }
        } else {
            line = test;
        }
    }
    if (y <= 110) ctx.fillText(line.trim(), 16, y);
    
    const texture = new THREE.CanvasTexture(canvas2d);
    const spriteMat = new THREE.SpriteMaterial({ 
        map: texture, 
        transparent: true,
        depthTest: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.5, 0.65, 1);
    
    // Position above agent in world space
    const worldPos = new THREE.Vector3();
    group.userData.character.getWorldPosition(worldPos);
    sprite.position.set(worldPos.x, worldPos.y + 1.6, worldPos.z);
    
    scene.add(sprite);
    
    // Remove old bubble from same agent
    waterCoolerBubbles = waterCoolerBubbles.filter(b => {
        if (b.agentId === (agent?.id || name)) {
            if (b.sprite.parent) b.sprite.parent.remove(b.sprite);
            b.sprite.material.map.dispose();
            b.sprite.material.dispose();
            return false;
        }
        return true;
    });
    
    waterCoolerBubbles.push({ 
        agentId: agent?.id || name, 
        sprite, 
        time: Date.now(),
        duration: 8000,
    });
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function showWaterCoolerNotification(text) {
    let notif = document.getElementById('watercooler-notif');
    if (!notif) {
        notif = document.createElement('div');
        notif.id = 'watercooler-notif';
        notif.style.cssText = `
            position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
            background: rgba(10, 10, 20, 0.9); border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px; padding: 8px 16px; color: #aaa; font-size: 12px;
            font-family: 'JetBrains Mono', monospace; z-index: 1500;
            transition: opacity 0.5s;
        `;
        document.body.appendChild(notif);
    }
    notif.textContent = text;
    notif.style.opacity = '1';
    setTimeout(() => { notif.style.opacity = '0'; }, 6000);
}

function addWaterCoolerToChat(msg) {
    // Add to the chat panel if it's open for any agent
    const chatEl = document.getElementById('chat-messages');
    if (chatEl && chatEl.closest('#message-panel')?.style.display !== 'none') {
        const div = document.createElement('div');
        div.style.cssText = 'padding: 6px 8px; border-left: 2px solid #ff6b4a; margin: 4px 0; font-size: 11px; color: #888;';
        div.innerHTML = `<span style="color: #ff6b4a;">☕ Water Cooler</span> <b>${msg.name}</b>: ${msg.text}`;
        chatEl.appendChild(div);
        chatEl.scrollTop = chatEl.scrollHeight;
    }
}

// Update water cooler bubbles in animation loop (fade/remove expired)
function updateWaterCoolerBubbles() {
    const now = Date.now();
    waterCoolerBubbles = waterCoolerBubbles.filter(b => {
        const elapsed = now - b.time;
        if (elapsed > b.duration) {
            if (b.sprite.parent) b.sprite.parent.remove(b.sprite);
            b.sprite.material.map.dispose();
            b.sprite.material.dispose();
            return false;
        }
        // Fade out in last 2 seconds
        if (elapsed > b.duration - 2000) {
            b.sprite.material.opacity = (b.duration - elapsed) / 2000;
        }
        // Gentle float
        b.sprite.position.y += 0.0002;
        return true;
    });
}

// Expose for animation loop
window._updateWaterCoolerBubbles = updateWaterCoolerBubbles;

window._updateWaterCoolerBubbles = updateWaterCoolerBubbles;

// ═══════════════════════════════════════════════════════════════
// AGENT LIVE FEED (K-041)
// ═══════════════════════════════════════════════════════════════
let liveFeedAgentId = null;
let liveFeedEvents = [];
const allReceivedEvents = []; // buffer of all WS events for live feed backfill

function openLiveFeed(agentId) {
    const agent = currentState?.agents?.find(a => a.id === agentId);
    if (!agent) return;
    
    liveFeedAgentId = agentId;
    liveFeedEvents = [];
    
    // Backfill from the global event buffer (real-time WS events)
    const existing = allReceivedEvents
        .filter(e => e.agentId === agentId || e.agent === agentId)
        .slice(-50);
    liveFeedEvents = existing;
    
    let overlay = document.getElementById('livefeed-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'livefeed-overlay';
        document.body.appendChild(overlay);
    }
    
    overlay.style.cssText = `
        position: fixed; top: 80px; right: 0; width: 420px; height: calc(100% - 160px);
        background: rgba(8, 8, 16, 0.95); border-left: 1px solid rgba(255,255,255,0.08);
        border-top: 1px solid rgba(255,255,255,0.08); border-bottom: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px 0 0 8px;
        z-index: 1800; display: flex; flex-direction: column;
        font-family: 'JetBrains Mono', monospace;
        backdrop-filter: blur(8px);
        min-width: 280px; min-height: 200px;
        resize: both; overflow: hidden;
    `;
    
    overlay.innerHTML = `
        <div style="padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
            <div>
                <h3 style="margin: 0; color: ${agent.color}; font-size: 14px;">${agent.emoji} ${agent.name} — Live Feed</h3>
                <div style="color: #555; font-size: 10px; margin-top: 2px;">Real-time activity stream</div>
            </div>
            <button onclick="closeLiveFeed()" style="background: #ff4a4a33; border: 1px solid #ff4a4a66; color: #ff4a4a; font-size: 14px; cursor: pointer; padding: 2px 8px; border-radius: 4px; font-weight: bold;">✕</button>
        </div>
        <div style="padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; gap: 6px; flex-wrap: wrap;">
            <span class="feed-tag" style="background: #4a9eff22; color: #4a9eff; padding: 2px 6px; border-radius: 3px; font-size: 9px;">💬 chat</span>
            <span class="feed-tag" style="background: #ff6b4a22; color: #ff6b4a; padding: 2px 6px; border-radius: 3px; font-size: 9px;">🔧 tool</span>
            <span class="feed-tag" style="background: #b44aff22; color: #b44aff; padding: 2px 6px; border-radius: 3px; font-size: 9px;">⚡ spawn</span>
            <span class="feed-tag" style="background: #4ade8022; color: #4ade80; padding: 2px 6px; border-radius: 3px; font-size: 9px;">📊 status</span>
        </div>
        <div id="livefeed-stream" style="flex: 1; overflow-y: auto; padding: 8px;">
            ${renderLiveFeedEvents()}
        </div>
        <div id="livefeed-status" style="padding: 8px 12px; border-top: 1px solid rgba(255,255,255,0.05); color: #333; font-size: 10px; display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; background: #4ade80; border-radius: 50%; animation: pulse-dot 2s infinite;"></span>
            Watching...
        </div>
    `;
    
    // Add pulse animation if not exists
    if (!document.getElementById('livefeed-styles')) {
        const style = document.createElement('style');
        style.id = 'livefeed-styles';
        style.textContent = `
            @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
            #livefeed-stream::-webkit-scrollbar { width: 4px; }
            #livefeed-stream::-webkit-scrollbar-track { background: transparent; }
            #livefeed-stream::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
            #livefeed-overlay::-webkit-resizer { background: rgba(255,255,255,0.1); border-radius: 2px; }
        `;
        document.head.appendChild(style);
    }
    
    // Fetch recent session history (last 30 messages) — zero new overhead, reads existing JSONL
    fetch(`/api/agent/${agentId}/history?limit=30`)
        .then(r => r.json())
        .then(data => {
            if (!data.messages?.length || liveFeedAgentId !== agentId) return;
            
            // Convert history messages to feed events, prepend before live events
            const historyEvents = data.messages.map(m => ({
                type: m.role === 'user' ? 'chat' : (m.toolCalls ? 'tool-call' : 'chat'),
                agentId,
                agent: agentId,
                text: m.text || m.content || '',
                timestamp: m.timestamp || 0,
                data: { role: m.role, toolCalls: m.toolCalls },
                _fromHistory: true,
            }));
            
            // Prepend history, then existing live events
            liveFeedEvents = [...historyEvents, ...liveFeedEvents];
            
            // Re-render
            const stream = document.getElementById('livefeed-stream');
            if (stream) {
                stream.innerHTML = renderLiveFeedEvents();
                stream.scrollTop = stream.scrollHeight;
            }
        })
        .catch(() => {}); // silent fail — live events still work
}

function closeLiveFeed() {
    liveFeedAgentId = null;
    const overlay = document.getElementById('livefeed-overlay');
    if (overlay) overlay.remove();
}

function renderLiveFeedEvents() {
    if (liveFeedEvents.length === 0) {
        return '<div style="color: #333; text-align: center; padding: 40px 0; font-size: 11px;">Loading history...</div>';
    }
    
    let html = '';
    let pastHistory = true;
    for (const e of liveFeedEvents) {
        if (pastHistory && !e._fromHistory) {
            pastHistory = false;
            html += '<div style="text-align: center; padding: 4px; margin: 6px 0; border-top: 1px dashed rgba(255,255,255,0.1);"><span style="font-size: 9px; color: #444;">── live ──</span></div>';
        }
        html += renderFeedEntry(e);
    }
    return html;
}

function renderFeedEntry(e) {
    const typeConfig = {
        'chat': { icon: '💬', color: '#4a9eff', label: 'chat' },
        'tool-call': { icon: '🔧', color: '#ff6b4a', label: 'tool' },
        'tool_call': { icon: '🔧', color: '#ff6b4a', label: 'tool' },
        'tool-result': { icon: '📋', color: '#ff6b4a', label: 'result' },
        'spawn': { icon: '⚡', color: '#b44aff', label: 'spawn' },
        'session-spawn': { icon: '⚡', color: '#b44aff', label: 'spawn' },
        'session-complete': { icon: '✅', color: '#4ade80', label: 'done' },
        'cron': { icon: '⏰', color: '#ffaa4a', label: 'cron' },
        'session': { icon: '📊', color: '#4ade80', label: 'session' },
        'status': { icon: '📊', color: '#4ade80', label: 'status' },
        'heartbeat': { icon: '💓', color: '#ff6b6b', label: 'heartbeat' },
        'agent': { icon: '🔄', color: '#4ade80', label: 'agent' },
    };
    
    const type = e.type || 'status';
    let cfg = typeConfig[type] || { icon: '•', color: '#555', label: type };
    
    // History entries: show role-specific styling
    if (e._fromHistory && e.data?.role) {
        if (e.data.role === 'user') cfg = { icon: '👤', color: '#ffaa4a', label: 'user' };
        else if (e.data.role === 'assistant') cfg = { icon: '🤖', color: '#4a9eff', label: 'assistant' };
    }
    
    const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '';
    
    // ── Smart text extraction (human-readable, like TUI) ──────
    const d = e.data || {};
    let text = '';
    
    if (e._fromHistory) {
        // Session history entries — already have clean text
        text = e.text || '';
    } else if (type === 'chat') {
        // Chat events: show state transitions + content
        const state = d.state || '';
        if (d.content && d.role === 'assistant') {
            text = d.content;
        } else if (d.toolCalls?.length) {
            cfg = { icon: '🔧', color: '#ff6b4a', label: 'tool' };
            text = d.toolCalls.join(', ');
        } else if (state === 'thinking') {
            text = '💭 Thinking...';
        } else if (state === 'responding') {
            text = '✍️ Responding...';
        } else if (state === 'idle') {
            text = '😴 Idle';
        } else if (state) {
            text = state;
        } else if (d.content) {
            text = d.content;
        } else if (d.kind) {
            text = d.kind;
        }
    } else if (type === 'agent') {
        // Agent status events
        const ev = d.event || '';
        if (ev === 'session.start' || ev === 'active') text = '▶️ Session started';
        else if (ev === 'session.end' || ev === 'idle') text = '⏹️ Session ended';
        else if (ev) text = ev;
        else text = 'Status update';
    } else if (type === 'cron') {
        if (d.isHeartbeat) {
            cfg = { icon: '💓', color: '#ff6b6b', label: 'heartbeat' };
            text = d.name || 'Heartbeat check';
        } else {
            text = d.name || 'Cron job fired';
        }
    } else if (type === 'session-spawn') {
        const key = d.sessionKey || '';
        text = `Spawned session: ${key.split(':').slice(-1)[0] || key}`;
    } else if (type === 'session-complete') {
        const key = d.sessionKey || '';
        text = `Session complete: ${key.split(':').slice(-1)[0] || key}`;
    } else {
        // Fallback — try to extract something useful, never dump raw JSON
        text = e.text || e.summary || d.text || d.summary || d.state || d.event || d.name || type;
    }
    
    // Truncate but never show raw JSON
    if (!text) text = type;
    
    const opacity = e._fromHistory ? '0.7' : '1';
    
    return `
        <div style="padding: 6px 8px; margin: 2px 0; border-left: 2px solid ${cfg.color}; background: ${cfg.color}08; border-radius: 0 4px 4px 0; opacity: ${opacity};">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 10px; color: ${cfg.color};">${cfg.icon} ${cfg.label}</span>
                <span style="font-size: 9px; color: #333;">${time}</span>
            </div>
            <div style="font-size: 11px; color: #aaa; margin-top: 3px; line-height: 1.4; word-break: break-word;">${escapeHtml(text).slice(0, 200)}</div>
        </div>
    `;
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Hook into WS events to feed the live panel
function feedLiveEvent(event) {
    // Always buffer events for backfill when panel opens later
    allReceivedEvents.push(event);
    if (allReceivedEvents.length > 500) allReceivedEvents.splice(0, allReceivedEvents.length - 400);
    
    if (!liveFeedAgentId) return;
    if (event.agentId !== liveFeedAgentId && event.agent !== liveFeedAgentId) return;
    
    liveFeedEvents.push(event);
    if (liveFeedEvents.length > 200) liveFeedEvents = liveFeedEvents.slice(-150);
    
    const stream = document.getElementById('livefeed-stream');
    if (stream) {
        const wasScrolled = stream.scrollTop >= stream.scrollHeight - stream.clientHeight - 30;
        stream.insertAdjacentHTML('beforeend', renderFeedEntry(event));
        if (wasScrolled) stream.scrollTop = stream.scrollHeight;
    }
}

window.openLiveFeed = openLiveFeed;
window.closeLiveFeed = closeLiveFeed;
window._feedLiveEvent = feedLiveEvent;

// ═══════════════════════════════════════════════════════════════
// RAYCASTING (hover + click)
// ═══════════════════════════════════════════════════════════════
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredInteractive = null; // for room objects like kanban

canvas.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    
    // Check agent hitboxes (+ Dan's overseer)
    const hitboxes = [];
    agentObjects.forEach(obj => {
        if (obj.userData?.hitbox) hitboxes.push(obj.userData.hitbox);
    });
    if (danAvatar.userData?.hitbox && danAvatar.visible) hitboxes.push(danAvatar.userData.hitbox);
    
    const intersects = raycaster.intersectObjects(hitboxes);
    
    if (intersects.length > 0) {
        const agentId = intersects[0].object.userData.agentId;
        if (hoveredAgentId !== agentId) {
            hoveredAgentId = agentId;
            canvas.style.cursor = 'pointer';
        }
        hoveredInteractive = null;
    } else {
        if (hoveredAgentId) {
            hoveredAgentId = null;
        }
        
        // Check interactive room objects
        const allMeshes = [];
        scene.traverse(obj => {
            if (obj.isMesh || obj.isSprite) {
                // Walk up to find interactive parent
                let p = obj;
                while (p) {
                    if (p.userData?.interactive) {
                        allMeshes.push(obj);
                        break;
                    }
                    p = p.parent;
                }
            }
        });
        
        const roomHits = raycaster.intersectObjects(allMeshes);
        if (roomHits.length > 0) {
            let p = roomHits[0].object;
            while (p && !p.userData?.interactive) p = p.parent;
            if (p?.userData?.interactive) {
                hoveredInteractive = p.userData.interactive;
                canvas.style.cursor = 'pointer';
            } else {
                hoveredInteractive = null;
                canvas.style.cursor = 'default';
            }
        } else {
            hoveredInteractive = null;
            canvas.style.cursor = 'default';
        }
    }
});

canvas.addEventListener('click', (e) => {
    if (controls.isDragging) return;
    
    // Check for monitor clicks first (more specific)
    raycaster.setFromCamera(mouse, camera);
    
    // Check hw-monitor clicks (hardware bench monitors)
    const allHWMonitors = [];
    scene.traverse(obj => {
        if (obj.isMesh && obj.userData?.interactive === 'hw-monitor') {
            allHWMonitors.push(obj);
        }
    });
    const hwMonitorHits = raycaster.intersectObjects(allHWMonitors);
    if (hwMonitorHits.length > 0) {
        const screen = hwMonitorHits[0].object;
        const monitorUrl = screen.userData.monitorUrl;
        const monitorLabel = screen.userData.monitorLabel;
        if (monitorUrl) {
            console.log(`[hw] Opening monitor: ${monitorLabel} → ${monitorUrl}`);
            window.open(monitorUrl, '_blank');
        }
        return;
    }
    
    // Check live TV monitor clicks
    const allMonitorScreens = [];
    scene.traverse(obj => {
        if (obj.isMesh && (obj.userData?.clickable === 'monitor' || obj.userData?.clickable === 'world-monitor' || obj.userData?.clickable === 'trading-dashboard')) {
            allMonitorScreens.push(obj);
        }
    });
    const monitorHits = raycaster.intersectObjects(allMonitorScreens);
    if (monitorHits.length > 0) {
        const screen = monitorHits[0].object;
        if ((screen.userData?.clickable === 'world-monitor' || screen.userData?.clickable === 'trading-dashboard') && screen.userData?.url) {
            console.log(`[${screen.userData.clickable}] Opening: ${screen.userData.url}`);
            window.open(screen.userData.url, '_blank');
        } else {
            openMonitorOverlay(screen);
        }
        return;
    }
    
    // Then check agents
    if (hoveredAgentId === '__dan__') {
        selectBoss();
    } else if (hoveredAgentId) {
        selectAgent(hoveredAgentId);
    } else if (hoveredInteractive) {
        const handlers = {
            'kanban': openKanban,
            'whiteboard': openWhiteboard,
            'server-rack': openServerRack,
            'bookshelf': openBookshelf,
            'coffee-mug': openCoffeeMug,
            'hardware-bench': openHardwareBench,
            'video-wall': playVideoWall,
            'epstein-files': openEpsteinFiles,
        };
        const fn = handlers[hoveredInteractive];
        if (fn) fn();
    }
});

// ═══════════════════════════════════════════════════════════════
// WEBSOCKET CONNECTION
// ═══════════════════════════════════════════════════════════════
let ws;
let currentState = null;
let cartoonMode = false; // Toggle for cartoon vs cyberpunk style

function connectWS() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
        console.log('[ws] Connected');
        document.getElementById('connection-status').textContent = 'Connected';
        document.getElementById('connection-status').className = 'status-active';
    };
    
    ws.onmessage = (event) => {
        try {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'init' || msg.type === 'update') {
            currentState = msg.data;
            updateAgentObjects(currentState.agents || []);
            updateAgentList(currentState.agents || []);
            updatePresenceList(currentState.presence || []);
            updateHeader(currentState);
            
            // Update filter panel if visible
            if (isFilterPanelVisible) {
                updateChannelFilters();
            }
            
            // Track devices (room handles visual representation)
            if (currentState.devices) {
                currentState.devices.forEach(device => {
                    if (!devicePlatforms.has(device.id)) {
                        devicePlatforms.set(device.id, { data: device });
                    }
                });
            }
            
            // Hide loading screen on first init
            if (msg.type === 'init') {
                setTimeout(() => {
                    document.getElementById('loading').classList.add('hidden');
                }, 500);
            }
        }
        
        if (msg.type === 'rpg') {
            handleRPGUpdate(msg.data);
        }
        
        if (msg.type === 'event') {
            updateEventLog(msg);
            
            // Sound: event chime
            if (window._playEventChime) window._playEventChime();
            
            // Feed to live agent monitor
            if (window._feedLiveEvent) {
                // Extract agentId from sessionKey (format: "agent:NAME:session")
                const sk = msg.data?.sessionKey || '';
                const skAgent = sk.split(':')[1] || '';
                window._feedLiveEvent({
                    type: msg.event || msg.data?.type || 'status',
                    agentId: msg.agentId || msg.data?.agentId || skAgent,
                    agent: msg.agent || msg.data?.agent || skAgent,
                    text: msg.data?.content || msg.data?.summary || msg.data?.tool || msg.data?.state || msg.text || '',
                    timestamp: msg.timestamp || msg.ts || Date.now(),
                    data: msg.data,
                });
            }
            
            // Check for agent responses to display in message panel
            if (msg.event === 'chat' && msg.data?.content && msg.data?.role === 'assistant') {
                const sessionKey = msg.data.sessionKey;
                
                console.log('[message-panel] Chat event:', {
                    sessionKey,
                    role: msg.data.role,
                    content: msg.data.content?.substring(0, 50),
                    currentMessageAgentId
                });
                
                // Extract agent ID from session key
                // Patterns: agent:id:main, agent:id:cron:xxx, channel:telegram:id
                let agentId = null;
                if (sessionKey?.startsWith('agent:')) {
                    const parts = sessionKey.split(':');
                    agentId = parts[1]; // agent:nova:main -> nova
                } else if (sessionKey?.startsWith('channel:')) {
                    const parts = sessionKey.split(':');
                    agentId = parts[2]; // channel:telegram:nova -> nova
                }
                
                console.log('[message-panel] Extracted agentId:', agentId);
                
                // If message panel is open for this agent, show response
                if (agentId && currentMessageAgentId === agentId) {
                    console.log('[message-panel] Displaying response in panel');
                    const history = document.getElementById('message-history');
                    const waiting = document.getElementById('message-waiting');
                    
                    if (waiting) {
                        // Replace waiting indicator with actual response
                        waiting.id = '';
                        waiting.textContent = msg.data.content;
                        waiting.style.opacity = '1';
                    } else {
                        // Add new response bubble
                        const agentBubble = document.createElement('div');
                        agentBubble.className = 'message-bubble agent';
                        agentBubble.textContent = msg.data.content;
                        history.appendChild(agentBubble);
                    }
                    
                    history.scrollTop = history.scrollHeight;
                } else {
                    console.log('[message-panel] Not displaying - agentId mismatch or panel closed');
                }
            }
            
            // Visual effects based on event type
            if (msg.event === 'chat' && msg.data?.toolCalls) {
                const sessionKey = msg.data.sessionKey;
                const agentId = sessionKey?.split(':')[1];
                if (agentId) {
                    // Cap tool bursts to prevent buildup
                    if (toolBursts.length < 10) {
                        msg.data.toolCalls.forEach(tool => {
                            createToolBurst({ id: agentId }, tool);
                        });
                    }
                    msg.data.toolCalls.forEach(tool => {
                        addTimelineEvent('tool', agentId, `#${getToolColor(tool).toString(16).padStart(6, '0')}`);
                    });
                }
            }
            
            if (msg.event === 'cron' && msg.data?.isHeartbeat) {
                const agentId = 'nova'; // Assume main agent for now
                createHeartbeatPulse(agentId);
                addTimelineEvent('heartbeat', agentId, '#ffaa4a');
            }
            
            if (msg.event === 'session-spawn') {
                const parentId = msg.data?.agentId;
                const sessionKey = msg.data?.sessionKey;
                if (parentId && sessionKey) {
                    createSubAgentSatellite(sessionKey, parentId);
                    addTimelineEvent('spawn', parentId, '#ffaa4a');
                    
                    // Show spawn notification on parent agent
                    const parentGroup = agentObjects.get(parentId);
                    if (parentGroup) {
                        const parentColor = parentGroup.userData.data?.color || '#ffaa4a';
                        const bubble = createSpeechBubble('🛠️ Spawning sub-agent...', parentColor);
                        bubble.position.copy(parentGroup.position);
                        bubble.position.y += 2.8;
                        scene.add(bubble);
                        speechBubbles.push({ mesh: bubble, startTime: performance.now() / 1000, duration: 4, owner: parentGroup });
                    }
                }
            }
            
            if (msg.event === 'session-complete') {
                const sessionKey = msg.data?.sessionKey;
                if (sessionKey) {
                    completeSubAgentSatellite(sessionKey);
                    
                    // Show completion notification on parent agent
                    const agentId = msg.data?.agentId;
                    const parentGroup = agentObjects.get(agentId);
                    if (parentGroup) {
                        const parentColor = parentGroup.userData.data?.color || '#4ade80';
                        const bubble = createSpeechBubble('✅ Sub-agent complete!', parentColor);
                        bubble.position.copy(parentGroup.position);
                        bubble.position.y += 2.8;
                        scene.add(bubble);
                        speechBubbles.push({ mesh: bubble, startTime: performance.now() / 1000, duration: 4, owner: parentGroup });
                    }
                }
            }
            
            if (msg.event === 'agent') {
                const agentId = msg.data?.agentId;
                if (agentId) {
                    addTimelineEvent('agent', agentId, '#ff6b4a');
                }
            }
            
            // Agent-to-agent chat — show speech bubbles for both sides
            if (msg.event === 'agent-chat') {
                const { from, fromName, to, toName, message: chatMsg, reply } = msg.data;
                
                // Show message from sender
                const fromGroup = agentObjects.get(from);
                if (fromGroup && chatMsg) {
                    const fromColor = fromGroup.userData.data?.color || '#4a9eff';
                    const bubble = createSpeechBubble(`${chatMsg}`, fromColor);
                    bubble.position.copy(fromGroup.position);
                    bubble.position.y += 2.8;
                    scene.add(bubble);
                    speechBubbles.push({ mesh: bubble, startTime: performance.now() / 1000, duration: 6, owner: fromGroup });
                }
                
                // Show reply from recipient (delayed slightly)
                const toGroup = agentObjects.get(to);
                if (toGroup && reply) {
                    setTimeout(() => {
                        const toColor = toGroup.userData.data?.color || '#4a9eff';
                        const replyBubble = createSpeechBubble(`${reply}`, toColor);
                        replyBubble.position.copy(toGroup.position);
                        replyBubble.position.y += 2.8;
                        scene.add(replyBubble);
                        speechBubbles.push({ mesh: replyBubble, startTime: performance.now() / 1000, duration: 8, owner: toGroup });
                    }, 1500);
                }
                
                // Create a message arc between them
                if (fromGroup && toGroup) {
                    createMessagePulse(from, to);
                }
                
                addTimelineEvent('chat', from, '#ff6b4a');
            }
        }
        
        if (msg.type === 'presence') {
            updatePresenceList(msg.data);
        }
        
        if (msg.type === 'gateway-status') {
            const status = document.getElementById('gateway-status').firstElementChild;
            if (msg.connected) {
                status.textContent = '● Connected';
                status.className = 'status-active';
            } else {
                status.textContent = '○ Disconnected';
                status.className = 'status-inactive';
            }
        }
        
        if (msg.type === 'kanban-update') {
            kanbanData = msg.data;
            if (document.getElementById('kanban-overlay').classList.contains('visible')) {
                renderKanban();
            }
        }
        
        if (msg.type === 'appearance-change') {
            // Another browser changed an agent's appearance
            if (!window._agentAppearances) window._agentAppearances = {};
            window._agentAppearances[msg.agentId] = { preset: msg.preset };
            applyAppearanceChange(msg.agentId, msg.preset);
        }
        
        // ── Camera Control (for Liam's photography) ──────────
        if (msg.type === 'camera-set') {
            const { position, target, cameraId, label } = msg;
            if (position && target && camera && controls) {
                console.log(`[camera] Moving to: ${label || cameraId}`);
                
                // Smoothly animate camera to new position
                const startPos = camera.position.clone();
                const startTarget = controls.target.clone();
                const endPos = new THREE.Vector3(position.x, position.y, position.z);
                const endTarget = new THREE.Vector3(target.x, target.y, target.z);
                
                const duration = 1500; // 1.5 seconds
                const startTime = Date.now();
                
                function animateCamera() {
                    const elapsed = Date.now() - startTime;
                    const t = Math.min(elapsed / duration, 1);
                    const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease in-out quad
                    
                    camera.position.lerpVectors(startPos, endPos, eased);
                    controls.target.lerpVectors(startTarget, endTarget, eased);
                    controls.update();
                    
                    if (t < 1) {
                        requestAnimationFrame(animateCamera);
                    } else {
                        console.log(`[camera] Arrived at: ${label || cameraId}`);
                    }
                }
                
                animateCamera();
            }
        }
        
        // ── Water Cooler Chat System ──────────────────────────
        if (msg.type === 'watercooler-start') {
            handleWaterCoolerStart(msg);
        }
        if (msg.type === 'watercooler-message') {
            handleWaterCoolerMessage(msg);
        }
        if (msg.type === 'watercooler-end') {
            handleWaterCoolerEnd(msg);
        }
        } catch (err) {
            console.error('[ws] Error processing message:', err);
            const loadEl = document.getElementById('loading');
            if (loadEl && !loadEl.classList.contains('hidden')) {
                loadEl.classList.add('hidden');
            }
        }
    };
    
    ws.onclose = () => {
        console.log('[ws] Disconnected, reconnecting...');
        document.getElementById('connection-status').textContent = 'Reconnecting...';
        document.getElementById('connection-status').className = 'status-inactive';
        setTimeout(connectWS, 2000);
    };
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION LOOP
// ═══════════════════════════════════════════════════════════════
let time = 0;
let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    time += dt;
    
    // Animate agents (workstations)
    let _nextKeyClick = window._nextKeyClick || 0;
    agentObjects.forEach(group => {
        if (group.userData.character) {
            // New workstation-based animation
            updateWorkstation(group, time, dt, group.userData.data);
        }
    });
    // Random typing sounds for active agents
    if (now > _nextKeyClick) {
        const activeCount = [...agentObjects.values()].filter(g => g.userData.data?.active && g.userData.wanderState === 'seated').length;
        if (activeCount > 0 && window._playKeyClick) window._playKeyClick();
        window._nextKeyClick = now + 400 + Math.random() * 800;
    }
    
    // Animate room (with live data for TV screens)
    if (room) {
        const liveData = buildLiveScreenData();
        room.update(time, dt, liveData);
    }
    
    // Animate Dan's avatar
    updateOverseer(danAvatar, time, dt);
    
    // Update speech bubbles
    updateSpeechBubbles(time);
    
    // Update water cooler chat bubbles
    if (window._updateWaterCoolerBubbles) window._updateWaterCoolerBubbles();
    
    // Day/night cycle (K-044) — update every ~5 seconds
    if (!window._lastDayNightUpdate || now - window._lastDayNightUpdate > 5000) {
        window._lastDayNightUpdate = now;
        updateDayNightCycle();
    }
    
    // Check if Dan should resume patrol after chat idle
    checkChatIdle();
    
    // Connection arcs
    for (let i = connectionArcs.length - 1; i >= 0; i--) {
        const arc = connectionArcs[i];
        arc.userData.age += dt;
        
        if (arc.userData.age > arc.userData.maxAge) {
            scene.remove(arc);
            scene.remove(arc.userData.particle);
            arc.geometry.dispose();
            arc.material.dispose();
            arc.userData.particle.geometry.dispose();
            arc.userData.particle.material.dispose();
            connectionArcs.splice(i, 1);
        } else {
            const t = (arc.userData.age / arc.userData.maxAge);
            arc.userData.particle.position.copy(arc.userData.curve.getPoint(t));
        }
    }
    
    // Tool bursts
    for (let i = toolBursts.length - 1; i >= 0; i--) {
        const burst = toolBursts[i];
        burst.userData.life -= dt;
        
        const pos = burst.geometry.attributes.position.array;
        const vels = burst.userData.velocities;
        
        for (let j = 0; j < vels.length; j++) {
            pos[j * 3] += vels[j].x;
            pos[j * 3 + 1] += vels[j].y;
            pos[j * 3 + 2] += vels[j].z;
            vels[j].y -= 0.001; // Gravity
        }
        
        burst.geometry.attributes.position.needsUpdate = true;
        burst.material.opacity = burst.userData.life / burst.userData.maxLife;
        
        if (burst.userData.life <= 0) {
            scene.remove(burst);
            burst.geometry.dispose();
            burst.material.dispose();
            toolBursts.splice(i, 1);
        }
    }
    
    // Tool labels
    for (let i = toolLabels.length - 1; i >= 0; i--) {
        const label = toolLabels[i];
        label.life -= dt;
        label.sprite.position.y += label.vy;
        label.sprite.material.opacity = Math.max(0, label.life / 1.5);
        
        if (label.life <= 0) {
            scene.remove(label.sprite);
            label.sprite.material.map?.dispose();
            label.sprite.material.dispose();
            toolLabels.splice(i, 1);
        }
    }
    
    // Message pulses
    for (let i = messagePulses.length - 1; i >= 0; i--) {
        const pulse = messagePulses[i];
        pulse.userData.progress += pulse.userData.speed;
        
        if (pulse.userData.progress >= 1) {
            scene.remove(pulse);
            scene.remove(pulse.userData.trail);
            pulse.geometry.dispose();
            pulse.material.dispose();
            pulse.userData.trail.geometry.dispose();
            pulse.userData.trail.material.dispose();
            messagePulses.splice(i, 1);
        } else {
            const point = pulse.userData.curve.getPoint(pulse.userData.progress);
            pulse.position.copy(point);
            pulse.material.opacity = 1 - pulse.userData.progress * 0.5;
            
            pulse.userData.trailHistory.unshift(point.clone());
            if (pulse.userData.trailHistory.length > 10) pulse.userData.trailHistory.pop();
            
            const trailPos = pulse.userData.trail.geometry.attributes.position.array;
            pulse.userData.trailHistory.forEach((p, idx) => {
                trailPos[idx * 3] = p.x;
                trailPos[idx * 3 + 1] = p.y;
                trailPos[idx * 3 + 2] = p.z;
            });
            pulse.userData.trail.geometry.attributes.position.needsUpdate = true;
            pulse.userData.trail.material.opacity = 0.5 * (1 - pulse.userData.progress);
        }
    }
    
    // Sub-agent worker characters
    subAgentSatellites.forEach((worker, sessionKey) => {
        const parentGroup = agentObjects.get(worker.userData.parentId);
        if (!parentGroup) {
            scene.remove(worker);
            subAgentSatellites.delete(sessionKey);
            return;
        }
        
        // Pulse the glow ring
        if (worker.userData.glowRing) {
            const pulse = 0.3 + Math.sin(time * 4) * 0.15;
            worker.userData.glowRing.material.opacity = pulse;
            worker.userData.glowRing.scale.setScalar(1 + Math.sin(time * 3) * 0.15);
        }
        
        const u = worker.userData;
        const phase = u.phase;
        
        if (phase === 'walking-to') {
            // Walk from desk to server rack work zone
            u.moveProgress += u.walkSpeed * dt / getDistance(u.startPos, u.destPos);
            
            if (u.moveProgress >= 1) {
                u.moveProgress = 1;
                u.phase = 'working';
                setCharacterState(worker, 'typing');
                worker.position.set(u.destPos.x, 0, u.destPos.z);
            } else {
                const x = lerp(u.startPos.x, u.destPos.x, u.moveProgress);
                const z = lerp(u.startPos.z, u.destPos.z, u.moveProgress);
                worker.position.set(x, 0, z);
                // Face direction of movement
                worker.rotation.y = Math.atan2(u.destPos.x - u.startPos.x, u.destPos.z - u.startPos.z);
                // Walking leg animation
                setCharacterState(worker, 'talking'); // arms move like walking
            }
            updateCharacter(worker, time, dt);
            
        } else if (phase === 'working') {
            // Working at the server rack
            setCharacterState(worker, 'typing');
            updateCharacter(worker, time, dt);
            // Face the server rack (toward -Z)
            worker.rotation.y = Math.PI;
            
        } else if (phase === 'walking-back') {
            // Walk back to desk
            u.moveProgress += u.walkSpeed * dt / getDistance(u.destPos, u.startPos);
            
            if (u.moveProgress >= 1) {
                u.phase = 'done';
                // Fade out and remove
                scene.remove(worker);
                subAgentSatellites.delete(sessionKey);
                return;
            } else {
                const x = lerp(u.destPos.x, u.startPos.x, u.moveProgress);
                const z = lerp(u.destPos.z, u.startPos.z, u.moveProgress);
                worker.position.set(x, 0, z);
                worker.rotation.y = Math.atan2(u.startPos.x - u.destPos.x, u.startPos.z - u.destPos.z);
                // Fade out as it approaches desk
                const fadeStart = 0.7;
                if (u.moveProgress > fadeStart) {
                    const fade = 1 - (u.moveProgress - fadeStart) / (1 - fadeStart);
                    worker.scale.setScalar(0.45 * fade);
                }
                setCharacterState(worker, 'talking');
            }
            updateCharacter(worker, time, dt);
        }
    });
    
    // Starfield drift
    const spos = stars.geometry.attributes.position.array;
    for (let i = 0; i < starCount; i++) {
        spos[i * 3 + 1] += Math.sin(time * 0.5 + i * 0.1) * 0.001;
    }
    stars.geometry.attributes.position.needsUpdate = true;
    
    // Smooth camera animation (only when actively animating)
    if (cameraAnimating) {
        const targetDist = Math.abs(controls.target.x - cameraTarget.x) +
                          Math.abs(controls.target.y - cameraTarget.y) +
                          Math.abs(controls.target.z - cameraTarget.z);
        
        const posDist = Math.abs(camera.position.x - cameraPosition.x) +
                       Math.abs(camera.position.y - cameraPosition.y) +
                       Math.abs(camera.position.z - cameraPosition.z);
        
        // Stop animating when close enough
        if (targetDist < 0.1 && posDist < 0.1) {
            cameraAnimating = false;
        } else {
            controls.target.x += (cameraTarget.x - controls.target.x) * 0.1;
            controls.target.y += (cameraTarget.y - controls.target.y) * 0.1;
            controls.target.z += (cameraTarget.z - controls.target.z) * 0.1;
            
            camera.position.x += (cameraPosition.x - camera.position.x) * 0.1;
            camera.position.y += (cameraPosition.y - camera.position.y) * 0.1;
            camera.position.z += (cameraPosition.z - camera.position.z) * 0.1;
        }
    }
    
    // WASD keyboard movement
    updateKeyboardMovement(dt);
    
    controls.update();
    
    // Draw timeline
    drawTimeline();
    
    // Render scene with selective bloom
    scene.traverse(darkenNonBloomed);
    bloomComposer.render();
    scene.traverse(restoreMaterials);
    finalComposer.render();
}

// ═══════════════════════════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════════════════════════
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    bloomComposer.setSize(window.innerWidth, window.innerHeight);
    finalComposer.setSize(window.innerWidth, window.innerHeight);
});

// ═══════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════
window.addEventListener('keydown', (e) => {
    // Don't process shortcuts if typing in input fields
    // Don't intercept browser shortcuts (Cmd+R, Cmd+Shift+R, etc.)
    if (e.metaKey || e.ctrlKey) return;
    const isTyping = document.activeElement.tagName === 'INPUT' || 
                     document.activeElement.tagName === 'TEXTAREA';
    
    if (e.key === 'Escape') {
        // Exit first-person mode on Escape
        if (firstPersonMode) {
            toggleFirstPerson();
            return;
        }
        selectAgent(null);
        cameraTarget.x = 0;
        cameraTarget.y = 1;
        cameraTarget.z = 0;
        cameraPosition.x = 0;
        cameraPosition.y = 10;
        cameraPosition.z = 14;
        cameraAnimating = false;
        
        // Close all panels & overlays
        closeMessagePanel();
        closeKanban();
        closeWhiteboard();
        closeInfoOverlay();
        if (settingsVisible) toggleSettings();
        if (document.getElementById('help-overlay').classList.contains('visible')) toggleHelp();
        if (isTerminalVisible) toggleTerminal();
        if (isFilterPanelVisible) toggleFilters();
    }
    
    
    if ((e.key === 'm' || e.key === 'M') && !isTyping) {
        if (selectedAgentId) {
            openMessagePanel(selectedAgentId);
        }
    }
    
    if ((e.key === 't' || e.key === 'T') && !isTyping) {
        toggleTerminal();
    }
    
    if ((e.key === 'f' || e.key === 'F') && !isTyping) {
        toggleFilters();
    }
});

// ═══════════════════════════════════════════════════════════════
// MESSAGE PANEL (v0.5.0)
// ═══════════════════════════════════════════════════════════════
let currentMessageAgentId = null;

function openMessagePanel(agentId) {
    const agent = currentState?.agents?.find(a => a.id === agentId);
    if (!agent) return;
    
    currentMessageAgentId = agentId;
    const panel = document.getElementById('message-panel');
    const title = document.getElementById('message-agent-name');
    
    title.textContent = `${agent.emoji} ${agent.name}`;
    panel.classList.add('visible');
    
    // Clear history and auto-load
    const history = document.getElementById('message-history');
    history.innerHTML = '<div style="text-align: center; color: #555; font-size: 11px; margin-top: 20px;">⏳ Loading history...</div>';
    
    // Auto-load chat history
    loadChatHistory();
    
    // Focus input
    setTimeout(() => {
        document.getElementById('message-input').focus();
    }, 100);
}

function closeMessagePanel() {
    const panel = document.getElementById('message-panel');
    panel.classList.remove('visible');
    currentMessageAgentId = null;
}

async function sendMessage() {
    if (!currentMessageAgentId) return;
    
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (!message) return;
    
    const history = document.getElementById('message-history');
    const sendBtn = document.querySelector('.message-send-btn');
    
    // Clear placeholder
    if (history.innerHTML.includes('Send a message')) {
        history.innerHTML = '';
    }
    
    // Check for @mention to route to a different agent
    const mentionMatch = message.match(/^@(\w+)\s+(.*)/s);
    let targetAgentId = currentMessageAgentId;
    let actualMessage = message;
    let isInterAgentChat = false;
    
    if (mentionMatch) {
        const mentionedName = mentionMatch[1].toLowerCase();
        const mentionedAgent = currentState?.agents?.find(a => 
            a.id.toLowerCase() === mentionedName || 
            (a.name || '').toLowerCase() === mentionedName
        );
        if (mentionedAgent && mentionedAgent.id !== currentMessageAgentId) {
            // Route: ask current agent to talk to mentioned agent
            targetAgentId = mentionedAgent.id;
            actualMessage = mentionMatch[2];
            isInterAgentChat = true;
        }
    }
    
    // Add user message
    const userBubble = document.createElement('div');
    userBubble.className = 'message-bubble user';
    userBubble.textContent = message;
    history.appendChild(userBubble);
    
    // Show speech bubble above Dan + walk Dan to agent
    showSpeechBubble(danAvatar, message, '#ff6b2b', 6);
    walkDanToAgent(isInterAgentChat ? targetAgentId : currentMessageAgentId);
    lastChatTime = performance.now() / 1000;
    
    // Scroll to bottom
    history.scrollTop = history.scrollHeight;
    
    // Clear input and disable
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;
    
    try {
        // Show thinking indicator immediately
        const thinkingBubble = document.createElement('div');
        thinkingBubble.className = 'message-bubble agent';
        thinkingBubble.textContent = isInterAgentChat 
            ? `💭 Asking ${currentState?.agents?.find(a => a.id === targetAgentId)?.name || targetAgentId}...`
            : '💭 Thinking...';
        thinkingBubble.style.opacity = '0.5';
        history.appendChild(thinkingBubble);
        history.scrollTop = history.scrollHeight;
        
        let response;
        if (isInterAgentChat) {
            // Direct message to the mentioned agent (not relay through current agent)
            response = await fetch(`/api/agent/${targetAgentId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: actualMessage })
            });
        } else {
            response = await fetch(`/api/agent/${targetAgentId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: actualMessage })
            });
        }
        
        const data = await response.json();
        
        // Replace thinking indicator with actual reply
        const replyText = data.reply;
        if (replyText) {
            const targetAgent = currentState?.agents?.find(a => a.id === targetAgentId);
            const replyLabel = isInterAgentChat 
                ? `${targetAgent?.emoji || ''} ${targetAgent?.name || targetAgentId}: ${replyText}`
                : replyText;
            thinkingBubble.textContent = replyLabel;
            thinkingBubble.style.opacity = '1';
            
            // Show agent speech bubble in 3D
            const agentGroup = agentObjects.get(targetAgentId);
            if (agentGroup) {
                const agentData = agentGroup.userData.data;
                showSpeechBubble(agentGroup, replyText, agentData?.color || '#4a9eff', 8);
            }
            lastChatTime = performance.now() / 1000;
        } else {
            thinkingBubble.textContent = data.error || 'No response received';
            thinkingBubble.style.borderColor = '#ff4a4a';
            thinkingBubble.style.opacity = '0.8';
        }
        history.scrollTop = history.scrollHeight;
        
    } catch (error) {
        console.error('[message] Send failed:', error);
        
        const errorBubble = document.createElement('div');
        errorBubble.className = 'message-bubble agent';
        errorBubble.textContent = `Error: ${error.message}`;
        errorBubble.style.borderColor = '#ff4a4a';
        history.appendChild(errorBubble);
        
        history.scrollTop = history.scrollHeight;
    } finally {
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
    }
}

// Make functions global for onclick handlers
window.openMessagePanel = openMessagePanel;
window.closeMessagePanel = closeMessagePanel;
window.sendMessage = sendMessage;

// ── Load chat history from agent's session ────────────────────
async function loadChatHistory() {
    if (!currentMessageAgentId) return;
    
    const btn = document.getElementById('load-history-btn');
    const history = document.getElementById('message-history');
    
    btn.disabled = true;
    btn.textContent = '⏳ Loading...';
    
    try {
        const response = await fetch(`/api/agent/${currentMessageAgentId}/history?limit=50`);
        const data = await response.json();
        
        if (!data.messages || data.messages.length === 0) {
            btn.textContent = '📜 No history';
            history.innerHTML = '<div style="text-align: center; color: #555; font-size: 11px; margin-top: 20px;">💬 Send a message to start chatting</div>';
            setTimeout(() => { btn.textContent = '📜 History'; btn.disabled = false; }, 2000);
            return;
        }
        
        // Clear current content
        history.innerHTML = '';
        
        // Add history messages
        data.messages.forEach(msg => {
            const bubble = document.createElement('div');
            bubble.className = `message-bubble ${msg.role === 'user' ? 'user' : 'agent'} history-msg`;
            
            // Truncate very long messages
            const text = msg.text.length > 500 ? msg.text.substring(0, 497) + '...' : msg.text;
            bubble.textContent = text;
            
            // Add timestamp if available
            if (msg.timestamp) {
                const ts = document.createElement('div');
                ts.style.cssText = 'font-size:8px; color:#444; margin-top:2px;';
                const d = new Date(msg.timestamp);
                ts.textContent = d.toLocaleString('en-US', { hour:'2-digit', minute:'2-digit', month:'short', day:'numeric' });
                bubble.appendChild(ts);
            }
            
            history.appendChild(bubble);
        });
        
        // Add divider
        const divider = document.createElement('div');
        divider.className = 'history-divider';
        divider.textContent = `── ${data.total || data.messages.length} messages loaded ── new messages below ──`;
        history.appendChild(divider);
        
        // Scroll to bottom
        history.scrollTop = history.scrollHeight;
        
        btn.textContent = '📜 History';
        btn.disabled = false;
        
    } catch (error) {
        console.error('[history] Load failed:', error);
        btn.textContent = '❌ Error';
        history.innerHTML = '<div style="text-align: center; color: #555; font-size: 11px; margin-top: 20px;">💬 Send a message to start chatting</div>';
        setTimeout(() => { btn.textContent = '📜 History'; btn.disabled = false; }, 2000);
    }
}

// ── Copy chat log to clipboard ────────────────────────────────
async function copyChatLog() {
    const history = document.getElementById('message-history');
    const bubbles = history.querySelectorAll('.message-bubble');
    const copyBtn = history.closest('#message-panel').querySelector('.msg-action-btn:nth-child(2)');
    
    if (bubbles.length === 0) {
        return;
    }
    
    const agentName = document.getElementById('message-agent-name').textContent;
    let chatLog = `Chat with ${agentName}\n${'─'.repeat(40)}\n\n`;
    
    bubbles.forEach(bubble => {
        const isUser = bubble.classList.contains('user');
        const role = isUser ? 'Dan' : agentName;
        
        // Get main text (exclude timestamp sub-elements)
        const clone = bubble.cloneNode(true);
        const timestamp = clone.querySelector('div');
        let ts = '';
        if (timestamp) {
            ts = ` [${timestamp.textContent}]`;
            timestamp.remove();
        }
        const text = clone.textContent.trim();
        
        chatLog += `${role}${ts}:\n${text}\n\n`;
    });
    
    try {
        await navigator.clipboard.writeText(chatLog);
        if (copyBtn) {
            copyBtn.classList.add('success');
            copyBtn.textContent = '✅ Copied!';
            setTimeout(() => {
                copyBtn.classList.remove('success');
                copyBtn.textContent = '📋 Copy';
            }, 2000);
        }
    } catch (err) {
        // Fallback: select text
        const textarea = document.createElement('textarea');
        textarea.value = chatLog;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        if (copyBtn) {
            copyBtn.classList.add('success');
            copyBtn.textContent = '✅ Copied!';
            setTimeout(() => {
                copyBtn.classList.remove('success');
                copyBtn.textContent = '📋 Copy';
            }, 2000);
        }
    }
}

window.loadChatHistory = loadChatHistory;
window.copyChatLog = copyChatLog;

// ═══════════════════════════════════════════════════════════════
// KANBAN BOARD (interactive)
// ═══════════════════════════════════════════════════════════════

let kanbanData = null;
let dragState = null; // { columnIndex, cardIndex }

async function openKanban() {
    const overlay = document.getElementById('kanban-overlay');
    overlay.classList.add('visible');
    await refreshKanban();
}

function closeKanban() {
    document.getElementById('kanban-overlay').classList.remove('visible');
}

async function refreshKanban() {
    try {
        const res = await fetch('/api/kanban');
        kanbanData = await res.json();
        renderKanban();
    } catch (e) {
        console.error('[kanban] Load failed:', e);
    }
}

function renderKanban() {
    const board = document.getElementById('kanban-board');
    if (!kanbanData) return;
    
    board.innerHTML = '';
    
    kanbanData.columns.forEach((col, colIdx) => {
        const column = document.createElement('div');
        column.className = 'kanban-column';
        
        // Header
        const header = document.createElement('div');
        header.className = 'kanban-col-header';
        header.style.borderColor = col.color;
        header.style.color = col.color;
        header.innerHTML = `${col.name} <span class="kanban-col-count">${col.cards.length}</span>`;
        column.appendChild(header);
        
        // Cards container
        const cards = document.createElement('div');
        cards.className = 'kanban-cards';
        cards.dataset.colIdx = colIdx;
        
        // Drop zone events
        cards.addEventListener('dragover', (e) => {
            e.preventDefault();
            cards.classList.add('kanban-drop-zone');
        });
        cards.addEventListener('dragleave', () => {
            cards.classList.remove('kanban-drop-zone');
        });
        cards.addEventListener('drop', async (e) => {
            e.preventDefault();
            cards.classList.remove('kanban-drop-zone');
            if (!dragState) return;
            
            const toCol = parseInt(cards.dataset.colIdx);
            if (dragState.columnIndex === toCol && dragState.cardIndex === col.cards.length) return;
            
            await fetch('/api/kanban/card', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'move',
                    columnIndex: dragState.columnIndex,
                    cardIndex: dragState.cardIndex,
                    toColumn: toCol,
                }),
            });
            dragState = null;
            await refreshKanban();
        });
        
        col.cards.forEach((card, cardIdx) => {
            const el = document.createElement('div');
            el.className = 'kanban-card';
            el.draggable = true;
            
            el.addEventListener('dragstart', () => {
                dragState = { columnIndex: colIdx, cardIndex: cardIdx };
                el.classList.add('dragging');
            });
            el.addEventListener('dragend', () => {
                el.classList.remove('dragging');
            });
            
            let html = '';
            if (card.id) html += `<div class="kanban-card-id">${card.id}</div>`;
            html += `<div>${card.text}</div>`;
            if (card.tag) {
                html += `<span class="kanban-card-tag ${card.tag}">${card.tag}</span>`;
            }
            html += `<div class="kanban-card-actions">
                <button class="kanban-card-btn" onclick="editKanbanCard(${colIdx}, ${cardIdx})" title="Edit">✏️</button>
                <button class="kanban-card-btn" onclick="deleteKanbanCard(${colIdx}, ${cardIdx})" title="Delete">🗑️</button>
            </div>`;
            
            el.innerHTML = html;
            cards.appendChild(el);
        });
        
        column.appendChild(cards);
        
        // Add card button
        const addBtn = document.createElement('div');
        addBtn.className = 'kanban-add-btn';
        addBtn.textContent = '+ Add Card';
        addBtn.onclick = () => addKanbanCard(colIdx);
        column.appendChild(addBtn);
        
        board.appendChild(column);
    });
}

async function addKanbanCard(columnIndex) {
    const text = prompt('Card text:');
    if (!text) return;
    const tag = prompt('Tag (feature/bug/infra/integration):', 'feature') || '';
    
    await fetch('/api/kanban/card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', columnIndex, card: { text, tag } }),
    });
    await refreshKanban();
}

async function editKanbanCard(columnIndex, cardIndex) {
    const card = kanbanData.columns[columnIndex]?.cards[cardIndex];
    if (!card) return;
    
    const text = prompt('Card text:', card.text);
    if (text === null) return;
    const tag = prompt('Tag:', card.tag || '') || '';
    
    await fetch('/api/kanban/card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', columnIndex, cardIndex, card: { text, tag } }),
    });
    await refreshKanban();
}

async function deleteKanbanCard(columnIndex, cardIndex) {
    if (!confirm('Delete this card?')) return;
    
    await fetch('/api/kanban/card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', columnIndex, cardIndex }),
    });
    await refreshKanban();
}

window.openKanban = openKanban;
window.closeKanban = closeKanban;
window.addKanbanCard = addKanbanCard;
window.editKanbanCard = editKanbanCard;
window.deleteKanbanCard = deleteKanbanCard;

// ═══════════════════════════════════════════════════════════════
// MONITOR FULLSCREEN OVERLAY
// ═══════════════════════════════════════════════════════════════

function openMonitorOverlay(screenMesh) {
    const overlay = document.getElementById('monitor-overlay');
    const overlayCanvas = document.getElementById('monitor-overlay-canvas');
    const title = document.getElementById('monitor-overlay-title');
    
    const agentData = screenMesh.userData.agentData;
    const sourceCanvas = screenMesh.userData.canvas;
    
    // Set title
    title.textContent = `🖥️ ${agentData.name || 'Agent'}'s Monitor`;
    
    // Copy canvas content at higher resolution — crisp pixel-perfect text
    overlayCanvas.width = sourceCanvas.width * 2;
    overlayCanvas.height = sourceCanvas.height * 2;
    const ctx = overlayCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false; // crisp text, no blur
    ctx.drawImage(sourceCanvas, 0, 0, overlayCanvas.width, overlayCanvas.height);
    
    overlay.classList.add('visible');
}

function closeMonitor() {
    document.getElementById('monitor-overlay').classList.remove('visible');
}

window.openMonitorOverlay = openMonitorOverlay;
window.closeMonitor = closeMonitor;

// ═══════════════════════════════════════════════════════════════
// SETTINGS PANEL (cogwheel)
// ═══════════════════════════════════════════════════════════════

let settingsVisible = false;
const baseLightIntensities = {}; // store original intensities

function captureBaseLights() {
    scene.traverse(obj => {
        if (obj.isLight && !baseLightIntensities[obj.uuid]) {
            baseLightIntensities[obj.uuid] = obj.intensity;
        }
    });
}

function toggleSettings() {
    settingsVisible = !settingsVisible;
    document.getElementById('settings-panel').classList.toggle('visible', settingsVisible);
    if (settingsVisible) {
        captureBaseLights();
        updateSettingsInfo();
    }
}

function setBrightness(val) {
    const factor = val / 100;
    document.getElementById('brightness-value').textContent = val + '%';
    
    // Mark as manual override so day/night cycle doesn't fight it
    const slider = document.getElementById('brightness-slider');
    if (slider) slider.dataset.manual = 'true';
    
    scene.traverse(obj => {
        if (obj.isLight && baseLightIntensities[obj.uuid] !== undefined) {
            obj.intensity = baseLightIntensities[obj.uuid] * factor;
        }
    });
    saveSettings();
}

function setAmbientColor(hex) {
    scene.traverse(obj => {
        if (obj.isAmbientLight) {
            obj.color.setHex(hex);
        }
    });
    savedAmbientColor = hex;
    saveSettings();
}

function setFogDensity(val) {
    const density = val / 1000;
    document.getElementById('fog-value').textContent = density.toFixed(3);
    if (scene.fog) {
        scene.fog.density = density;
    }
    saveSettings();
}

// ── Invert Mouse Setting ──────────────────────────────────────
let invertMouseY = false;
let savedAmbientColor = null;

function setInvertMouse(checked) {
    invertMouseY = checked;
    saveSettings();
}

// ── Water Cooler Chats Setting ────────────────────────────────
let waterCoolerEnabled = true;

function setWaterCooler(checked) {
    waterCoolerEnabled = checked;
    saveSettings();
    // Tell the server
    fetch('/api/watercooler/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: checked }),
    }).catch(() => {});
}

function triggerWaterCoolerNow() {
    fetch('/api/watercooler/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
}

// ── Settings Persistence ──────────────────────────────────────
function saveSettings() {
    const settings = {
        brightness: document.getElementById('brightness-slider')?.value,
        fogDensity: document.getElementById('fog-slider')?.value,
        ambientColor: savedAmbientColor,
        invertMouseY: invertMouseY,
        waterCoolerEnabled: waterCoolerEnabled,
    };
    try { localStorage.setItem('autolab-settings', JSON.stringify(settings)); } catch {}
}

function loadSettings() {
    try {
        const raw = localStorage.getItem('autolab-settings');
        if (!raw) return;
        const s = JSON.parse(raw);
        
        if (s.brightness != null) {
            const slider = document.getElementById('brightness-slider');
            if (slider) { slider.value = s.brightness; setBrightness(s.brightness); }
        }
        if (s.fogDensity != null) {
            const slider = document.getElementById('fog-slider');
            if (slider) { slider.value = s.fogDensity; setFogDensity(s.fogDensity); }
        }
        if (s.ambientColor != null) {
            savedAmbientColor = s.ambientColor;
            setAmbientColor(s.ambientColor);
        }
        if (s.invertMouseY != null) {
            invertMouseY = s.invertMouseY;
            const cb = document.getElementById('invert-mouse-checkbox');
            if (cb) cb.checked = invertMouseY;
        }
        // Reverse scroll loaded from its own localStorage key
        {
            const rsCb = document.getElementById('reverse-scroll-checkbox');
            if (rsCb) rsCb.checked = reverseScroll;
        }
        if (s.waterCoolerEnabled != null) {
            waterCoolerEnabled = s.waterCoolerEnabled;
            const cb = document.getElementById('watercooler-checkbox');
            if (cb) cb.checked = waterCoolerEnabled;
        }
    } catch {}
}

function updateSettingsInfo() {
    const agents = currentState?.agents || [];
    const agentNames = agents.map(a => a.name || a.id).join(', ') || '—';
    document.getElementById('settings-agents').textContent = `${agents.length} — ${agentNames}`;
}

window.toggleSettings = toggleSettings;
window.setBrightness = setBrightness;
window.setAmbientColor = setAmbientColor;
window.setFogDensity = setFogDensity;
window.setInvertMouse = setInvertMouse;
window.setWaterCooler = setWaterCooler;
window.triggerWaterCoolerNow = triggerWaterCoolerNow;

// ═══════════════════════════════════════════════════════════════
// THEME SYSTEM (Light/Dark + Floor/Wall Customization)
// ═══════════════════════════════════════════════════════════════

function applyTheme(theme) {
    if (theme === 'light') {
        // Light mode: bright background, lighter fog, more ambient light
        scene.background = new THREE.Color(0xd0d5e0);
        if (scene.fog) scene.fog.color = new THREE.Color(0xd0d5e0);
        
        // Increase ambient light
        scene.traverse(obj => {
            if (obj.isAmbientLight) {
                obj.intensity = 1.2;
                obj.color.setHex(0xf0f0f0);
            }
        });
        
        // Default light floor and walls for light theme
        applyFloorStyle('wood-light');
        applyWallColor('cream');
        
    } else {
        // Dark mode: restore original dark theme
        scene.background = new THREE.Color(0x060610);
        if (scene.fog) scene.fog.color = new THREE.Color(0x060610);
        
        scene.traverse(obj => {
            if (obj.isAmbientLight) {
                obj.intensity = 0.6;
                obj.color.setHex(savedAmbientColor || 0x2a2a5a);
            }
        });
        
        applyFloorStyle('concrete-dark');
        applyWallColor('dark-gray');
    }
    
    saveThemeSettings();
}

function applyFloorStyle(style) {
    const roomObj = window._roomObject;
    if (!roomObj?.floor) return;
    
    const floor = roomObj.floor;
    const grid = roomObj.gridGroup;
    
    switch (style) {
        case 'concrete-dark':
            floor.material.color.setHex(0x0f0f1a);
            floor.material.roughness = 0.85;
            floor.material.metalness = 0.15;
            if (grid) {
                grid.traverse(obj => {
                    if (obj.isMesh || obj.isLine) {
                        obj.material.color.setHex(0x151530);
                        obj.material.opacity = 0.4;
                    }
                });
            }
            break;
        case 'wood-light':
            floor.material.color.setHex(0x8b6f47);
            floor.material.roughness = 0.7;
            floor.material.metalness = 0.05;
            if (grid) {
                grid.traverse(obj => {
                    if (obj.isMesh || obj.isLine) {
                        obj.material.color.setHex(0x6b5537);
                        obj.material.opacity = 0.2;
                    }
                });
            }
            break;
        case 'tile-white':
            floor.material.color.setHex(0xe8e8f0);
            floor.material.roughness = 0.4;
            floor.material.metalness = 0.1;
            if (grid) {
                grid.traverse(obj => {
                    if (obj.isMesh || obj.isLine) {
                        obj.material.color.setHex(0xb8b8c8);
                        obj.material.opacity = 0.3;
                    }
                });
            }
            break;
    }
    
    saveThemeSettings();
}

function applyWallColor(colorName) {
    const roomObj = window._roomObject;
    if (!roomObj) return;
    
    let wallColor;
    switch (colorName) {
        case 'dark-gray':
            wallColor = 0x0c0c22;
            break;
        case 'cream':
            wallColor = 0xf5f0e8;
            break;
        case 'light-blue':
            wallColor = 0xd0e0f0;
            break;
        case 'sage-green':
            wallColor = 0xc8d5c0;
            break;
        default:
            wallColor = 0x0c0c22;
    }
    
    [roomObj.backWall, roomObj.leftWall, roomObj.rightWall].forEach(wall => {
        if (wall) wall.material.color.setHex(wallColor);
    });
    
    // Ceiling follows walls but slightly darker/lighter
    if (roomObj.ceiling) {
        if (colorName === 'dark-gray') {
            roomObj.ceiling.material.color.setHex(0x080818);
        } else {
            // For light themes, make ceiling slightly darker
            const c = new THREE.Color(wallColor);
            c.multiplyScalar(0.85);
            roomObj.ceiling.material.color.copy(c);
        }
    }
    
    saveThemeSettings();
}

function saveThemeSettings() {
    const theme = document.getElementById('theme-selector')?.value || 'dark';
    const floor = document.getElementById('floor-selector')?.value || 'concrete-dark';
    const wall = document.getElementById('wall-selector')?.value || 'dark-gray';
    const backdrop = document.getElementById('backdrop-selector')?.value || 'none';
    
    const settings = {
        theme,
        floor,
        wall,
        backdrop,
    };
    
    try {
        localStorage.setItem('autolab-theme', JSON.stringify(settings));
    } catch {}
}

function loadThemeSettings() {
    try {
        const raw = localStorage.getItem('autolab-theme');
        if (!raw) return;
        const s = JSON.parse(raw);
        
        if (s.theme) {
            const sel = document.getElementById('theme-selector');
            if (sel) {
                sel.value = s.theme;
                applyTheme(s.theme);
            }
        }
        if (s.floor) {
            const sel = document.getElementById('floor-selector');
            if (sel) {
                sel.value = s.floor;
                applyFloorStyle(s.floor);
            }
        }
        if (s.wall) {
            const sel = document.getElementById('wall-selector');
            if (sel) {
                sel.value = s.wall;
                applyWallColor(s.wall);
            }
        }
        if (s.backdrop) {
            const sel = document.getElementById('backdrop-selector');
            if (sel) {
                sel.value = s.backdrop;
                applyBackdrop(s.backdrop);
            }
        }
    } catch {}
}

window.applyTheme = applyTheme;
window.applyFloorStyle = applyFloorStyle;
window.applyWallColor = applyWallColor;

// ── TV Wall Backdrop (front wall behind screens) ──────────────
function applyBackdrop(style) {
    const roomObj = window._roomObject;
    if (!roomObj?.backWall) return; // backWall = front wall in our naming convention
    
    const wall = roomObj.backWall;
    
    // Generate procedural texture on a canvas
    const texSize = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = texSize;
    canvas.height = texSize;
    const ctx = canvas.getContext('2d');
    
    switch (style) {
        case 'none':
            // Remove texture, use plain wall color
            wall.material.map = null;
            wall.material.needsUpdate = true;
            return;
            
        case 'wood-horizontal': {
            // Horizontal wood planks
            ctx.fillStyle = '#5a3e28';
            ctx.fillRect(0, 0, texSize, texSize);
            const plankH = texSize / 12;
            for (let i = 0; i < 12; i++) {
                const y = i * plankH;
                const shade = 60 + Math.sin(i * 2.3) * 15;
                ctx.fillStyle = `rgb(${shade + 30}, ${shade + 15}, ${shade - 10})`;
                ctx.fillRect(0, y + 1, texSize, plankH - 2);
                // Wood grain
                ctx.strokeStyle = `rgba(0,0,0,0.08)`;
                ctx.lineWidth = 1;
                for (let g = 0; g < 8; g++) {
                    ctx.beginPath();
                    const gy = y + Math.random() * plankH;
                    ctx.moveTo(0, gy);
                    for (let x = 0; x < texSize; x += 20) {
                        ctx.lineTo(x, gy + Math.sin(x * 0.02 + i) * 3);
                    }
                    ctx.stroke();
                }
            }
            break;
        }
        case 'wood-vertical': {
            // Vertical wood planks
            ctx.fillStyle = '#4a3020';
            ctx.fillRect(0, 0, texSize, texSize);
            const plankW = texSize / 10;
            for (let i = 0; i < 10; i++) {
                const x = i * plankW;
                const shade = 55 + Math.sin(i * 1.7) * 12;
                ctx.fillStyle = `rgb(${shade + 25}, ${shade + 10}, ${shade - 8})`;
                ctx.fillRect(x + 1, 0, plankW - 2, texSize);
                // Vertical grain
                ctx.strokeStyle = `rgba(0,0,0,0.06)`;
                ctx.lineWidth = 1;
                for (let g = 0; g < 6; g++) {
                    ctx.beginPath();
                    const gx = x + Math.random() * plankW;
                    ctx.moveTo(gx, 0);
                    for (let y = 0; y < texSize; y += 20) {
                        ctx.lineTo(gx + Math.sin(y * 0.015 + i) * 2, y);
                    }
                    ctx.stroke();
                }
            }
            break;
        }
        case 'stone-slate': {
            // Irregular stone slate
            ctx.fillStyle = '#3a3a42';
            ctx.fillRect(0, 0, texSize, texSize);
            // Draw irregular stone blocks
            const rows = 8, cols = 6;
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const bx = c * (texSize / cols) + (r % 2 ? texSize / cols / 2 : 0);
                    const by = r * (texSize / rows);
                    const bw = texSize / cols - 4 + Math.sin(r * 3 + c * 7) * 8;
                    const bh = texSize / rows - 4 + Math.cos(r * 5 + c * 2) * 6;
                    const shade = 50 + Math.sin(r * 2.1 + c * 3.7) * 15;
                    ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 5})`;
                    ctx.fillRect(bx + 2, by + 2, bw, bh);
                    // Subtle edge highlight
                    ctx.strokeStyle = `rgba(255,255,255,0.04)`;
                    ctx.strokeRect(bx + 2, by + 2, bw, bh);
                }
            }
            break;
        }
        case 'brick': {
            // Classic brick pattern
            ctx.fillStyle = '#2a1a15';
            ctx.fillRect(0, 0, texSize, texSize); // mortar color
            const brickW = texSize / 8;
            const brickH = texSize / 16;
            for (let r = 0; r < 16; r++) {
                const offset = (r % 2) ? brickW / 2 : 0;
                for (let c = -1; c < 9; c++) {
                    const bx = c * brickW + offset;
                    const by = r * brickH;
                    const shade = 120 + Math.sin(r * 1.3 + c * 2.7) * 25;
                    ctx.fillStyle = `rgb(${shade + 20}, ${shade - 30}, ${shade - 45})`;
                    ctx.fillRect(bx + 2, by + 2, brickW - 4, brickH - 4);
                    // Slight texture variation
                    ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.03})`;
                    ctx.fillRect(bx + 2, by + 2, brickW - 4, brickH - 4);
                }
            }
            break;
        }
        case 'concrete': {
            // Industrial concrete
            ctx.fillStyle = '#555560';
            ctx.fillRect(0, 0, texSize, texSize);
            // Noise texture
            for (let i = 0; i < 15000; i++) {
                const x = Math.random() * texSize;
                const y = Math.random() * texSize;
                const a = Math.random() * 0.08;
                ctx.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${a})`;
                ctx.fillRect(x, y, 2, 2);
            }
            // Form lines
            ctx.strokeStyle = 'rgba(0,0,0,0.06)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 5; i++) {
                const y = texSize * (0.15 + i * 0.18);
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(texSize, y + Math.sin(i) * 3);
                ctx.stroke();
            }
            break;
        }
        case 'dark-panel': {
            // Dark acoustic/tech panels
            ctx.fillStyle = '#0a0a18';
            ctx.fillRect(0, 0, texSize, texSize);
            const panelSize = texSize / 6;
            for (let r = 0; r < 6; r++) {
                for (let c = 0; c < 6; c++) {
                    const px = c * panelSize;
                    const py = r * panelSize;
                    const shade = 12 + Math.sin(r * 1.5 + c * 2.3) * 5;
                    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade + 8})`;
                    ctx.fillRect(px + 3, py + 3, panelSize - 6, panelSize - 6);
                    // Subtle inner border glow
                    ctx.strokeStyle = `rgba(74, 158, 255, 0.06)`;
                    ctx.strokeRect(px + 4, py + 4, panelSize - 8, panelSize - 8);
                }
            }
            break;
        }
        default:
            wall.material.map = null;
            wall.material.needsUpdate = true;
            return;
    }
    
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1); // tile across the wide wall
    wall.material.map = tex;
    wall.material.needsUpdate = true;
    
    saveThemeSettings();
}

window.applyBackdrop = applyBackdrop;

// ── Require Password for Agent Edits ──────────────────────────
let requirePasswordForEdits = false;

async function loadAutolabSettings() {
    try {
        const resp = await fetch('/api/settings');
        const data = await resp.json();
        requirePasswordForEdits = !!data.requirePassword;
        const cb = document.getElementById('require-password-checkbox');
        if (cb) cb.checked = requirePasswordForEdits;
    } catch (e) {}
}

async function setRequirePassword(checked) {
    requirePasswordForEdits = checked;
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requirePassword: checked }),
        });
    } catch (e) {}
}

window.setRequirePassword = setRequirePassword;

// Load settings on startup
loadAutolabSettings();

// ═══════════════════════════════════════════════════════════════
// HELP PANEL
// ═══════════════════════════════════════════════════════════════

function toggleHelp() {
    document.getElementById('help-overlay').classList.toggle('visible');
}
window.toggleHelp = toggleHelp;

// ═══════════════════════════════════════════════════════════════
// WHITEBOARD (editable notepad)
// ═══════════════════════════════════════════════════════════════

async function openWhiteboard() {
    const overlay = document.getElementById('whiteboard-overlay');
    overlay.classList.add('visible');
    try {
        const res = await fetch('/api/whiteboard');
        const data = await res.json();
        document.getElementById('whiteboard-text').value = data.text || '';
    } catch { }
}

function closeWhiteboard() {
    document.getElementById('whiteboard-overlay').classList.remove('visible');
}

async function saveWhiteboard() {
    const text = document.getElementById('whiteboard-text').value;
    await fetch('/api/whiteboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
    });
    // Brief flash to confirm save
    const btn = event.target;
    btn.textContent = '✅ Saved!';
    setTimeout(() => btn.textContent = '💾 Save', 1200);
}

window.openWhiteboard = openWhiteboard;
window.closeWhiteboard = closeWhiteboard;
window.saveWhiteboard = saveWhiteboard;

// ═══════════════════════════════════════════════════════════════
// INFO OVERLAY (server rack stats, bookshelf, coffee mug)
// ═══════════════════════════════════════════════════════════════

function closeInfoOverlay() {
    document.getElementById('info-overlay').classList.remove('visible');
}
window.closeInfoOverlay = closeInfoOverlay;

async function openServerRack() {
    const overlay = document.getElementById('info-overlay');
    document.getElementById('info-overlay-title').textContent = '🖥️ Server Rack — System Stats';
    const content = document.getElementById('info-overlay-content');
    content.innerHTML = '<div style="color:#555">Loading system stats...</div>';
    overlay.classList.add('visible');
    
    try {
        const res = await fetch('/api/system-stats');
        const stats = await res.json();
        content.innerHTML = `
            <div style="display:grid; gap:12px;">
                <div><span style="color:#4a9eff;">⏱ UPTIME</span><br><code>${stats.uptime}</code></div>
                <div><span style="color:#4ade80;">💾 DISK</span><br><code>${stats.disk}</code></div>
                <div><span style="color:#ffaa4a;">🧠 MEMORY</span><br><pre style="margin:0;font-size:10px;color:#888;">${stats.memory}</pre></div>
                <div><span style="color:#a855f7;">⚙️ PROCESSES</span><br><code>${stats.processes} running</code></div>
                <div><span style="color:#4a9eff;">📦 NODE</span><br><code>${stats.nodeVersion}</code></div>
                <div><span style="color:#4ade80;">🤖 GATEWAY PID</span><br><code>${stats.gatewayPid}</code></div>
                <div><span style="color:#ffaa4a;">🔧 VIZ SERVER</span><br><code>Up ${stats.serverUptime}</code></div>
            </div>
        `;
    } catch (e) {
        content.innerHTML = `<div style="color:#ff4a4a;">Error: ${e.message}</div>`;
    }
}

function openBookshelf() {
    const overlay = document.getElementById('info-overlay');
    document.getElementById('info-overlay-title').textContent = '📚 Bookshelf — Agent Knowledge Base';
    document.getElementById('info-overlay-content').innerHTML = `
        <div style="display:grid; gap:8px;">
            <div style="padding:10px; background:rgba(74,158,255,0.05); border-radius:6px; border-left:3px solid #4a9eff;">
                <strong style="color:#4a9eff;">Three.js Fundamentals</strong><br>
                <span style="color:#666; font-size:10px;">Scene graph, materials, lights, cameras, animation loop</span>
            </div>
            <div style="padding:10px; background:rgba(74,222,128,0.05); border-radius:6px; border-left:3px solid #4ade80;">
                <strong style="color:#4ade80;">WebSocket Protocols</strong><br>
                <span style="color:#666; font-size:10px;">Real-time agent ↔ viz communication</span>
            </div>
            <div style="padding:10px; background:rgba(168,85,247,0.05); border-radius:6px; border-left:3px solid #a855f7;">
                <strong style="color:#a855f7;">Agent Architecture</strong><br>
                <span style="color:#666; font-size:10px;">Sessions, heartbeats, tool calls, event streams</span>
            </div>
            <div style="padding:10px; background:rgba(255,170,74,0.05); border-radius:6px; border-left:3px solid #ffaa4a;">
                <strong style="color:#ffaa4a;">Cyberpunk Design Bible</strong><br>
                <span style="color:#666; font-size:10px;">Neon accents, dark themes, holographic aesthetics</span>
            </div>
            <div style="padding:10px; background:rgba(255,74,74,0.05); border-radius:6px; border-left:3px solid #ff4a4a;">
                <strong style="color:#ff4a4a;">The Deployer's Handbook</strong><br>
                <span style="color:#666; font-size:10px;">npm publish, Docker, GitHub releases, CI/CD</span>
            </div>
        </div>
        <div style="margin-top:16px; color:#444; font-size:10px; text-align:center;">📖 Future: connect to actual agent knowledge bases</div>
    `;
    overlay.classList.add('visible');
}

function openCoffeeMug() {
    const overlay = document.getElementById('info-overlay');
    document.getElementById('info-overlay-title').textContent = '☕ Coffee Fuel Gauge';
    
    // Pull real token data from current agent state
    const agents = currentState?.agents || [];
    let html = '<div style="display:grid; gap:12px;">';
    
    agents.forEach(a => {
        const tokens = a.tokens || 0;
        const maxTokens = 500000; // rough daily budget
        const pct = Math.min(100, (tokens / maxTokens) * 100);
        const color = pct > 66 ? '#4ade80' : pct > 33 ? '#ffaa4a' : '#ff4a4a';
        const cups = Math.floor(pct / 20);
        const coffeeEmoji = '☕'.repeat(cups) + '⬜'.repeat(5 - cups);
        
        html += `
            <div style="padding:10px; background:rgba(255,255,255,0.02); border-radius:6px;">
                <strong style="color:${a.color || '#4a9eff'};">${a.name || a.id}</strong>
                <div style="margin-top:6px;">
                    <div style="background:rgba(255,255,255,0.05); border-radius:3px; height:8px; overflow:hidden;">
                        <div style="width:${pct}%; height:100%; background:${color}; border-radius:3px; transition:width 0.3s;"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:9px; color:#555;">
                        <span>${coffeeEmoji}</span>
                        <span>${tokens.toLocaleString()} tokens</span>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    if (agents.length === 0) html = '<div style="color:#555;">No agent data yet. Connect to gateway first.</div>';
    
    document.getElementById('info-overlay-content').innerHTML = html;
    overlay.classList.add('visible');
}

function openEpsteinFiles() {
    // Open Epstein Files explorer in new tab
    const url = 'http://localhost:5101/documents';
    window.open(url, '_blank', 'noopener,noreferrer');
    
    // Optional: Show brief notification
    const notification = document.createElement('div');
    notification.textContent = '📁 Opening Epstein Files...';
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: rgba(74, 158, 255, 0.9);
        color: white;
        padding: 12px 20px;
        border-radius: 6px;
        font-size: 14px;
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}

// ═══════════════════════════════════════════════════════════════
// HARDWARE BENCH
// ═══════════════════════════════════════════════════════════════
let hwDevices = [];
let hwDefaultUser = 'overseer';

async function loadHardwareConfig() {
    try {
        const res = await fetch('/api/hardware');
        const data = await res.json();
        hwDevices = data.devices || [];
        hwDefaultUser = data.defaultUser || 'overseer';
        // Populate 3D hardware bench after loading config
        populateHardwareBench3D();
    } catch (e) {
        console.warn('[hw] Failed to load device config:', e);
    }
}

function populateHardwareBench3D() {
    // Find the hardware bench in the scene
    const bench = scene.getObjectByName('hardware-bench');
    if (!bench) {
        console.warn('[hw] Hardware bench not found in scene');
        return;
    }
    
    // Remove any existing device models
    const existing = bench.children.filter(c => c.userData.deviceId);
    existing.forEach(child => bench.remove(child));
    
    // Add 3D models for each device (physical bodies only, no monitors yet)
    hwDevices.forEach((dev, index) => {
        // Determine device type based on description/name
        let deviceType = 'tower'; // default
        if (dev.name.toLowerCase().includes('laptop') || dev.desc.toLowerCase().includes('laptop')) {
            deviceType = 'laptop';
        }
        
        // Create device with NO monitors (we'll add unified monitors separately)
        const device3D = createMacDevice(deviceType, []);
        device3D.userData.deviceId = dev.id;
        device3D.userData.deviceConfig = dev;
        
        // Position devices on the bench (spaced along the width)
        // Bench is 3.0 wide, position at -1.0, 0.0, 1.0 for up to 3 devices
        const xPositions = [-1.0, 0.0, 1.0];
        const xPos = xPositions[index % 3] || 0;
        
        device3D.position.set(xPos, 0.83, 0); // Just above the bench surface
        bench.add(device3D);
    });
    
    // Collect ALL monitors from ALL devices into one unified array
    const allMonitors = [];
    hwDevices.forEach(dev => {
        if (dev.monitors && dev.monitors.length > 0) {
            allMonitors.push(...dev.monitors);
        }
    });
    
    // Create ONE unified monitor group (using 'monitors-only' type to skip device body)
    if (allMonitors.length > 0) {
        const monitorGroup = createMacDevice('monitors-only', allMonitors);
        monitorGroup.userData.deviceId = 'unified-monitors';
        
        // Position centered on bench
        monitorGroup.position.set(0, 0.83, 0);
        bench.add(monitorGroup);
        
        console.log(`[hw] Added ${hwDevices.length} devices + unified ${allMonitors.length} monitors to hardware bench`);
    } else {
        console.log(`[hw] Added ${hwDevices.length} device models to hardware bench`);
    }
}

// ── Video Wall Click Handler ──────────────────────────────────
// ── Boss (Dan/Overseer) Detail Panel ──────────────────────────
let bossConfig = { name: 'Dan', preset: 'human' };

function loadBossConfig() {
    const saved = (window._agentAppearances || {})['__dan__'];
    if (saved) {
        if (saved.name) bossConfig.name = saved.name;
        if (saved.preset) bossConfig.preset = saved.preset;
    }
}

function selectBoss() {
    loadBossConfig();
    selectedAgentId = '__dan__';
    
    const panel = document.getElementById('detail-panel');
    const danColor = '#ff6b2b';
    
    panel.innerHTML = `
        <button class="close-detail" onclick="selectAgent(null)">✕</button>
        <h2>🧔 ${escapeHtml(bossConfig.name)} — The Boss</h2>
        <div class="detail-header">
            <div style="color: #888; font-size: 11px;">Overseer · Walks the floor</div>
            <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;">
                <button onclick="openBossNameEdit()" style="padding: 6px 12px; background: ${danColor}33; border: 1px solid ${danColor}66; border-radius: 4px; color: ${danColor}; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                    ✏️ Edit Name
                </button>
                <button onclick="openDanPanel()" style="padding: 6px 12px; background: #b44aff33; border: 1px solid #b44aff66; border-radius: 4px; color: #b44aff; font-size: 11px; font-weight: 600; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
                    🎨 Customize
                </button>
            </div>
        </div>
        
        <h3>Info</h3>
        <div class="stats-grid">
            <div class="stat-box">
                <div class="stat-label">Name</div>
                <div class="stat-value" id="boss-name-display" style="font-size: 13px;">${escapeHtml(bossConfig.name)}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Character</div>
                <div class="stat-value" style="font-size: 12px;">${bossConfig.preset}</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Role</div>
                <div class="stat-value" style="font-size: 12px; color: ${danColor}">OVERSEER</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Mode</div>
                <div class="stat-value" style="font-size: 12px;">Spectator</div>
            </div>
        </div>
        
        <div id="boss-name-editor" style="display: none; margin-top: 12px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
            <div style="font-size: 11px; color: #888; margin-bottom: 6px;">Change display name:</div>
            <div style="display: flex; gap: 6px;">
                <input id="boss-name-input" type="text" value="${escapeHtml(bossConfig.name)}" maxlength="20"
                    style="flex: 1; padding: 6px 10px; background: #0a0a12; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #eee; font-size: 12px; font-family: 'JetBrains Mono', monospace; outline: none;"
                    onkeydown="if(event.key==='Enter') saveBossName()">
                <button onclick="saveBossName()" style="padding: 6px 12px; background: #4ade8033; border: 1px solid #4ade8066; border-radius: 4px; color: #4ade80; font-size: 11px; font-weight: 600; cursor: pointer;">Save</button>
            </div>
            <div id="boss-name-status" style="font-size: 10px; color: #555; margin-top: 4px;"></div>
        </div>
    `;
    
    panel.classList.add('visible');
}

function openBossNameEdit() {
    const editor = document.getElementById('boss-name-editor');
    if (editor) {
        editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
        if (editor.style.display === 'block') {
            const input = document.getElementById('boss-name-input');
            if (input) { input.focus(); input.select(); }
        }
    }
}

async function saveBossName() {
    const input = document.getElementById('boss-name-input');
    const status = document.getElementById('boss-name-status');
    if (!input) return;
    
    const newName = input.value.trim();
    if (!newName) {
        if (status) status.textContent = '✗ Name cannot be empty';
        return;
    }
    
    try {
        if (status) status.textContent = 'Saving...';
        
        await fetch('/api/appearances/__dan__', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preset: bossConfig.preset, name: newName }),
        });
        
        bossConfig.name = newName;
        if (!window._agentAppearances) window._agentAppearances = {};
        window._agentAppearances['__dan__'] = { preset: bossConfig.preset, name: newName };
        
        // Update the panel header and display
        const nameDisplay = document.getElementById('boss-name-display');
        if (nameDisplay) nameDisplay.textContent = newName;
        
        // Update the h2
        const panel = document.getElementById('detail-panel');
        const h2 = panel?.querySelector('h2');
        if (h2) h2.textContent = `🧔 ${newName} — The Boss`;
        
        if (status) status.textContent = '✓ Saved!';
        setTimeout(() => { if (status) status.textContent = ''; }, 1500);
    } catch (e) {
        if (status) status.textContent = '✗ Failed to save';
    }
}

window.selectBoss = selectBoss;
window.openBossNameEdit = openBossNameEdit;
window.saveBossName = saveBossName;

// ── Dan's Overseer Customize Panel ────────────────────────────
function openDanPanel() {
    const presets = getCharacterPresets();
    const currentPreset = (window._agentAppearances || {})['__dan__']?.preset || 'human';
    const danColor = '#ff6b2b';
    
    // Add 'overseer' as a special option (the default Dan model)
    const allOptions = {
        overseer: { name: 'Overseer', icon: '🧔', style: 'original' },
        ...presets,
    };
    
    const presetCards = Object.entries(allOptions).map(([key, p]) => {
        const isSelected = key === currentPreset;
        return `
            <div class="preset-card ${isSelected ? 'selected' : ''}" 
                 data-preset="${key}" 
                 onclick="selectDanPreset('${key}')"
                 style="
                    background: ${isSelected ? danColor + '22' : 'rgba(255,255,255,0.03)'};
                    border: 2px solid ${isSelected ? danColor : 'rgba(255,255,255,0.08)'};
                    border-radius: 8px;
                    padding: 12px 8px;
                    cursor: pointer;
                    text-align: center;
                    transition: all 0.2s;
                 ">
                <div style="font-size: 28px; margin-bottom: 6px;">${p.icon}</div>
                <div style="font-size: 11px; font-weight: 600; color: ${isSelected ? danColor : '#aaa'};">${p.name}</div>
                <div style="font-size: 9px; color: #555; margin-top: 2px;">${p.style}</div>
            </div>
        `;
    }).join('');
    
    let overlay = document.getElementById('user-customize-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'user-customize-overlay';
        document.body.appendChild(overlay);
    }
    
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7); z-index: 2000;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(4px);
    `;
    
    overlay.innerHTML = `
        <div style="
            background: #12121a; border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px; padding: 24px; max-width: 500px; width: 90%;
            max-height: 80vh; overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        ">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h2 style="margin: 0; font-size: 18px; color: ${danColor};">🧔 Dan — The Boss</h2>
                <button onclick="closeDanPanel()" style="
                    background: none; border: none; color: #666; font-size: 20px; cursor: pointer;
                ">✕</button>
            </div>
            <p style="color: #666; font-size: 12px; margin: 0 0 16px 0;">Choose your avatar in the 3D space. You walk the floor and inspect your agents.</p>
            <div id="user-preset-grid" style="
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 8px;
            ">${presetCards}</div>
            <div id="user-customize-status" style="
                margin-top: 12px; font-size: 11px; color: #555; text-align: center; min-height: 16px;
            "></div>
        </div>
    `;
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDanPanel();
    });
}

function closeDanPanel() {
    const overlay = document.getElementById('user-customize-overlay');
    if (overlay) overlay.remove();
}

async function selectDanPreset(presetKey) {
    const statusEl = document.getElementById('user-customize-status');
    if (statusEl) statusEl.textContent = 'Applying...';
    
    try {
        // Save to server
        await fetch('/api/appearances/__dan__', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preset: presetKey }),
        });
        
        // Update local cache
        if (!window._agentAppearances) window._agentAppearances = {};
        window._agentAppearances['__dan__'] = { preset: presetKey };
        
        // Rebuild Dan's avatar
        if (presetKey === 'overseer') {
            // Rebuild with original overseer model
            const newOverseer = createOverseer();
            // Copy position/rotation from current
            newOverseer.position.copy(danAvatar.position);
            newOverseer.rotation.copy(danAvatar.rotation);
            // Transfer userData
            const ud = danAvatar.userData;
            newOverseer.userData = { ...newOverseer.userData, ...ud };
            // Re-add hitbox
            const hb = new THREE.Mesh(
                new THREE.BoxGeometry(0.8, 1.6, 0.8),
                new THREE.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0, depthWrite: false })
            );
            hb.position.y = 0.8;
            hb.userData.agentId = '__dan__';
            newOverseer.add(hb);
            newOverseer.userData.hitbox = hb;
            // Swap in scene
            scene.remove(danAvatar);
            danAvatar.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose?.(); });
            Object.assign(danAvatar, {});
            scene.add(newOverseer);
            // Update reference — can't reassign const, so copy children
            while (danAvatar.children.length) danAvatar.remove(danAvatar.children[0]);
            danAvatar.copy(newOverseer, true);
            scene.remove(newOverseer);
            scene.add(danAvatar);
        } else {
            // Use agent character system — rebuild Dan with a preset
            rebuildAgentCharacter(danAvatar, presetKey);
        }
        
        // Update selected state in UI
        document.querySelectorAll('#user-preset-grid .preset-card').forEach(card => {
            const isSelected = card.dataset.preset === presetKey;
            card.classList.toggle('selected', isSelected);
            card.style.background = isSelected ? '#ff6b2b22' : 'rgba(255,255,255,0.03)';
            card.style.borderColor = isSelected ? '#ff6b2b' : 'rgba(255,255,255,0.08)';
            card.querySelector('div:nth-child(2)').style.color = isSelected ? '#ff6b2b' : '#aaa';
        });
        
        if (statusEl) statusEl.textContent = '✓ Applied!';
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 1500);
    } catch (e) {
        if (statusEl) statusEl.textContent = '✗ Failed to save';
    }
}

window.openDanPanel = openDanPanel;
window.closeDanPanel = closeDanPanel;
window.selectDanPreset = selectDanPreset;

function playVideoWall() {
    // Find the video wall in the scene
    let videoGroup = null;
    scene.traverse(obj => {
        if (obj.userData?.interactive === 'video-wall' && obj.userData?.video) {
            videoGroup = obj;
        }
    });
    if (!videoGroup) return;
    
    const video = videoGroup.userData.video;
    
    // Unmute, rewind, play one loop
    video.muted = false;
    video.currentTime = 0;
    video.play().catch(() => {});
    
    // Re-mute and freeze when this playback ends
    const onEnd = () => {
        video.muted = true;
        // Freeze on a nice frame
        video.currentTime = video.duration * 0.25;
        setTimeout(() => {
            if (videoGroup.userData.videoTexture) videoGroup.userData.videoTexture.needsUpdate = true;
        }, 100);
        video.removeEventListener('ended', onEnd);
    };
    video.addEventListener('ended', onEnd);
}

function openHardwareBench() {
    const overlay = document.getElementById('hardware-overlay');
    const container = overlay.querySelector('.kanban-container');
    
    if (hwDevices.length === 0) {
        container.innerHTML = `
            <div class="kanban-header"><h2>🔧 Hardware Rack</h2><button class="kanban-close" onclick="closeHardwareBench()">✕</button></div>
            <div style="color:#666; padding:20px; text-align:center;">Loading devices...<br><small>Check devices-config.json</small></div>`;
        overlay.classList.add('visible');
        loadHardwareConfig().then(() => { if (hwDevices.length > 0) openHardwareBench(); });
        return;
    }
    
    let html = '<div class="kanban-header"><h2>🔧 Hardware Rack</h2><button class="kanban-close" onclick="closeHardwareBench()">✕</button></div>';
    html += '<div style="display:grid; gap:16px; padding:8px 0;">';
    
    hwDevices.forEach(dev => {
        html += `
        <div style="background:rgba(255,255,255,0.03); border:1px solid ${dev.color}33; border-radius:8px; padding:14px; position:relative;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                <span style="font-size:24px;">${dev.icon}</span>
                <div>
                    <strong style="color:${dev.color}; font-size:13px;">${dev.name}</strong>
                    <div style="color:#666; font-size:10px; margin-top:2px;">${dev.desc}</div>
                    <div style="color:#444; font-size:9px; margin-top:1px;">🖧 ${dev.resolvedHost || dev.host} · 👤 ${dev.user || hwDefaultUser}</div>
                </div>
                <div style="margin-left:auto;">
                    <span id="hw-led-${dev.id}" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#555;"></span>
                </div>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
                ${dev.services.map(svc => `
                    <button onclick="launchService('${dev.id}', '${svc.id}')" style="
                        padding:5px 12px; border-radius:4px; border:1px solid ${dev.color}44;
                        background:rgba(255,255,255,0.03); color:${dev.color}; cursor:pointer;
                        font-size:11px; font-family:'JetBrains Mono', monospace;
                        transition: background 0.2s;
                    " onmouseover="this.style.background='${dev.color}22'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">${svc.label}</button>
                `).join('')}
            </div>
        </div>`;
    });
    
    html += '</div>';
    html += '<div style="margin-top:12px; color:#444; font-size:9px; text-align:center;">SSH opens terminal · HTTP opens in browser tab · IPs resolved from server</div>';
    
    container.innerHTML = html;
    overlay.classList.add('visible');
    
    checkHardwareStatus();
}

async function checkHardwareStatus() {
    for (const dev of hwDevices) {
        const gwService = dev.services.find(s => s.id === 'gateway');
        const led = document.getElementById(`hw-led-${dev.id}`);
        if (!led) continue;
        
        if (gwService?.url) {
            try {
                const res = await fetch(`/api/hw-ping?url=${encodeURIComponent(gwService.url)}`, { 
                    signal: AbortSignal.timeout(3000) 
                });
                const data = await res.json();
                led.style.background = data.online ? '#4ade80' : '#ff4a4a';
                led.title = data.online ? `Online (${dev.resolvedHost})` : 'Offline';
            } catch {
                led.style.background = '#555';
                led.title = 'Unknown';
            }
        } else {
            led.style.background = '#666';
            led.title = 'No gateway service configured';
        }
    }
}

function launchService(deviceId, serviceId) {
    const dev = hwDevices.find(d => d.id === deviceId);
    const svc = dev?.services.find(s => s.id === serviceId);
    if (!dev || !svc) return;
    
    if (svc.type === 'http' && svc.url) {
        window.open(svc.url, '_blank');
    } else if (svc.type === 'ssh') {
        const user = dev.user || hwDefaultUser;
        const host = dev.resolvedHost || dev.host;
        const sshCmd = `ssh ${user}@${host}`;
        
        closeHardwareBench();
        
        // Open the built-in terminal and run SSH command
        const terminal = document.getElementById('terminal');
        if (terminal?.classList.contains('hidden-panel')) toggleTerminal();
        
        // Send the SSH command to the terminal
        setTimeout(() => {
            const input = document.getElementById('terminal-input');
            if (input) {
                input.value = sshCmd;
                // Trigger the command
                const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
                input.dispatchEvent(enterEvent);
            }
        }, 200);
    }
}

function closeHardwareBench() {
    document.getElementById('hardware-overlay').classList.remove('visible');
}

// Load device config on startup
loadHardwareConfig();

window.openHardwareBench = openHardwareBench;
window.closeHardwareBench = closeHardwareBench;
window.launchService = launchService;

// ═══════════════════════════════════════════════════════════════
// TERMINAL (v0.5.0)
// ═══════════════════════════════════════════════════════════════
let terminalHistory = [];
let terminalHistoryIndex = -1;
let isTerminalVisible = false;

function toggleTerminal() {
    const terminal = document.getElementById('terminal');
    isTerminalVisible = !isTerminalVisible;
    
    if (isTerminalVisible) {
        terminal.classList.add('visible');
        setTimeout(() => {
            document.getElementById('terminal-input').focus();
        }, 100);
    } else {
        terminal.classList.remove('visible');
    }
}

function addTerminalLine(text, type = 'normal') {
    const output = document.getElementById('terminal-output');
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

async function executeTerminalCommand(command) {
    if (!command.trim()) return;
    
    // Add to history
    terminalHistory.push(command);
    terminalHistoryIndex = terminalHistory.length;
    
    // Display command
    addTerminalLine(command, 'command');
    
    // Handle built-in commands
    if (command === 'help') {
        addTerminalLine('Available commands:', 'success');
        addTerminalLine('  autolab status       - Show AutoLab status');
        addTerminalLine('  autolab gateway status - Show gateway status');
        addTerminalLine('  autolab session list - List active sessions');
        addTerminalLine('  autolab agent --help - Show agent help');
        addTerminalLine('  clear                 - Clear terminal');
        addTerminalLine('  help                  - Show this help');
        return;
    }
    
    if (command === 'clear') {
        const output = document.getElementById('terminal-output');
        output.innerHTML = '';
        return;
    }
    
    // Execute via API
    try {
        const response = await fetch('/api/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Display output
            if (data.output) {
                data.output.split('\n').forEach(line => {
                    addTerminalLine(line);
                });
            }
            if (data.error) {
                data.error.split('\n').forEach(line => {
                    addTerminalLine(line, 'error');
                });
            }
        } else {
            addTerminalLine(`Error: ${data.error}`, 'error');
            if (data.allowed) {
                addTerminalLine('Allowed commands:', 'error');
                data.allowed.forEach(cmd => {
                    addTerminalLine(`  ${cmd}`, 'error');
                });
            }
        }
        
    } catch (error) {
        addTerminalLine(`Error: ${error.message}`, 'error');
    }
}

function handleTerminalInput(event) {
    const input = document.getElementById('terminal-input');
    
    if (event.key === 'Enter') {
        const command = input.value.trim();
        if (command) {
            executeTerminalCommand(command);
            input.value = '';
        }
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (terminalHistoryIndex > 0) {
            terminalHistoryIndex--;
            input.value = terminalHistory[terminalHistoryIndex];
        }
    } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (terminalHistoryIndex < terminalHistory.length - 1) {
            terminalHistoryIndex++;
            input.value = terminalHistory[terminalHistoryIndex];
        } else {
            terminalHistoryIndex = terminalHistory.length;
            input.value = '';
        }
    }
}

// Make functions global for onclick handlers
window.toggleTerminal = toggleTerminal;
window.handleTerminalInput = handleTerminalInput;

// ═══════════════════════════════════════════════════════════════
// FILTERS (v0.5.0)
// ═══════════════════════════════════════════════════════════════
let isFilterPanelVisible = false;
let activeFilters = {
    status: 'all',
    channels: new Set(),
    burnRate: new Set()
};

function toggleFilters() {
    const panel = document.getElementById('filter-panel');
    isFilterPanelVisible = !isFilterPanelVisible;
    
    if (isFilterPanelVisible) {
        panel.classList.add('visible');
        updateChannelFilters();
    } else {
        panel.classList.remove('visible');
    }
}

function updateChannelFilters() {
    const container = document.getElementById('channel-filters');
    if (!currentState?.agents) return;
    
    // Get unique channels across all agents
    const channels = new Set();
    currentState.agents.forEach(agent => {
        if (agent.channels) {
            agent.channels.forEach(ch => channels.add(ch));
        }
    });
    
    // Build checkbox list
    container.innerHTML = Array.from(channels).sort().map(channel => `
        <label class="filter-checkbox">
            <input type="checkbox" value="${channel}" onchange="updateChannelFilter('${channel}', this.checked)">
            ${channel}
        </label>
    `).join('');
}

function updateChannelFilter(channel, checked) {
    if (checked) {
        activeFilters.channels.add(channel);
    } else {
        activeFilters.channels.delete(channel);
    }
    applyFilters();
}

function applyFilters() {
    // Get filter values
    const statusFilter = document.querySelector('input[name="status-filter"]:checked')?.value || 'all';
    activeFilters.status = statusFilter;
    
    const highBurn = document.getElementById('filter-high-burn')?.checked;
    const medBurn = document.getElementById('filter-med-burn')?.checked;
    const lowBurn = document.getElementById('filter-low-burn')?.checked;
    
    activeFilters.burnRate.clear();
    if (highBurn) activeFilters.burnRate.add('high');
    if (medBurn) activeFilters.burnRate.add('medium');
    if (lowBurn) activeFilters.burnRate.add('low');
    
    // Apply to 3D scene
    if (!currentState?.agents) return;
    
    currentState.agents.forEach(agent => {
        const agentObj = agentObjects[agent.id];
        if (!agentObj) return;
        
        let visible = true;
        
        // Status filter
        if (statusFilter === 'active' && !agent.active) visible = false;
        if (statusFilter === 'idle' && agent.active) visible = false;
        
        // Channel filter (if any channels selected, agent must have at least one)
        if (activeFilters.channels.size > 0) {
            const hasMatchingChannel = agent.channels?.some(ch => activeFilters.channels.has(ch));
            if (!hasMatchingChannel) visible = false;
        }
        
        // Burn rate filter (if any selected)
        if (activeFilters.burnRate.size > 0) {
            const burnRate = agent.burnRate || 0;
            let matches = false;
            
            if (activeFilters.burnRate.has('high') && burnRate > 400) matches = true;
            if (activeFilters.burnRate.has('medium') && burnRate >= 200 && burnRate <= 400) matches = true;
            if (activeFilters.burnRate.has('low') && burnRate < 200) matches = true;
            
            if (!matches) visible = false;
        }
        
        // Apply visibility (fade instead of hide)
        agentObj.traverse(obj => {
            if (obj.material) {
                obj.material.opacity = visible ? (obj.material.opacity > 0.5 ? 1 : obj.material.opacity) : 0.15;
            }
        });
    });
}

function resetFilters() {
    // Reset radio buttons
    document.querySelector('input[name="status-filter"][value="all"]').checked = true;
    
    // Reset checkboxes
    document.querySelectorAll('#channel-filters input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('filter-high-burn').checked = false;
    document.getElementById('filter-med-burn').checked = false;
    document.getElementById('filter-low-burn').checked = false;
    
    // Clear active filters
    activeFilters.status = 'all';
    activeFilters.channels.clear();
    activeFilters.burnRate.clear();
    
    // Restore all agents
    Object.values(agentObjects).forEach(agentObj => {
        agentObj.traverse(obj => {
            if (obj.material && obj.material.opacity < 0.5) {
                obj.material.opacity = 1;
            }
        });
    });
}

// Make functions global
window.toggleFilters = toggleFilters;
window.updateChannelFilter = updateChannelFilter;
window.applyFilters = applyFilters;
window.resetFilters = resetFilters;

// ═══════════════════════════════════════════════════════════════
// MOBILE TOUCH CONTROLS (v0.5.0)
// ═══════════════════════════════════════════════════════════════
let touchState = {
    touches: [],
    lastDistance: 0,
    lastMidpoint: { x: 0, y: 0 },
    lastTap: 0
};

// Touch start
window.addEventListener('touchstart', (e) => {
    touchState.touches = Array.from(e.touches);
    
    if (e.touches.length === 2) {
        // Two-finger gesture starting
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchState.lastDistance = Math.sqrt(dx * dx + dy * dy);
        
        touchState.lastMidpoint = {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2
        };
        
        // Disable OrbitControls for two-finger gestures
        controls.enabled = false;
    } else if (e.touches.length === 1) {
        // Single tap - check for double-tap
        const now = Date.now();
        if (now - touchState.lastTap < 300) {
            // Double tap - reset camera
            cameraTarget.x = 0;
            cameraTarget.y = 1;
            cameraTarget.z = 0;
            cameraPosition.x = 0;
            cameraPosition.y = 10;
            cameraPosition.z = 14;
        }
        touchState.lastTap = now;
    }
}, { passive: false });

// Touch move
window.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
        e.preventDefault(); // Prevent page scroll
        
        // Calculate distance for pinch-to-zoom
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Calculate midpoint for pan
        const midpoint = {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2
        };
        
        // Pinch to zoom
        if (touchState.lastDistance > 0) {
            const delta = distance - touchState.lastDistance;
            const zoomFactor = 1 - (delta * 0.01);
            
            cameraPosition.x *= zoomFactor;
            cameraPosition.y *= zoomFactor;
            cameraPosition.z *= zoomFactor;
            
            // Clamp zoom
            const dist = Math.sqrt(
                cameraPosition.x * cameraPosition.x +
                cameraPosition.y * cameraPosition.y +
                cameraPosition.z * cameraPosition.z
            );
            if (dist < 5) {
                const scale = 5 / dist;
                cameraPosition.x *= scale;
                cameraPosition.y *= scale;
                cameraPosition.z *= scale;
            }
            if (dist > 30) {
                const scale = 30 / dist;
                cameraPosition.x *= scale;
                cameraPosition.y *= scale;
                cameraPosition.z *= scale;
            }
        }
        
        // Two-finger pan
        if (touchState.lastMidpoint.x !== 0) {
            const panX = (midpoint.x - touchState.lastMidpoint.x) * 0.01;
            const panY = (midpoint.y - touchState.lastMidpoint.y) * 0.01;
            
            cameraTarget.x -= panX;
            cameraTarget.z += panY;
        }
        
        touchState.lastDistance = distance;
        touchState.lastMidpoint = midpoint;
    }
}, { passive: false });

// Touch end
window.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
        // Re-enable OrbitControls when not using two-finger gestures
        controls.enabled = true;
        touchState.lastDistance = 0;
        touchState.lastMidpoint = { x: 0, y: 0 };
    }
}, { passive: false });

// ═══════════════════════════════════════════════════════════════
// SOUND ENGINE (K-042)
// ═══════════════════════════════════════════════════════════════
let audioCtx = null;
let soundEnabled = false;
let ambientNode = null;
let ambientGain = null;

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create ambient office hum (low drone)
    ambientGain = audioCtx.createGain();
    ambientGain.gain.value = 0;
    ambientGain.connect(audioCtx.destination);
    
    // Layer 1: Low hum
    const osc1 = audioCtx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 60;
    const g1 = audioCtx.createGain();
    g1.gain.value = 0.03;
    osc1.connect(g1);
    g1.connect(ambientGain);
    osc1.start();
    
    // Layer 2: Very low rumble
    const osc2 = audioCtx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 45;
    const g2 = audioCtx.createGain();
    g2.gain.value = 0.02;
    osc2.connect(g2);
    g2.connect(ambientGain);
    osc2.start();
    
    // Layer 3: High air noise (white noise filtered)
    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    
    ambientNode = audioCtx.createBufferSource();
    ambientNode.buffer = noiseBuffer;
    ambientNode.loop = true;
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 0.5;
    
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.value = 0.008;
    
    ambientNode.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ambientGain);
    ambientNode.start();
}

function playKeyClick() {
    if (!soundEnabled || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1800 + Math.random() * 600;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.02;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
}

function playEventChime() {
    if (!soundEnabled || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 880;
    osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.15);
    const gain = audioCtx.createGain();
    gain.gain.value = 0.04;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}

function playWalkStep() {
    if (!soundEnabled || !audioCtx) return;
    const bufferSize = audioCtx.sampleRate * 0.05;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.015;
    const filt = audioCtx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 400;
    src.connect(filt);
    filt.connect(gain);
    gain.connect(audioCtx.destination);
    src.start();
}

function playWaterCoolerBubble() {
    if (!soundEnabled || !audioCtx) return;
    // Gentle pop/bubble sound
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    osc.frequency.exponentialRampToValueAtTime(660, audioCtx.currentTime + 0.1);
    const gain = audioCtx.createGain();
    gain.gain.value = 0.03;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

function toggleSound() {
    initAudio();
    soundEnabled = !soundEnabled;
    
    const btn = document.getElementById('sound-btn');
    if (btn) btn.textContent = soundEnabled ? '🔊' : '🔇';
    
    if (ambientGain) {
        ambientGain.gain.linearRampToValueAtTime(
            soundEnabled ? 1 : 0,
            audioCtx.currentTime + 0.5
        );
    }
    
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

// Expose sound functions for other modules
window.toggleSound = toggleSound;
window._playKeyClick = playKeyClick;
window._playEventChime = playEventChime;
window._playWalkStep = playWalkStep;
window._playWaterCoolerBubble = playWaterCoolerBubble;

// ═══════════════════════════════════════════════════════════════
// DAY/NIGHT CYCLE (K-044)
// ═══════════════════════════════════════════════════════════════
let dayNightEnabled = true;
let dayNightOverride = null; // null = auto, 'day'|'night'|'sunset' for manual

function updateDayNightCycle() {
    if (!dayNightEnabled) return;
    
    const hour = new Date().getHours();
    const minute = new Date().getMinutes();
    const t = hour + minute / 60;
    
    // Time-based light profile
    // 6-8am: sunrise (warm orange → bright)
    // 8am-5pm: daytime (bright, neutral)
    // 5-7pm: sunset (warm orange/red)
    // 7pm-10pm: evening (dim, warm)
    // 10pm-6am: night (very dim, blue)
    
    let brightness, ambientR, ambientG, ambientB, fogDensity;
    
    if (t >= 6 && t < 8) {
        // Sunrise
        const p = (t - 6) / 2;
        brightness = 80 + p * 50;
        ambientR = 0.35 + p * 0.1;
        ambientG = 0.25 + p * 0.15;
        ambientB = 0.15 + p * 0.2;
        fogDensity = 0.02 - p * 0.005;
    } else if (t >= 8 && t < 17) {
        // Daytime
        brightness = 130;
        ambientR = 0.45;
        ambientG = 0.4;
        ambientB = 0.35;
        fogDensity = 0.015;
    } else if (t >= 17 && t < 19) {
        // Sunset
        const p = (t - 17) / 2;
        brightness = 130 - p * 40;
        ambientR = 0.45 - p * 0.1;
        ambientG = 0.4 - p * 0.15;
        ambientB = 0.35 - p * 0.15;
        fogDensity = 0.015 + p * 0.005;
    } else if (t >= 19 && t < 22) {
        // Evening
        const p = (t - 19) / 3;
        brightness = 90 - p * 30;
        ambientR = 0.35 - p * 0.15;
        ambientG = 0.25 - p * 0.1;
        ambientB = 0.2 + p * 0.05;
        fogDensity = 0.02 + p * 0.005;
    } else {
        // Night (10pm - 6am)
        brightness = 60;
        ambientR = 0.15;
        ambientG = 0.12;
        ambientB = 0.25;
        fogDensity = 0.025;
    }
    
    // Apply — but don't override user's manual brightness setting
    const slider = document.getElementById('brightness-slider');
    const isManual = slider && slider.dataset.manual === 'true';
    
    if (!isManual) {
        // Apply ambient color
        scene.traverse(obj => {
            if (obj.isAmbientLight) {
                obj.color.setRGB(ambientR, ambientG, ambientB);
            }
        });
        
        // Apply brightness
        const factor = brightness / 100;
        captureBaseLights();
        scene.traverse(obj => {
            if (obj.isLight && baseLightIntensities[obj.uuid] !== undefined) {
                obj.intensity = baseLightIntensities[obj.uuid] * factor;
            }
        });
        
        // Apply fog
        if (scene.fog) {
            scene.fog.density = fogDensity;
        }
    }
}

window.updateDayNightCycle = updateDayNightCycle;

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════
connectWS();
animate();

// Load persisted settings after scene is ready
setTimeout(() => {
    captureBaseLights();
    loadSettings();
    loadThemeSettings(); // Load theme settings
    // Apply default brightness from slider if no saved settings
    const bSlider = document.getElementById('brightness-slider');
    if (bSlider) setBrightness(bSlider.value);
    const fSlider = document.getElementById('fog-slider');
    if (fSlider) setFogDensity(fSlider.value);
}, 500);

// Update sparkline every second
setInterval(updateActivitySparkline, 1000);
