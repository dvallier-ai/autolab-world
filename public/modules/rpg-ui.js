// ═══════════════════════════════════════════════════════════════
// rpg-ui.js — RPG System UI Components
// ═══════════════════════════════════════════════════════════════
// Displays levels, XP, stats, achievements in AutoLab 3D world
// ═══════════════════════════════════════════════════════════════

import * as THREE from 'three';

let rpgStats = {};
let scene = null;
let characters = {};

export function initRPG(sceneRef, charactersRef) {
    scene = sceneRef;
    if (charactersRef) characters = charactersRef; // Only set if provided
    loadRPGStats();
}

async function loadRPGStats() {
    try {
        const res = await fetch('/api/rpg/stats');
        rpgStats = await res.json();
        console.log('[RPG] Stats loaded:', rpgStats);
        updateAllAgentBadges();
    } catch (e) {
        console.error('[RPG] Failed to load stats:', e);
    }
}

export function handleRPGUpdate(data) {
    console.log('[RPG] Update received:', data);
    
    if (data.type === 'xp') {
        showXPGain(data.agentId, data.result);
        updateAgentBadge(data.agentId);
        
        if (data.result.leveledUp) {
            showLevelUp(data.agentId, data.result.level);
        }
    } else if (data.type === 'achievement') {
        showAchievement(data.agentId, data.result.achievement);
    }
    
    // Reload stats
    loadRPGStats();
}

function updateAllAgentBadges() {
    if (!rpgStats || !rpgStats.agents) return;
    
    for (const agentId in rpgStats.agents) {
        updateAgentBadge(agentId);
    }
}

function updateAgentBadge(agentId) {
    const character = characters[agentId];
    if (!character) return;
    
    const stats = rpgStats.agents?.[agentId];
    if (!stats) return;
    
    // Remove old badge if exists
    const oldBadge = character.getObjectByName('rpg-badge');
    if (oldBadge) character.remove(oldBadge);
    
    // Create level badge
    const badge = createLevelBadge(stats.level);
    badge.name = 'rpg-badge';
    badge.position.set(0, 1.2, 0); // Above character head
    character.add(badge);
    
    // Add progress bar
    updateProgressBar(character, stats);
}

function createLevelBadge(level) {
    const group = new THREE.Group();
    
    // Background circle
    const bgGeo = new THREE.CircleGeometry(0.15, 16);
    const bgMat = new THREE.MeshBasicMaterial({
        color: getLevelColor(level),
        transparent: true,
        opacity: 0.9
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    group.add(bg);
    
    // Glow ring
    const ringGeo = new THREE.RingGeometry(0.15, 0.18, 16);
    const ringMat = new THREE.MeshBasicMaterial({
        color: getLevelColor(level),
        transparent: true,
        opacity: 0.5
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    group.add(ring);
    
    // Level number text (sprite)
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(level.toString(), 32, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.25, 0.25, 1);
    group.add(sprite);
    
    // Make badge face camera
    group.renderOrder = 999;
    
    return group;
}

function getLevelColor(level) {
    if (level < 10) return 0x4a9eff; // Blue
    if (level < 20) return 0x4ade80; // Green
    if (level < 30) return 0xffa54a; // Orange
    if (level < 50) return 0xff4444; // Red
    return 0xffaa4a; // Gold
}

function updateProgressBar(character, stats) {
    // Remove old progress bar
    const oldBar = character.getObjectByName('xp-bar');
    if (oldBar) character.remove(oldBar);
    
    const progress = stats.xp / stats.xpToNext;
    const barGroup = new THREE.Group();
    barGroup.name = 'xp-bar';
    barGroup.position.set(0, 1.0, 0);
    
    // Background
    const bgGeo = new THREE.PlaneGeometry(0.6, 0.04);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.8 });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    barGroup.add(bg);
    
    // Progress fill
    const fillGeo = new THREE.PlaneGeometry(0.6 * progress, 0.04);
    const fillMat = new THREE.MeshBasicMaterial({ color: getLevelColor(stats.level) });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.x = -0.3 + (0.3 * progress);
    fill.position.z = 0.001;
    barGroup.add(fill);
    
    character.add(barGroup);
}

function showXPGain(agentId, result) {
    const character = characters[agentId];
    if (!character) return;
    
    // Create floating text
    const text = createFloatingText(`+${result.xpGained} XP`, 0x4aff6b);
    text.position.copy(character.position);
    text.position.y += 1.5;
    scene.add(text);
    
    // Animate upward and fade
    let alpha = 1.0;
    const animate = () => {
        text.position.y += 0.01;
        alpha -= 0.02;
        text.material.opacity = alpha;
        
        if (alpha > 0) {
            requestAnimationFrame(animate);
        } else {
            scene.remove(text);
        }
    };
    animate();
}

function showLevelUp(agentId, level) {
    const character = characters[agentId];
    if (!character) return;
    
    // Create level up text
    const text = createFloatingText(`LEVEL ${level}!`, 0xffaa4a, 48);
    text.position.copy(character.position);
    text.position.y += 2.0;
    scene.add(text);
    
    // Create particle burst
    createLevelUpParticles(character.position);
    
    // Animate
    let alpha = 1.0;
    let scale = 0.5;
    const animate = () => {
        text.position.y += 0.02;
        scale = Math.min(scale + 0.05, 1.5);
        text.scale.set(scale, scale, scale);
        alpha -= 0.01;
        text.material.opacity = alpha;
        
        if (alpha > 0) {
            requestAnimationFrame(animate);
        } else {
            scene.remove(text);
        }
    };
    animate();
    
    console.log(`[RPG] 🎉 ${agentId} reached level ${level}!`);
}

function showAchievement(agentId, achievement) {
    const character = characters[agentId];
    if (!character) return;
    
    // Create achievement notification
    const text = createFloatingText(`${achievement.icon} ${achievement.name}`, 0xffd700, 32);
    text.position.copy(character.position);
    text.position.y += 2.5;
    scene.add(text);
    
    // Animate
    let alpha = 1.0;
    let time = 0;
    const animate = () => {
        time += 0.05;
        text.position.y += Math.sin(time) * 0.005;
        alpha -= 0.005;
        text.material.opacity = alpha;
        
        if (alpha > 0) {
            requestAnimationFrame(animate);
        } else {
            scene.remove(text);
        }
    };
    animate();
    
    console.log(`[RPG] 🏆 ${agentId} earned: ${achievement.name}`);
}

function createFloatingText(text, color, size = 32) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.font = `bold ${size}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2, 0.5, 1);
    sprite.renderOrder = 1000;
    
    return sprite;
}

function createLevelUpParticles(position) {
    const particleCount = 30;
    const particles = new THREE.Group();
    
    for (let i = 0; i < particleCount; i++) {
        const geo = new THREE.SphereGeometry(0.05, 4, 4);
        const mat = new THREE.MeshBasicMaterial({
            color: Math.random() > 0.5 ? 0xffaa4a : 0x4aff6b,
            transparent: true
        });
        const particle = new THREE.Mesh(geo, mat);
        
        particle.position.copy(position);
        particle.userData.velocity = {
            x: (Math.random() - 0.5) * 0.1,
            y: Math.random() * 0.15 + 0.05,
            z: (Math.random() - 0.5) * 0.1
        };
        
        particles.add(particle);
    }
    
    scene.add(particles);
    
    // Animate particles
    let alpha = 1.0;
    const animate = () => {
        particles.children.forEach(p => {
            p.position.x += p.userData.velocity.x;
            p.position.y += p.userData.velocity.y;
            p.position.z += p.userData.velocity.z;
            p.userData.velocity.y -= 0.003; // Gravity
            p.material.opacity = alpha;
        });
        
        alpha -= 0.02;
        
        if (alpha > 0) {
            requestAnimationFrame(animate);
        } else {
            scene.remove(particles);
        }
    };
    animate();
}

export function getAgentLevel(agentId) {
    return rpgStats.agents?.[agentId]?.level || 1;
}

export function getAgentStats(agentId) {
    return rpgStats.agents?.[agentId] || null;
}
