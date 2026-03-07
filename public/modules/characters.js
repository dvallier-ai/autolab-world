// ═══════════════════════════════════════════════════════════════
// characters.js — Agent Avatar System
// ═══════════════════════════════════════════════════════════════
// Holographic humanoid figures with agent-colored accents.
// Built from primitives (no GLTF needed). Stylized and expressive.
// ═══════════════════════════════════════════════════════════════

import * as THREE from 'three';
// ── Character presets ─────────────────────────────────────────
// Each preset defines body proportions and style
const CHARACTER_PRESETS = {
    'holo-standard': {
        name: 'Holographic',
        icon: '👤',
        headRadius: 0.18,
        bodyHeight: 0.5,
        bodyWidth: 0.3,
        legLength: 0.4,
        armLength: 0.35,
        style: 'holographic',
    },
    'holo-slim': {
        name: 'Slim Holo',
        icon: '🧬',
        headRadius: 0.16,
        bodyHeight: 0.55,
        bodyWidth: 0.25,
        legLength: 0.45,
        armLength: 0.38,
        style: 'holographic',
    },
    'robot': {
        name: 'Android',
        icon: '🤖',
        headRadius: 0.17,
        bodyHeight: 0.45,
        bodyWidth: 0.35,
        legLength: 0.38,
        armLength: 0.3,
        style: 'solid',
    },
    'mech': {
        name: 'Mech Unit',
        icon: '⚙️',
        headRadius: 0.14,
        bodyHeight: 0.55,
        bodyWidth: 0.42,
        legLength: 0.35,
        armLength: 0.35,
        style: 'solid',
    },
    'alien': {
        name: 'Xenoform',
        icon: '👽',
        headRadius: 0.22,
        bodyHeight: 0.45,
        bodyWidth: 0.22,
        legLength: 0.5,
        armLength: 0.45,
        style: 'holographic',
    },
    'orb': {
        name: 'Sentinel Orb',
        icon: '🔮',
        headRadius: 0.3,
        bodyHeight: 0.2,
        bodyWidth: 0.2,
        legLength: 0.2,
        armLength: 0.2,
        style: 'holographic',
    },
    'ghost': {
        name: 'Phantom',
        icon: '👻',
        headRadius: 0.2,
        bodyHeight: 0.6,
        bodyWidth: 0.28,
        legLength: 0.3,
        armLength: 0.4,
        style: 'holographic',
    },
    'tank': {
        name: 'Heavy Frame',
        icon: '🛡️',
        headRadius: 0.15,
        bodyHeight: 0.5,
        bodyWidth: 0.45,
        legLength: 0.35,
        armLength: 0.32,
        style: 'solid',
    },
    'human': {
        name: 'Human',
        icon: '🧑',
        headRadius: 0.17,
        bodyHeight: 0.48,
        bodyWidth: 0.3,
        legLength: 0.42,
        armLength: 0.36,
        style: 'solid',
    },
};

export function getCharacterPresets() {
    return CHARACTER_PRESETS;
}

// ── Holographic shader material ───────────────────────────────
function createHoloMaterial(color) {
    return new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uTime: { value: 0 },
            uOpacity: { value: 0.6 },
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);
                vPosition = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vPosition;
            
            void main() {
                // Fresnel edge glow
                vec3 viewDir = normalize(cameraPosition - vPosition);
                float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.0);
                
                // Scan lines
                float scanLine = sin(vPosition.y * 40.0 + uTime * 2.0) * 0.5 + 0.5;
                scanLine = smoothstep(0.3, 0.7, scanLine);
                
                // Holographic flicker
                float flicker = 0.95 + sin(uTime * 8.0) * 0.03 + sin(uTime * 13.0) * 0.02;
                
                // Combine
                vec3 color = uColor * (0.6 + fresnel * 0.8);
                float alpha = (0.3 + fresnel * 0.5 + scanLine * 0.1) * uOpacity * flicker;
                
                gl_FragColor = vec4(color, alpha);
            }
        `
    });
}

// ── Create character mesh ─────────────────────────────────────
export function createCharacter(agentColor, preset = 'holo-standard') {
    const config = CHARACTER_PRESETS[preset] || CHARACTER_PRESETS['holo-standard'];
    const group = new THREE.Group();
    const color = typeof agentColor === 'string' ? agentColor : '#4a9eff';
    const colorInt = parseInt(color.replace('#', ''), 16);
    
    const isHolo = config.style === 'holographic';
    
    function makeMaterial() {
        if (isHolo) {
            return createHoloMaterial(color);
        }
        return new THREE.MeshPhysicalMaterial({
            color: 0x222233,
            emissive: colorInt,
            emissiveIntensity: 0.15,
            metalness: 0.9,
            roughness: 0.2,
            transparent: true,
            opacity: 0.9,
        });
    }
    
    function makeAccentMat() {
        return new THREE.MeshBasicMaterial({
            color: colorInt,
            transparent: true,
            opacity: isHolo ? 0.7 : 0.9,
        });
    }
    
    const mat = makeMaterial();
    const accentMat = makeAccentMat();
    
    // Shared parts that all types get
    let head, visor, torso, leftArm, rightArm, leftLeg, rightLeg, core, coreLight, glowDisc;
    let torsoY, headY;
    
    // ══════════════════════════════════════════════════════════
    // TYPE-SPECIFIC BUILDERS
    // ══════════════════════════════════════════════════════════
    
    if (preset === 'orb') {
        // ── SENTINEL ORB: floating sphere with ring ──
        torsoY = 0.6;
        headY = 0.6;
        
        // Main orb body
        head = new THREE.Mesh(
            new THREE.SphereGeometry(0.28, 24, 16),
            mat.clone()
        );
        head.position.y = headY;
        group.add(head);
        
        // Glowing eye
        visor = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 12, 12),
            accentMat.clone()
        );
        visor.position.set(0, headY + 0.05, 0.22);
        if (window._enableBloom) window._enableBloom(visor);
        group.add(visor);
        
        // Orbiting ring
        torso = new THREE.Mesh(
            new THREE.TorusGeometry(0.38, 0.02, 8, 32),
            accentMat.clone()
        );
        torso.position.y = headY;
        torso.rotation.x = Math.PI / 2;
        if (window._enableBloom) window._enableBloom(torso);
        group.add(torso);
        
        // Small floating bits (no legs/arms)
        leftArm = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), accentMat.clone());
        leftArm.position.set(-0.4, headY + 0.1, 0);
        if (window._enableBloom) window._enableBloom(leftArm);
        group.add(leftArm);
        
        rightArm = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), accentMat.clone());
        rightArm.position.set(0.4, headY - 0.1, 0);
        if (window._enableBloom) window._enableBloom(rightArm);
        group.add(rightArm);
        
        leftLeg = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), accentMat.clone());
        leftLeg.position.set(-0.15, 0.25, 0);
        group.add(leftLeg);
        
        rightLeg = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), accentMat.clone());
        rightLeg.position.set(0.15, 0.25, 0);
        group.add(rightLeg);
        
    } else if (preset === 'alien') {
        // ── XENOFORM: huge head, thin body, long limbs ──
        torsoY = config.legLength + config.bodyHeight / 2;
        headY = config.legLength + config.bodyHeight + config.headRadius + 0.05;
        
        // Elongated head
        head = new THREE.Mesh(
            new THREE.SphereGeometry(config.headRadius, 16, 12),
            mat.clone()
        );
        head.scale.set(1, 1.4, 1.1);
        head.position.y = headY;
        group.add(head);
        
        // Big eyes (two separate glowing orbs)
        visor = new THREE.Group();
        const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), accentMat.clone());
        leftEye.position.set(-0.08, 0, 0.15);
        if (window._enableBloom) window._enableBloom(leftEye);
        visor.add(leftEye);
        const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), accentMat.clone());
        rightEye.position.set(0.08, 0, 0.15);
        if (window._enableBloom) window._enableBloom(rightEye);
        visor.add(rightEye);
        visor.position.set(0, headY + 0.02, 0);
        group.add(visor);
        
        // Thin torso
        torso = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.12, config.bodyHeight, 8),
            mat.clone()
        );
        torso.position.y = torsoY;
        group.add(torso);
        
        // Long thin arms
        leftArm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.03, 0.02, config.armLength, 6),
            mat.clone()
        );
        leftArm.position.set(-0.18, torsoY - 0.05, 0);
        group.add(leftArm);
        
        rightArm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.03, 0.02, config.armLength, 6),
            mat.clone()
        );
        rightArm.position.set(0.18, torsoY - 0.05, 0);
        group.add(rightArm);
        
        // Long thin legs
        leftLeg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.03, config.legLength, 6),
            mat.clone()
        );
        leftLeg.position.set(-0.06, config.legLength / 2, 0);
        group.add(leftLeg);
        
        rightLeg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.03, config.legLength, 6),
            mat.clone()
        );
        rightLeg.position.set(0.06, config.legLength / 2, 0);
        group.add(rightLeg);

    } else if (preset === 'mech') {
        // ── MECH UNIT: boxy, bulky, shoulder pads, antenna ──
        torsoY = config.legLength + config.bodyHeight / 2;
        headY = config.legLength + config.bodyHeight + config.headRadius + 0.05;
        
        // Square head
        head = new THREE.Mesh(
            new THREE.BoxGeometry(0.22, 0.18, 0.2),
            mat.clone()
        );
        head.position.y = headY;
        group.add(head);
        
        // Visor slit
        visor = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.04, 0.05),
            accentMat.clone()
        );
        visor.position.set(0, headY + 0.02, 0.11);
        if (window._enableBloom) window._enableBloom(visor);
        group.add(visor);
        
        // Antenna
        const antenna = new THREE.Mesh(
            new THREE.CylinderGeometry(0.01, 0.01, 0.15, 6),
            accentMat.clone()
        );
        antenna.position.set(0.08, headY + 0.16, 0);
        if (window._enableBloom) window._enableBloom(antenna);
        group.add(antenna);
        
        // Wide torso
        torso = new THREE.Mesh(
            new THREE.BoxGeometry(config.bodyWidth, config.bodyHeight, config.bodyWidth * 0.7),
            mat.clone()
        );
        torso.position.y = torsoY;
        group.add(torso);
        
        // Shoulder pads
        const shoulderL = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.08, 0.18),
            mat.clone()
        );
        shoulderL.position.set(-config.bodyWidth / 2 - 0.04, torsoY + config.bodyHeight * 0.35, 0);
        group.add(shoulderL);
        const shoulderR = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.08, 0.18),
            mat.clone()
        );
        shoulderR.position.set(config.bodyWidth / 2 + 0.04, torsoY + config.bodyHeight * 0.35, 0);
        group.add(shoulderR);
        
        // Thick arms
        leftArm = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, config.armLength, 0.12),
            mat.clone()
        );
        leftArm.position.set(-(config.bodyWidth / 2 + 0.08), torsoY - 0.1, 0);
        group.add(leftArm);
        
        rightArm = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, config.armLength, 0.12),
            mat.clone()
        );
        rightArm.position.set(config.bodyWidth / 2 + 0.08, torsoY - 0.1, 0);
        group.add(rightArm);
        
        // Thick legs
        leftLeg = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, config.legLength, 0.14),
            mat.clone()
        );
        leftLeg.position.set(-0.1, config.legLength / 2, 0);
        group.add(leftLeg);
        
        rightLeg = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, config.legLength, 0.14),
            mat.clone()
        );
        rightLeg.position.set(0.1, config.legLength / 2, 0);
        group.add(rightLeg);

    } else if (preset === 'ghost') {
        // ── PHANTOM: floaty, no legs, trailing wisps ──
        torsoY = 0.5;
        headY = 0.95;
        
        // Round head
        head = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 16, 12),
            mat.clone()
        );
        head.position.y = headY;
        group.add(head);
        
        // Glowing eyes
        visor = new THREE.Group();
        const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), accentMat.clone());
        eye1.position.set(-0.07, 0, 0.16);
        if (window._enableBloom) window._enableBloom(eye1);
        visor.add(eye1);
        const eye2 = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), accentMat.clone());
        eye2.position.set(0.07, 0, 0.16);
        if (window._enableBloom) window._enableBloom(eye2);
        visor.add(eye2);
        visor.position.set(0, headY, 0);
        group.add(visor);
        
        // Flowing body (cone shape, no distinct torso/legs)
        torso = new THREE.Mesh(
            new THREE.ConeGeometry(0.25, 0.7, 12, 1, true),
            mat.clone()
        );
        torso.position.y = torsoY;
        group.add(torso);
        
        // Wispy arms
        leftArm = new THREE.Mesh(
            new THREE.ConeGeometry(0.04, 0.35, 6),
            mat.clone()
        );
        leftArm.position.set(-0.25, 0.55, 0);
        leftArm.rotation.z = 0.3;
        group.add(leftArm);
        
        rightArm = new THREE.Mesh(
            new THREE.ConeGeometry(0.04, 0.35, 6),
            mat.clone()
        );
        rightArm.position.set(0.25, 0.55, 0);
        rightArm.rotation.z = -0.3;
        group.add(rightArm);
        
        // No real legs — trailing wisps
        leftLeg = new THREE.Mesh(
            new THREE.ConeGeometry(0.03, 0.2, 6),
            mat.clone()
        );
        leftLeg.position.set(-0.08, 0.1, 0);
        group.add(leftLeg);
        
        rightLeg = new THREE.Mesh(
            new THREE.ConeGeometry(0.03, 0.2, 6),
            mat.clone()
        );
        rightLeg.position.set(0.08, 0.1, 0);
        group.add(rightLeg);

    } else if (preset === 'tank') {
        // ── HEAVY FRAME: armored, wide, shield plate ──
        torsoY = config.legLength + config.bodyHeight / 2;
        headY = config.legLength + config.bodyHeight + config.headRadius + 0.05;
        
        // Helmet head
        head = new THREE.Mesh(
            new THREE.SphereGeometry(config.headRadius, 16, 12),
            mat.clone()
        );
        head.scale.set(1, 0.85, 1);
        head.position.y = headY;
        group.add(head);
        
        // T-visor
        visor = new THREE.Group();
        const vHoriz = new THREE.Mesh(
            new THREE.BoxGeometry(config.headRadius * 1.8, 0.03, 0.04),
            accentMat.clone()
        );
        vHoriz.position.set(0, 0.02, config.headRadius * 0.65);
        if (window._enableBloom) window._enableBloom(vHoriz);
        visor.add(vHoriz);
        const vVert = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.08, 0.04),
            accentMat.clone()
        );
        vVert.position.set(0, -0.02, config.headRadius * 0.65);
        if (window._enableBloom) window._enableBloom(vVert);
        visor.add(vVert);
        visor.position.set(0, headY, 0);
        group.add(visor);
        
        // Thick armor torso
        torso = new THREE.Mesh(
            new THREE.BoxGeometry(config.bodyWidth, config.bodyHeight, config.bodyWidth * 0.7),
            mat.clone()
        );
        torso.position.y = torsoY;
        group.add(torso);
        
        // Front chest plate
        const plate = new THREE.Mesh(
            new THREE.BoxGeometry(config.bodyWidth * 0.8, config.bodyHeight * 0.6, 0.05),
            accentMat.clone()
        );
        plate.position.set(0, torsoY + 0.03, config.bodyWidth * 0.38);
        if (window._enableBloom) window._enableBloom(plate);
        group.add(plate);
        
        // Heavy arms
        leftArm = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, config.armLength, 0.12),
            mat.clone()
        );
        leftArm.position.set(-(config.bodyWidth / 2 + 0.1), torsoY - 0.05, 0);
        group.add(leftArm);
        
        rightArm = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, config.armLength, 0.12),
            mat.clone()
        );
        rightArm.position.set(config.bodyWidth / 2 + 0.1, torsoY - 0.05, 0);
        group.add(rightArm);
        
        // Stocky legs
        leftLeg = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, config.legLength, 0.14),
            mat.clone()
        );
        leftLeg.position.set(-0.1, config.legLength / 2, 0);
        group.add(leftLeg);
        
        rightLeg = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, config.legLength, 0.14),
            mat.clone()
        );
        rightLeg.position.set(0.1, config.legLength / 2, 0);
        group.add(rightLeg);

    } else if (preset === 'human') {
        // ── HUMAN: rounded, warm, skin-toned with clothes ──
        torsoY = config.legLength + config.bodyHeight / 2;
        headY = config.legLength + config.bodyHeight + config.headRadius + 0.05;
        
        // Smooth round head (skin tone)
        const skinMat = new THREE.MeshPhysicalMaterial({
            color: 0xd4a574,
            emissive: colorInt,
            emissiveIntensity: 0.05,
            roughness: 0.7,
            metalness: 0.0,
        });
        
        head = new THREE.Mesh(
            new THREE.SphereGeometry(config.headRadius, 20, 16),
            skinMat.clone()
        );
        head.position.y = headY;
        group.add(head);
        
        // Hair (half sphere on top)
        const hairMat = new THREE.MeshPhysicalMaterial({
            color: 0x2a1a0a,
            roughness: 0.8,
            metalness: 0.0,
        });
        const hair = new THREE.Mesh(
            new THREE.SphereGeometry(config.headRadius * 1.05, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            hairMat
        );
        hair.position.y = headY + 0.01;
        group.add(hair);
        
        // Eyes (simple colored dots) — visor slot
        visor = new THREE.Group();
        const leye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), accentMat.clone());
        leye.position.set(-0.055, 0, config.headRadius * 0.85);
        if (window._enableBloom) window._enableBloom(leye);
        visor.add(leye);
        const reye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), accentMat.clone());
        reye.position.set(0.055, 0, config.headRadius * 0.85);
        if (window._enableBloom) window._enableBloom(reye);
        visor.add(reye);
        visor.position.set(0, headY + 0.02, 0);
        group.add(visor);
        
        // Torso (rounded, clothed look)
        const clothMat = new THREE.MeshPhysicalMaterial({
            color: colorInt,
            emissive: colorInt,
            emissiveIntensity: 0.08,
            roughness: 0.6,
            metalness: 0.1,
        });
        
        torso = new THREE.Mesh(
            new THREE.CylinderGeometry(config.bodyWidth * 0.45, config.bodyWidth * 0.4, config.bodyHeight, 12),
            clothMat.clone()
        );
        torso.position.y = torsoY;
        group.add(torso);
        
        // Rounded arms (skin + sleeves)
        leftArm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.035, config.armLength, 8),
            skinMat.clone()
        );
        leftArm.position.set(-(config.bodyWidth / 2 + 0.04), torsoY - 0.05, 0);
        group.add(leftArm);
        
        rightArm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.035, config.armLength, 8),
            skinMat.clone()
        );
        rightArm.position.set(config.bodyWidth / 2 + 0.04, torsoY - 0.05, 0);
        group.add(rightArm);
        
        // Legs (pants)
        const pantsMat = new THREE.MeshPhysicalMaterial({
            color: 0x1a1a2e,
            roughness: 0.7,
            metalness: 0.0,
        });
        
        leftLeg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.045, config.legLength, 8),
            pantsMat.clone()
        );
        leftLeg.position.set(-0.07, config.legLength / 2, 0);
        group.add(leftLeg);
        
        rightLeg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.045, config.legLength, 8),
            pantsMat.clone()
        );
        rightLeg.position.set(0.07, config.legLength / 2, 0);
        group.add(rightLeg);

    } else {
        // ── DEFAULT HUMANOID (holo-standard, holo-slim, robot) ──
        torsoY = config.legLength + config.bodyHeight / 2;
        headY = config.legLength + config.bodyHeight + config.headRadius + 0.05;
        
        head = new THREE.Mesh(
            new THREE.SphereGeometry(config.headRadius, 16, 12),
            mat.clone()
        );
        head.position.y = headY;
        head.castShadow = true;
        group.add(head);
        
        // Face visor
        const visorGeo = new THREE.BoxGeometry(
            config.headRadius * 1.6,
            config.headRadius * 0.3,
            config.headRadius * 0.5
        );
        visor = new THREE.Mesh(visorGeo, accentMat.clone());
        visor.position.set(0, headY + 0.02, config.headRadius * 0.6);
        if (window._enableBloom) window._enableBloom(visor);
        group.add(visor);
        
        // Torso
        torso = new THREE.Mesh(
            new THREE.BoxGeometry(config.bodyWidth, config.bodyHeight, config.bodyWidth * 0.6),
            mat.clone()
        );
        torso.position.y = torsoY;
        torso.castShadow = true;
        group.add(torso);
        
        // Arms
        const armGeo = new THREE.BoxGeometry(0.08, config.armLength, 0.08);
        
        leftArm = new THREE.Mesh(armGeo, mat.clone());
        leftArm.position.set(-(config.bodyWidth / 2 + 0.06), torsoY - 0.05, 0);
        group.add(leftArm);
        
        rightArm = new THREE.Mesh(armGeo, mat.clone());
        rightArm.position.set(config.bodyWidth / 2 + 0.06, torsoY - 0.05, 0);
        group.add(rightArm);
        
        // Legs
        const legGeo = new THREE.BoxGeometry(0.1, config.legLength, 0.1);
        
        leftLeg = new THREE.Mesh(legGeo, mat.clone());
        leftLeg.position.set(-0.08, config.legLength / 2, 0);
        group.add(leftLeg);
        
        rightLeg = new THREE.Mesh(legGeo, mat.clone());
        rightLeg.position.set(0.08, config.legLength / 2, 0);
        group.add(rightLeg);
    }
    
    // ── Core glow (chest accent) — all types ──
    if (!core) {
        const coreGeo = new THREE.SphereGeometry(0.05, 8, 8);
        const coreMat = new THREE.MeshBasicMaterial({
            color: colorInt,
            transparent: true,
            opacity: 0.9,
        });
        core = new THREE.Mesh(coreGeo, coreMat);
        core.position.set(0, (torsoY || 0.5) + 0.05, 0.15);
        if (window._enableBloom) window._enableBloom(core);
        group.add(core);
    }
    
    // ── Ground glow disc ──
    const glowGeo = new THREE.CircleGeometry(0.3, 32);
    const glowMat = new THREE.MeshBasicMaterial({
        color: colorInt,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
    });
    glowDisc = new THREE.Mesh(glowGeo, glowMat);
    glowDisc.rotation.x = -Math.PI / 2;
    glowDisc.position.y = 0.02;
    if (window._enableBloom) window._enableBloom(glowDisc);
    group.add(glowDisc);
    
    // Point light from core
    coreLight = new THREE.PointLight(colorInt, 0.5, 3);
    coreLight.position.set(0, torsoY || 0.5, 0);
    group.add(coreLight);
    
    // Store references for animation
    group.userData = {
        head,
        visor,
        torso,
        leftArm,
        rightArm,
        leftLeg,
        rightLeg,
        core,
        coreLight,
        glowDisc,
        config,
        isHolo,
        color,
        colorInt,
        // Animation state
        animState: 'idle', // idle, typing, thinking, talking
        animTime: 0,
    };
    
    return group;
}

// ── Animation update ──────────────────────────────────────────
export function updateCharacter(character, time, dt) {
    const ud = character.userData;
    ud.animTime += dt;
    const t = ud.animTime;
    
    // Update holographic shader time
    if (ud.isHolo) {
        character.traverse(child => {
            if (child.material?.uniforms?.uTime) {
                child.material.uniforms.uTime.value = time;
            }
        });
    }
    
    switch (ud.animState) {
        case 'typing':
            // Arms move up/down alternately (typing motion)
            ud.rightArm.rotation.x = -0.8 + Math.sin(t * 8) * 0.15;
            ud.leftArm.rotation.x = -0.8 + Math.sin(t * 8 + Math.PI) * 0.15;
            // Slight head bob
            ud.head.position.y = ud.config.legLength + ud.config.bodyHeight + ud.config.headRadius + 0.05 + Math.sin(t * 2) * 0.01;
            // Core pulses faster
            ud.core.material.opacity = 0.7 + Math.sin(t * 4) * 0.3;
            ud.coreLight.intensity = 0.5 + Math.sin(t * 4) * 0.3;
            break;
            
        case 'thinking':
            // One hand to chin, slight lean
            ud.rightArm.rotation.x = -1.2;
            ud.rightArm.rotation.z = 0.3;
            ud.leftArm.rotation.x = 0;
            ud.leftArm.rotation.z = 0;
            // Head tilts slightly
            ud.head.rotation.z = Math.sin(t * 0.5) * 0.08;
            ud.core.material.opacity = 0.5 + Math.sin(t * 1.5) * 0.3;
            break;
            
        case 'talking':
            // Gesturing with arms
            ud.rightArm.rotation.x = -0.3 + Math.sin(t * 3) * 0.2;
            ud.rightArm.rotation.z = Math.sin(t * 2) * 0.1;
            ud.leftArm.rotation.x = -0.3 + Math.sin(t * 3 + 1) * 0.15;
            // Head nods
            ud.head.rotation.x = Math.sin(t * 2.5) * 0.05;
            ud.core.material.opacity = 0.8;
            break;
            
        case 'idle':
        default:
            // Gentle breathing / floating
            const breathe = Math.sin(t * 1.2) * 0.015;
            ud.torso.position.y = ud.config.legLength + ud.config.bodyHeight / 2 + breathe;
            ud.head.position.y = ud.config.legLength + ud.config.bodyHeight + ud.config.headRadius + 0.05 + breathe;
            // Arms relax
            ud.rightArm.rotation.x = ud.rightArm.rotation.x * 0.95;
            ud.rightArm.rotation.z = ud.rightArm.rotation.z * 0.95;
            ud.leftArm.rotation.x = ud.leftArm.rotation.x * 0.95;
            ud.leftArm.rotation.z = ud.leftArm.rotation.z * 0.95;
            ud.head.rotation.z = ud.head.rotation.z * 0.95;
            ud.head.rotation.x = ud.head.rotation.x * 0.95;
            // Core gentle pulse
            ud.core.material.opacity = 0.6 + Math.sin(t * 1.5) * 0.2;
            ud.coreLight.intensity = 0.3 + Math.sin(t * 1.5) * 0.15;
            // Ground glow breathes
            ud.glowDisc.material.opacity = 0.1 + Math.sin(t * 1.2) * 0.05;
            break;
    }
}

// ── Set animation state ───────────────────────────────────────
export function setCharacterState(character, state) {
    if (character.userData.animState !== state) {
        character.userData.animState = state;
    }
}

// ── Available presets ─────────────────────────────────────────
export function getPresets() {
    return Object.entries(CHARACTER_PRESETS).map(([id, preset]) => ({
        id,
        name: preset.name,
    }));
}

// ══════════════════════════════════════════════════════════════
// OVERSEER — Dan's avatar (non-holographic, physical presence)
// ══════════════════════════════════════════════════════════════

// Waypoints the overseer walks between
const WAYPOINTS = [
    { x: -3, z: 3, pause: 3 },      // check on left agents
    { x: 0, z: 3.5, pause: 2 },     // stroll through center
    { x: 3, z: 3, pause: 3 },       // check on right agents
    { x: 5, z: -3, pause: 4 },      // inspect server racks
    { x: -6, z: 5, pause: 3 },      // chill on couch
    { x: 0, z: -4, pause: 2 },      // look at command screens
    { x: -7, z: 0, pause: 2 },      // check bookshelf
    { x: 7, z: 3, pause: 2 },       // grab something from fridge
];

export function createOverseer() {
    const group = new THREE.Group();
    
    // Slightly taller than the holo agents
    const config = {
        headRadius: 0.2,
        bodyHeight: 0.55,
        bodyWidth: 0.35,
        legLength: 0.45,
        armLength: 0.4,
    };
    
    // ── Physical materials (not holographic) ──────────────────
    // Dark hoodie / jacket vibe
    const skinMat = new THREE.MeshStandardMaterial({
        color: 0xd4a574, roughness: 0.8, metalness: 0.0,
    });
    const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e, roughness: 0.7, metalness: 0.1,  // dark hoodie
    });
    const pantsMat = new THREE.MeshStandardMaterial({
        color: 0x111118, roughness: 0.8, metalness: 0.05,  // dark pants
    });
    const shoeMat = new THREE.MeshStandardMaterial({
        color: 0x222233, roughness: 0.5, metalness: 0.3,
    });
    const accentMat = new THREE.MeshBasicMaterial({
        color: 0xff6b2b, transparent: true, opacity: 0.9,  // orange accent
    });
    
    // ── Head ──
    const head = new THREE.Mesh(new THREE.SphereGeometry(config.headRadius, 16, 12), skinMat);
    const headY = config.legLength + config.bodyHeight + config.headRadius + 0.05;
    head.position.y = headY;
    head.castShadow = true;
    group.add(head);
    
    // Hair (dark, slightly messy)
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x1a0a05, roughness: 0.9 });
    const hair = new THREE.Mesh(
        new THREE.SphereGeometry(config.headRadius * 1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6),
        hairMat
    );
    hair.position.y = headY + 0.02;
    group.add(hair);
    
    // Sunglasses / visor (cool orange tint)
    const glasses = new THREE.Mesh(
        new THREE.BoxGeometry(config.headRadius * 1.5, config.headRadius * 0.25, config.headRadius * 0.3),
        accentMat
    );
    glasses.position.set(0, headY + 0.02, config.headRadius * 0.65);
    group.add(glasses);
    
    // ── Torso (hoodie) ──
    const torso = new THREE.Mesh(
        new THREE.BoxGeometry(config.bodyWidth, config.bodyHeight, config.bodyWidth * 0.65),
        bodyMat
    );
    const torsoY = config.legLength + config.bodyHeight / 2;
    torso.position.y = torsoY;
    torso.castShadow = true;
    group.add(torso);
    
    // Hood detail (draped behind head)
    const hood = new THREE.Mesh(
        new THREE.BoxGeometry(config.bodyWidth * 0.8, 0.15, 0.12),
        bodyMat.clone()
    );
    hood.position.set(0, torsoY + config.bodyHeight / 2 + 0.05, -config.bodyWidth * 0.25);
    group.add(hood);
    
    // Orange stripe on hoodie
    const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, config.bodyHeight * 0.6, config.bodyWidth * 0.66),
        accentMat
    );
    stripe.position.set(0, torsoY, 0);
    group.add(stripe);
    
    // ── Arms (hoodie sleeves) ──
    const armGeo = new THREE.BoxGeometry(0.1, config.armLength, 0.1);
    
    const leftArm = new THREE.Mesh(armGeo, bodyMat.clone());
    leftArm.position.set(-(config.bodyWidth / 2 + 0.07), torsoY - 0.05, 0);
    group.add(leftArm);
    
    const rightArm = new THREE.Mesh(armGeo, bodyMat.clone());
    rightArm.position.set(config.bodyWidth / 2 + 0.07, torsoY - 0.05, 0);
    group.add(rightArm);
    
    // Hands (skin-colored)
    const handGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const leftHand = new THREE.Mesh(handGeo, skinMat.clone());
    leftHand.position.set(-(config.bodyWidth / 2 + 0.07), torsoY - config.armLength / 2 - 0.07, 0);
    group.add(leftHand);
    
    const rightHand = new THREE.Mesh(handGeo, skinMat.clone());
    rightHand.position.set(config.bodyWidth / 2 + 0.07, torsoY - config.armLength / 2 - 0.07, 0);
    group.add(rightHand);
    
    // ── Legs ──
    const legGeo = new THREE.BoxGeometry(0.12, config.legLength, 0.12);
    
    const leftLeg = new THREE.Mesh(legGeo, pantsMat);
    leftLeg.position.set(-0.09, config.legLength / 2, 0);
    group.add(leftLeg);
    
    const rightLeg = new THREE.Mesh(legGeo, pantsMat.clone());
    rightLeg.position.set(0.09, config.legLength / 2, 0);
    group.add(rightLeg);
    
    // Shoes
    const shoeGeo = new THREE.BoxGeometry(0.13, 0.06, 0.18);
    const leftShoe = new THREE.Mesh(shoeGeo, shoeMat);
    leftShoe.position.set(-0.09, 0.03, 0.03);
    group.add(leftShoe);
    
    const rightShoe = new THREE.Mesh(shoeGeo, shoeMat.clone());
    rightShoe.position.set(0.09, 0.03, 0.03);
    group.add(rightShoe);
    
    // ── Name tag floating above ──
    const nameCanvas = document.createElement('canvas');
    nameCanvas.width = 256;
    nameCanvas.height = 64;
    const nctx = nameCanvas.getContext('2d');
    nctx.font = 'bold 28px monospace';
    nctx.fillStyle = '#ff6b2b';
    nctx.textAlign = 'center';
    nctx.fillText('👑 Dan', 128, 40);
    const nameTex = new THREE.CanvasTexture(nameCanvas);
    const nameSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: nameTex, transparent: true, opacity: 0.9 })
    );
    nameSprite.scale.set(1.2, 0.3, 1);
    nameSprite.position.y = headY + config.headRadius + 0.35;
    group.add(nameSprite);
    
    // ── Shadow disc ──
    const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.25, 16),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);
    
    // Store for animation
    group.userData = {
        head, torso, leftArm, rightArm, leftHand, rightHand,
        leftLeg, rightLeg, leftShoe, rightShoe,
        nameSprite, shadow, config,
        // Movement state
        waypointIndex: 0,
        moveProgress: 0,       // 0-1 lerp between waypoints
        pauseTimer: 2,         // initial pause before first move
        state: 'paused',       // 'walking', 'paused'
        walkSpeed: 1.2,
        currentPos: { x: 0, z: 4 },  // start position
        targetPos: WAYPOINTS[0],
    };
    
    group.position.set(0, 0, 4);
    
    return group;
}

export function updateOverseer(overseer, time, dt) {
    const ud = overseer.userData;
    const t = time;
    
    if (ud.state === 'paused') {
        // Idle animation while paused
        const breathe = Math.sin(t * 1.5) * 0.01;
        ud.torso.position.y = ud.config.legLength + ud.config.bodyHeight / 2 + breathe;
        ud.head.position.y = ud.config.legLength + ud.config.bodyHeight + ud.config.headRadius + 0.05 + breathe;
        
        // Look around occasionally
        ud.head.rotation.y = Math.sin(t * 0.4) * 0.3;
        
        // Arms relaxed
        ud.leftArm.rotation.x *= 0.95;
        ud.rightArm.rotation.x *= 0.95;
        
        // Count down pause
        ud.pauseTimer -= dt;
        if (ud.pauseTimer <= 0) {
            // Pick next waypoint
            ud.waypointIndex = (ud.waypointIndex + 1) % WAYPOINTS.length;
            ud.targetPos = WAYPOINTS[ud.waypointIndex];
            ud.moveProgress = 0;
            ud.state = 'walking';
        }
    } else if (ud.state === 'walking') {
        // Calculate distance to target
        const dx = ud.targetPos.x - ud.currentPos.x;
        const dz = ud.targetPos.z - ud.currentPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist < 0.1) {
            // Arrived
            ud.currentPos.x = ud.targetPos.x;
            ud.currentPos.z = ud.targetPos.z;
            ud.state = 'paused';
            ud.pauseTimer = ud.targetPos.pause || 2;
        } else {
            // Move toward target
            const speed = ud.walkSpeed * dt;
            const nx = dx / dist;
            const nz = dz / dist;
            
            let newX = ud.currentPos.x + nx * speed;
            let newZ = ud.currentPos.z + nz * speed;
            
            ud.currentPos.x = newX;
            ud.currentPos.z = newZ;
            
            overseer.position.x = ud.currentPos.x;
            overseer.position.z = ud.currentPos.z;
            
            // Face direction of movement
            overseer.rotation.y = Math.atan2(nx, nz);
            
            // Walking animation
            const walkCycle = t * 6;
            ud.leftLeg.rotation.x = Math.sin(walkCycle) * 0.4;
            ud.rightLeg.rotation.x = Math.sin(walkCycle + Math.PI) * 0.4;
            ud.leftArm.rotation.x = Math.sin(walkCycle + Math.PI) * 0.3;
            ud.rightArm.rotation.x = Math.sin(walkCycle) * 0.3;
            
            // Subtle body bob
            const bob = Math.abs(Math.sin(walkCycle)) * 0.03;
            ud.torso.position.y = ud.config.legLength + ud.config.bodyHeight / 2 + bob;
            ud.head.position.y = ud.config.legLength + ud.config.bodyHeight + ud.config.headRadius + 0.05 + bob;
            
            // Head faces forward
            ud.head.rotation.y = 0;
        }
    }
    
    // Name tag bob
    ud.nameSprite.position.y = ud.config.legLength + ud.config.bodyHeight + ud.config.headRadius * 2 + 0.35 + Math.sin(t * 1.5) * 0.03;
}
