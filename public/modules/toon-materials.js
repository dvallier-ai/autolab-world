// ═══════════════════════════════════════════════════════════════
// toon-materials.js — Cartoon/Toon Shading Materials
// ═══════════════════════════════════════════════════════════════
// Replaces standard materials with cel-shaded, cartoon-style look
// ═══════════════════════════════════════════════════════════════

import * as THREE from 'three';

// Cartoon color palette (brighter, more saturated)
export const CARTOON_COLORS = {
    // Agent colors (vibrant versions)
    nova: 0x5FB3FF,      // Bright cyan-blue
    liam: 0xFF6B9D,      // Bright pink
    paradox: 0xFFD93D,   // Sunny yellow
    cipher: 0xA8E6CF,    // Mint green
    
    // Environment
    floor: 0x8B9DC3,     // Soft blue-purple
    wall: 0xF7CAC9,      // Peachy pink
    accent: 0x6FFFE9,    // Bright cyan
    furniture: 0xFFAA64, // Warm orange
    
    // UI
    glow: 0xFFEB99,      // Soft yellow glow
    success: 0x6BCF7F,   // Happy green
    warning: 0xFFB347,   // Friendly orange
    error: 0xFF6B6B,     // Soft red
};

// Toon gradient texture (for cel shading)
function createToonGradient() {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    
    // 2-tone shading (light and shadow)
    ctx.fillStyle = '#444444';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(1, 0, 1, 1);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    
    return texture;
}

const toonGradient = createToonGradient();

// Create toon material (cel-shaded)
export function createToonMaterial(color, options = {}) {
    return new THREE.MeshToonMaterial({
        color: color,
        gradientMap: toonGradient,
        emissive: options.emissive || 0x000000,
        emissiveIntensity: options.emissiveIntensity || 0,
        ...options
    });
}

// Create outline material (black stroke effect)
export function createOutlineMaterial(thickness = 0.02) {
    return new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.BackSide
    });
}

// Apply cartoon style to existing mesh (replaces material + adds outline)
export function makeCartoon(mesh, color, outlineThickness = 0.02) {
    // Replace material with toon material
    if (mesh.material) {
        mesh.material.dispose();
        mesh.material = createToonMaterial(color);
    }
    
    // Add outline (inverted hull technique)
    if (outlineThickness > 0 && mesh.geometry) {
        const outlineGeo = mesh.geometry.clone();
        const outlineMesh = new THREE.Mesh(outlineGeo, createOutlineMaterial(outlineThickness));
        outlineMesh.scale.multiplyScalar(1 + outlineThickness);
        outlineMesh.renderOrder = mesh.renderOrder - 1;
        mesh.add(outlineMesh);
    }
}

// Simplified geometry helpers (rounder, simpler shapes)
export function createCartoonBox(width, height, depth, color) {
    // Rounded box (use more segments for smooth corners)
    const geo = new THREE.BoxGeometry(width, height, depth, 2, 2, 2);
    const mat = createToonMaterial(color);
    const mesh = new THREE.Mesh(geo, mat);
    makeCartoon(mesh, color, 0.01);
    return mesh;
}

export function createCartoonSphere(radius, color) {
    const geo = new THREE.SphereGeometry(radius, 16, 12); // Lower poly for cartoon look
    const mat = createToonMaterial(color);
    const mesh = new THREE.Mesh(geo, mat);
    makeCartoon(mesh, color, 0.01);
    return mesh;
}

export function createCartoonCylinder(radius, height, color) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, 12); // 12 sides
    const mat = createToonMaterial(color);
    const mesh = new THREE.Mesh(geo, mat);
    makeCartoon(mesh, color, 0.01);
    return mesh;
}

export function createCartoonCapsule(radius, height, color) {
    const group = new THREE.Group();
    
    // Cylinder body
    const body = createCartoonCylinder(radius, height - radius * 2, color);
    body.position.y = 0;
    group.add(body);
    
    // Top hemisphere
    const topGeo = new THREE.SphereGeometry(radius, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const topMat = createToonMaterial(color);
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = (height - radius * 2) / 2;
    group.add(top);
    
    // Bottom hemisphere
    const bottomGeo = new THREE.SphereGeometry(radius, 16, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const bottom = new THREE.Mesh(bottomGeo, topMat);
    bottom.position.y = -(height - radius * 2) / 2;
    group.add(bottom);
    
    return group;
}

// Wobbly animation helper (cartoon squash/stretch)
export function addWobble(mesh, intensity = 0.05, speed = 1.0) {
    mesh.userData.wobble = {
        intensity,
        speed,
        time: Math.random() * Math.PI * 2
    };
}

// Update wobble animations (call in animation loop)
export function updateWobbles(delta) {
    // This will be called from the main animation loop
    // Meshes with userData.wobble will squash/stretch slightly
}

// Cartoon lighting setup (bright, soft shadows)
export function createCartoonLights(scene) {
    // Remove existing lights
    scene.children.filter(c => c.isLight).forEach(light => scene.remove(light));
    
    // Bright ambient light (cartoon worlds are well-lit)
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    
    // Soft directional light (sun)
    const sun = new THREE.DirectionalLight(0xffffee, 0.8);
    sun.position.set(5, 10, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 50;
    sun.shadow.camera.left = -15;
    sun.shadow.camera.right = 15;
    sun.shadow.camera.top = 15;
    sun.shadow.camera.bottom = -15;
    sun.shadow.bias = -0.001;
    scene.add(sun);
    
    // Soft fill light (reduces harsh shadows)
    const fill = new THREE.DirectionalLight(0xaaccff, 0.3);
    fill.position.set(-5, 3, -5);
    scene.add(fill);
    
    // Warm back light (rim lighting)
    const rim = new THREE.DirectionalLight(0xffddaa, 0.4);
    rim.position.set(0, 2, -8);
    scene.add(rim);
    
    return { ambient, sun, fill, rim };
}

// Convert existing scene to cartoon style
export function cartoonifyScene(scene) {
    console.log('[Cartoon] Converting scene to cartoon style...');
    
    scene.traverse((obj) => {
        if (obj.isMesh && obj.material) {
            // Skip some objects (text sprites, special effects)
            if (obj.isSprite || obj.name.includes('text') || obj.name.includes('particle')) {
                return;
            }
            
            // Get current color
            const currentColor = obj.material.color ? obj.material.color.getHex() : 0xcccccc;
            
            // Replace with toon material
            makeCartoon(obj, currentColor, 0.01);
        }
    });
    
    // Update lighting
    createCartoonLights(scene);
    
    console.log('[Cartoon] Scene conversion complete!');
}
