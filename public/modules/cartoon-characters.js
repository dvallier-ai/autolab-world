// ═══════════════════════════════════════════════════════════════
// cartoon-characters.js — Cartoon-Style Agent Characters
// ═══════════════════════════════════════════════════════════════
// Cute, rounded, expressive character models for agents
// ═══════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { createToonMaterial, createCartoonSphere, createCartoonCapsule, createCartoonBox, CARTOON_COLORS } from './toon-materials.js';

export function createCartoonAgent(config = {}) {
    const group = new THREE.Group();
    
    const color = config.color || CARTOON_COLORS.nova;
    const height = config.height || 1.4;
    const style = config.style || 'round'; // round, tall, chubby, robot
    
    // Body (rounded capsule)
    const bodyHeight = height * 0.5;
    const bodyRadius = height * 0.15;
    const body = createCartoonCapsule(bodyRadius, bodyHeight, color);
    body.position.y = bodyHeight / 2 + 0.2;
    group.add(body);
    
    // Head (sphere, slightly offset for cute look)
    const headRadius = height * 0.18;
    const headGeo = new THREE.SphereGeometry(headRadius, 16, 12);
    const headMat = createToonMaterial(color);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = bodyHeight + headRadius * 0.7 + 0.2;
    head.castShadow = true;
    group.add(head);
    
    // Eyes (simple black dots)
    const eyeGeo = new THREE.SphereGeometry(0.04, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.06, 0.05, headRadius * 0.8);
    head.add(leftEye);
    
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.06, 0.05, headRadius * 0.8);
    head.add(rightEye);
    
    // Eyebrows (optional, for expressiveness)
    const browGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.08, 6);
    const browMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    
    const leftBrow = new THREE.Mesh(browGeo, browMat);
    leftBrow.rotation.z = Math.PI / 6;
    leftBrow.position.set(-0.08, 0.12, headRadius * 0.75);
    head.add(leftBrow);
    
    const rightBrow = new THREE.Mesh(browGeo, browMat);
    rightBrow.rotation.z = -Math.PI / 6;
    rightBrow.position.set(0.08, 0.12, headRadius * 0.75);
    head.add(rightBrow);
    
    // Arms (simple cylinders)
    const armRadius = 0.04;
    const armLength = height * 0.3;
    const armGeo = new THREE.CylinderGeometry(armRadius, armRadius * 0.8, armLength, 8);
    const armMat = createToonMaterial(color);
    
    const leftArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.set(-bodyRadius - 0.03, bodyHeight * 0.6 + 0.2, 0);
    leftArm.rotation.z = Math.PI / 8;
    leftArm.castShadow = true;
    group.add(leftArm);
    
    const rightArm = new THREE.Mesh(armGeo, armMat);
    rightArm.position.set(bodyRadius + 0.03, bodyHeight * 0.6 + 0.2, 0);
    rightArm.rotation.z = -Math.PI / 8;
    rightArm.castShadow = true;
    group.add(rightArm);
    
    // Hands (small spheres)
    const handGeo = new THREE.SphereGeometry(0.05, 8, 6);
    const handMat = createToonMaterial(color);
    
    const leftHand = new THREE.Mesh(handGeo, handMat);
    leftHand.position.y = -armLength / 2;
    leftArm.add(leftHand);
    
    const rightHand = new THREE.Mesh(handGeo, handMat);
    rightHand.position.y = -armLength / 2;
    rightArm.add(rightHand);
    
    // Legs (short, stubby for cute look)
    const legRadius = 0.05;
    const legLength = height * 0.25;
    const legGeo = new THREE.CylinderGeometry(legRadius, legRadius * 1.1, legLength, 8);
    const legMat = createToonMaterial(color);
    
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-bodyRadius * 0.5, 0.2 - legLength / 2, 0);
    leftLeg.castShadow = true;
    group.add(leftLeg);
    
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(bodyRadius * 0.5, 0.2 - legLength / 2, 0);
    rightLeg.castShadow = true;
    group.add(rightLeg);
    
    // Feet (flat ovals)
    const footGeo = new THREE.SphereGeometry(0.06, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const footMat = createToonMaterial(color);
    
    const leftFoot = new THREE.Mesh(footGeo, footMat);
    leftFoot.position.set(0, -legLength / 2 - 0.03, 0.02);
    leftFoot.rotation.x = -Math.PI / 2;
    leftFoot.scale.set(1, 1.5, 0.5);
    leftLeg.add(leftFoot);
    
    const rightFoot = new THREE.Mesh(footGeo, footMat);
    rightFoot.position.set(0, -legLength / 2 - 0.03, 0.02);
    rightFoot.rotation.x = -Math.PI / 2;
    rightFoot.scale.set(1, 1.5, 0.5);
    rightLeg.add(rightFoot);
    
    // Add antenna (cute detail)
    const antennaGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 6);
    const antennaMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const antenna = new THREE.Mesh(antennaGeo, antennaMat);
    antenna.position.y = headRadius + 0.075;
    head.add(antenna);
    
    const antennaBall = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), createToonMaterial(0xFFFF00));
    antennaBall.position.y = 0.075;
    antenna.add(antennaBall);
    
    // Store references for animations
    group.userData.cartoonParts = {
        body,
        head,
        leftEye,
        rightEye,
        leftBrow,
        rightBrow,
        leftArm,
        rightArm,
        leftLeg,
        rightLeg,
        antenna,
        antennaBall
    };
    
    // Shadow
    group.traverse((obj) => {
        if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = false;
        }
    });
    
    return group;
}

// Cartoon animation states
export function setCartoonState(character, state) {
    const parts = character.userData.cartoonParts;
    if (!parts) return;
    
    switch (state) {
        case 'idle':
            // Gentle bob
            parts.body.position.y = Math.sin(Date.now() * 0.002) * 0.02 + 0.9;
            parts.head.rotation.x = Math.sin(Date.now() * 0.003) * 0.05;
            parts.antenna.rotation.z = Math.sin(Date.now() * 0.004) * 0.1;
            break;
            
        case 'typing':
            // Arms move like typing
            const typingTime = Date.now() * 0.01;
            parts.leftArm.rotation.x = Math.sin(typingTime) * 0.3;
            parts.rightArm.rotation.x = Math.sin(typingTime + Math.PI) * 0.3;
            parts.head.rotation.y = Math.sin(typingTime * 0.5) * 0.1;
            break;
            
        case 'thinking':
            // Tilt head, hand to chin
            parts.head.rotation.x = 0.2;
            parts.head.rotation.y = 0.3;
            parts.rightArm.rotation.x = -1.2;
            parts.rightArm.rotation.z = -0.5;
            parts.antennaBall.material.emissive.setHex(0x4aff6b);
            parts.antennaBall.material.emissiveIntensity = 0.5;
            break;
            
        case 'walking':
            // Leg swing
            const walkTime = Date.now() * 0.005;
            parts.leftLeg.rotation.x = Math.sin(walkTime) * 0.4;
            parts.rightLeg.rotation.x = Math.sin(walkTime + Math.PI) * 0.4;
            parts.leftArm.rotation.x = Math.sin(walkTime + Math.PI) * 0.3;
            parts.rightArm.rotation.x = Math.sin(walkTime) * 0.3;
            parts.body.position.y = Math.abs(Math.sin(walkTime * 2)) * 0.03 + 0.9;
            break;
            
        case 'excited':
            // Jump!
            parts.body.position.y = Math.abs(Math.sin(Date.now() * 0.008)) * 0.2 + 0.9;
            parts.leftArm.rotation.z = Math.PI / 3;
            parts.rightArm.rotation.z = -Math.PI / 3;
            parts.antenna.rotation.z = Math.sin(Date.now() * 0.01) * 0.3;
            parts.antennaBall.material.emissive.setHex(0xFFFF00);
            parts.antennaBall.material.emissiveIntensity = 1.0;
            break;
    }
}

// Expressions (change eye/brow positions)
export function setCartoonExpression(character, expression) {
    const parts = character.userData.cartoonParts;
    if (!parts) return;
    
    switch (expression) {
        case 'happy':
            parts.leftEye.scale.y = 0.5; // Squint
            parts.rightEye.scale.y = 0.5;
            parts.leftBrow.rotation.z = Math.PI / 4;
            parts.rightBrow.rotation.z = -Math.PI / 4;
            break;
            
        case 'surprised':
            parts.leftEye.scale.set(1.5, 1.5, 1);
            parts.rightEye.scale.set(1.5, 1.5, 1);
            parts.leftBrow.position.y = 0.15;
            parts.rightBrow.position.y = 0.15;
            break;
            
        case 'focused':
            parts.leftEye.scale.y = 0.7;
            parts.rightEye.scale.y = 0.7;
            parts.leftBrow.rotation.z = -Math.PI / 12;
            parts.rightBrow.rotation.z = Math.PI / 12;
            break;
            
        case 'neutral':
        default:
            parts.leftEye.scale.set(1, 1, 1);
            parts.rightEye.scale.set(1, 1, 1);
            parts.leftBrow.rotation.z = Math.PI / 6;
            parts.rightBrow.rotation.z = -Math.PI / 6;
            parts.leftBrow.position.y = 0.12;
            parts.rightBrow.position.y = 0.12;
            break;
    }
}
