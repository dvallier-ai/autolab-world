// ═══════════════════════════════════════════════════════════════
// room.js — The Living World Environment
// ═══════════════════════════════════════════════════════════════
// Cyberpunk hacker den: neon accents, tech clutter, lived-in feel.
// Think: underground tech lab meets cozy startup garage.
// ═══════════════════════════════════════════════════════════════

import * as THREE from 'three';

const ROOM = {
    width: 22,
    depth: 18,
    wallHeight: 5.5,
    floorColor: 0x0f0f1a,
    wallColor: 0x0c0c22,
    accentColor: 0x4a9eff,
    warmLight: 0xffa54a,
    dangerRed: 0xff4444,
    termGreen: 0x4ade80,
};

export function createRoom(scene) {
    const group = new THREE.Group();
    const animatables = []; // things that move/blink each frame
    
    // ══════════════════════════════════════════════════════════
    // STRUCTURAL: Floor, Walls, Ceiling
    // ══════════════════════════════════════════════════════════
    
    // ── Floor ──────────────────────────────────────────────────
    const floorGeo = new THREE.PlaneGeometry(ROOM.width, ROOM.depth);
    const floorMat = new THREE.MeshStandardMaterial({
        color: ROOM.floorColor,
        roughness: 0.85,
        metalness: 0.15,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'floor'; // Name for theme system
    group.add(floor);
    
    // ── Floor grid lines (subtle tech pattern) ────────────────
    const gridGroup = new THREE.Group();
    gridGroup.name = 'floorGrid';
    const gridMat = new THREE.LineBasicMaterial({ 
        color: 0x151530, transparent: true, opacity: 0.4 
    });
    for (let z = -ROOM.depth / 2; z <= ROOM.depth / 2; z += 1) {
        const pts = [
            new THREE.Vector3(-ROOM.width / 2, 0.01, z),
            new THREE.Vector3(ROOM.width / 2, 0.01, z)
        ];
        gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }
    for (let x = -ROOM.width / 2; x <= ROOM.width / 2; x += 1) {
        const pts = [
            new THREE.Vector3(x, 0.01, -ROOM.depth / 2),
            new THREE.Vector3(x, 0.01, ROOM.depth / 2)
        ];
        gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
    }
    group.add(gridGroup);
    
    // ── Back wall ─────────────────────────────────────────────
    const wallMat = new THREE.MeshStandardMaterial({
        color: ROOM.wallColor, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide,
    });
    const backWall = new THREE.Mesh(
        new THREE.PlaneGeometry(ROOM.width, ROOM.wallHeight), wallMat
    );
    backWall.position.set(0, ROOM.wallHeight / 2, -ROOM.depth / 2);
    backWall.receiveShadow = true;
    backWall.name = 'backWall';
    group.add(backWall);
    
    // ── Left wall ─────────────────────────────────────────────
    const leftWall = new THREE.Mesh(
        new THREE.PlaneGeometry(ROOM.depth, ROOM.wallHeight), wallMat.clone()
    );
    leftWall.position.set(-ROOM.width / 2, ROOM.wallHeight / 2, 0);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.receiveShadow = true;
    leftWall.name = 'leftWall';
    group.add(leftWall);
    
    // ── Right wall (partial — open section for "hallway" feel) ─
    const rightWall = new THREE.Mesh(
        new THREE.PlaneGeometry(ROOM.depth * 0.6, ROOM.wallHeight), wallMat.clone()
    );
    rightWall.position.set(ROOM.width / 2, ROOM.wallHeight / 2, -ROOM.depth * 0.2);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.receiveShadow = true;
    rightWall.name = 'rightWall';
    group.add(rightWall);
    
    // ── Ceiling (subtle, transparent for camera) ──────────────
    const ceilGeo = new THREE.PlaneGeometry(ROOM.width, ROOM.depth);
    const ceilMat = new THREE.MeshStandardMaterial({
        color: 0x080818, roughness: 0.95, metalness: 0.0,
        transparent: true, opacity: 0.3, side: THREE.DoubleSide,
    });
    const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = ROOM.wallHeight;
    ceiling.name = 'ceiling';
    group.add(ceiling);

    // ══════════════════════════════════════════════════════════
    // ACCENT LIGHTING: Neon strips, ceiling rails
    // ══════════════════════════════════════════════════════════
    
    // ── Floor-edge neon strips ────────────────────────────────
    const neonMat = new THREE.MeshBasicMaterial({
        color: ROOM.accentColor, transparent: true, opacity: 0.6,
    });
    
    // Back wall strip
    addNeonStrip(group, neonMat, [0, 0.02, -ROOM.depth / 2 + 0.03], [ROOM.width - 0.2, 0.04, 0.04]);
    // Left wall strip
    addNeonStrip(group, neonMat, [-ROOM.width / 2 + 0.03, 0.02, 0], [0.04, 0.04, ROOM.depth - 0.2]);
    // Right wall strip (partial)
    addNeonStrip(group, neonMat, [ROOM.width / 2 - 0.03, 0.02, -ROOM.depth * 0.2], [0.04, 0.04, ROOM.depth * 0.6]);
    
    // ── Ceiling light rails (3 parallel neon tubes) ───────────
    const ceilNeon = new THREE.MeshBasicMaterial({
        color: ROOM.accentColor, transparent: true, opacity: 0.25,
    });
    for (let i = -1; i <= 1; i++) {
        const rail = new THREE.Mesh(
            new THREE.BoxGeometry(ROOM.width * 0.7, 0.03, 0.03), ceilNeon
        );
        rail.position.set(0, ROOM.wallHeight - 0.5, i * 3 - 2);
        if (window._enableBloom) window._enableBloom(rail);
        group.add(rail);
        animatables.push({ type: 'ceilRail', mesh: rail, offset: i });
    }
    
    // ── Wall-top accent strip (back wall) ─────────────────────
    addNeonStrip(group, ceilNeon.clone(), [0, ROOM.wallHeight - 0.1, -ROOM.depth / 2 + 0.03], [ROOM.width - 0.2, 0.03, 0.03]);

    // ══════════════════════════════════════════════════════════
    // BACK WALL: Command screens, data panels, clock
    // ══════════════════════════════════════════════════════════
    
    // ── Large "Command Display" (back wall center) ────────────
    const cmdDisplay = createWallScreen(3.5, 1.8, ROOM.accentColor, 'hive');
    // Moved down to 1.2 to clear room for big world monitor
    cmdDisplay.position.set(0, 1.2, -ROOM.depth / 2 + 0.06);
    group.add(cmdDisplay);
    animatables.push({ type: 'cmdDisplay', mesh: cmdDisplay });
    
    // ── World Monitor (top center above main display) ─────────
    const worldMonitor = createWallScreen(5.0, 2.5, 0x4a9eff, 'world-monitor');
    // Higher up (center 3.8, height 2.5 -> range 2.55 to 5.05)
    worldMonitor.position.set(0, 3.8, -ROOM.depth / 2 + 0.12);
    worldMonitor.userData.url = 'http://localhost:3000/';
    worldMonitor.userData.clickable = 'world-monitor';
    // Also set clickable on the mesh itself for raycaster
    if (worldMonitor.userData.screenMesh) {
        worldMonitor.userData.screenMesh.userData.clickable = 'world-monitor';
        worldMonitor.userData.screenMesh.userData.url = 'http://localhost:3000/';
    }
    group.add(worldMonitor);
    animatables.push({ type: 'liveScreen', mesh: worldMonitor });
    
    // ── Flanking data panels ──────────────────────────────────
    const leftPanel = createWallScreen(2.2, 1.4, ROOM.termGreen, 'system');
    // Moved down to align with bottom command display (y=1.2)
    leftPanel.position.set(-4.5, 1.2, -ROOM.depth / 2 + 0.06);
    group.add(leftPanel);
    animatables.push({ type: 'liveScreen', mesh: leftPanel });
    
    const rightPanel = createWallScreen(2.2, 1.4, ROOM.dangerRed, 'events');
    // Moved down to align with bottom command display (y=1.2)
    rightPanel.position.set(4.5, 1.2, -ROOM.depth / 2 + 0.06);
    group.add(rightPanel);
    animatables.push({ type: 'liveScreen', mesh: rightPanel });
    
    // (Small status screens removed to declutter front wall)

    // ══════════════════════════════════════════════════════════
    // LEFT WALL: Whiteboard, posters, cable runs
    // ══════════════════════════════════════════════════════════
    
    // ── Whiteboard / planning board ───────────────────────────
    const whiteboard = createWhiteboard();
    whiteboard.position.set(-ROOM.width / 2 + 0.08, 2.5, -3);
    whiteboard.rotation.y = Math.PI / 2;
    whiteboard.userData.interactive = 'whiteboard';
    group.add(whiteboard);
    
    // ── "Hacker" posters / art on left wall ───────────────────
    const posterTexts = ['01101', 'HACK\nTHE\nPLANET', '> _'];
    posterTexts.forEach((text, i) => {
        const poster = createPoster(text, [ROOM.accentColor, ROOM.termGreen, ROOM.warmLight][i]);
        poster.position.set(-ROOM.width / 2 + 0.08, 2.0 + (i % 2) * 1.5, 2 + i * 2.5);
        poster.rotation.y = Math.PI / 2;
        group.add(poster);
    });
    
    // ── Vertical cable runs (left wall) ───────────────────────
    for (let i = 0; i < 3; i++) {
        const cable = createCableRun(ROOM.wallHeight - 1);
        cable.position.set(-ROOM.width / 2 + 0.05, 0.5, -6 + i * 3);
        group.add(cable);
    }

    // ══════════════════════════════════════════════════════════
    // FURNITURE & PROPS
    // ══════════════════════════════════════════════════════════
    
    // ── Server rack (back-right corner) ───────────────────────
    const rack = createServerRack();
    rack.position.set(ROOM.width / 2 - 2, 0, -ROOM.depth / 2 + 1.5);
    rack.userData.interactive = 'server-rack';
    group.add(rack);
    animatables.push({ type: 'rack', ref: rack });
    
    // ── Second server rack ────────────────────────────────────
    const rack2 = createServerRack();
    rack2.position.set(ROOM.width / 2 - 3.5, 0, -ROOM.depth / 2 + 1.5);
    group.add(rack2);
    animatables.push({ type: 'rack', ref: rack2 });
    
    // ── Floor lamp by server racks ────────────────────────────
    const serverLamp = createFloorLamp();
    serverLamp.position.set(ROOM.width / 2 - 0.5, 0, -ROOM.depth / 2 + 1.2);
    group.add(serverLamp);
    
    // ── Couch / lounge area (front-left) ──────────────────────
    const couch = createCouch();
    couch.position.set(-ROOM.width / 2 + 3, 0, ROOM.depth / 2 - 3);
    couch.rotation.y = Math.PI / 4;
    group.add(couch);
    
    // ── Coffee table next to couch ────────────────────────────
    const coffeeTable = createCoffeeTable();
    coffeeTable.position.set(-ROOM.width / 2 + 4.5, 0, ROOM.depth / 2 - 2);
    group.add(coffeeTable);
    
    // ── Coffee mug on table ───────────────────────────────────
    const mug = createCoffeeMug();
    mug.position.set(-ROOM.width / 2 + 4.5, 0.36, ROOM.depth / 2 - 2);
    mug.userData.interactive = 'coffee-mug';
    group.add(mug);
    animatables.push({ type: 'steam', ref: mug });
    
    // ── Epstein Files folder on table ─────────────────────────
    const epsteinFiles = createFolderStack();
    epsteinFiles.position.set(-ROOM.width / 2 + 4.3, 0.37, ROOM.depth / 2 - 2.1);
    epsteinFiles.userData.interactive = 'epstein-files';
    epsteinFiles.userData.url = 'http://localhost:5101/documents';
    group.add(epsteinFiles);
    
    // ── Bookshelf on left wall ────────────────────────────────
    const bookshelf = createBookshelf();
    bookshelf.position.set(-ROOM.width / 2 + 0.5, 0, 0);
    bookshelf.userData.interactive = 'bookshelf';
    group.add(bookshelf);
    
    // ── Hardware Workbench (right wall — Mac/laptop rack) ─────
    const hwBench = createHardwareBench();
    // Move flush against right wall (x=11). 
    // Moved back to original z=2 position.
    hwBench.position.set(10.2, 0, 2); 
    hwBench.rotation.y = -Math.PI / 2;  // Face -X (into room)
    hwBench.userData.interactive = 'hardware-bench';
    hwBench.name = 'hardware-bench';
    group.add(hwBench);
    
    // ── Potted plant (front-right) ────────────────────────────
    const plant = createPottedPlant();
    plant.position.set(ROOM.width / 2 - 2, 0, ROOM.depth / 2 - 2);
    group.add(plant);
    
    // ── Floor mat / rug under desk area ───────────────────────
    const rug = new THREE.Mesh(
        new THREE.CircleGeometry(4.5, 32),
        new THREE.MeshStandardMaterial({
            color: 0x1a1235, roughness: 0.95, metalness: 0.0,
        })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.015, 1.5);
    rug.receiveShadow = true;
    group.add(rug);
    // Rug border ring
    const rugBorder = new THREE.Mesh(
        new THREE.RingGeometry(4.3, 4.5, 32),
        new THREE.MeshBasicMaterial({ color: 0x4a9eff, transparent: true, opacity: 0.15 })
    );
    rugBorder.rotation.x = -Math.PI / 2;
    rugBorder.position.set(0, 0.016, 1.5);
    group.add(rugBorder);
    
    // ── Standing fan (back-left) ──────────────────────────────
    const fan = createStandingFan();
    fan.position.set(-ROOM.width / 2 + 2, 0, -ROOM.depth / 2 + 2);
    group.add(fan);
    animatables.push({ type: 'fan', ref: fan });
    
    // ── Wall clock (front wall — command center side) ─────────
    const clock = createWallClock();
    clock.position.set(-8, 4.2, -ROOM.depth / 2 + 0.08);
    group.add(clock);
    animatables.push({ type: 'clock', ref: clock });

    // ── Network cables on floor (aesthetic clutter) ───────────
    for (let i = 0; i < 4; i++) {
        const cable = createFloorCable(3 + Math.random() * 4);
        cable.position.set(-3 + i * 2.5 + Math.random(), 0.02, -4 + Math.random() * 2);
        cable.rotation.y = Math.random() * 0.5 - 0.25;
        group.add(cable);
    }
    
    // ── Stacked pizza boxes near couch ────────────────────────
    const pizzaStack = createPizzaBoxStack();
    pizzaStack.position.set(-ROOM.width / 2 + 5.5, 0, ROOM.depth / 2 - 3.5);
    group.add(pizzaStack);

    // ── Mini fridge (right side, near hallway opening) ────────
    const fridge = createMiniFridge();
    fridge.position.set(ROOM.width / 2 - 1.5, 0, 3);
    group.add(fridge);
    animatables.push({ type: 'fridge', ref: fridge });

    // ── Keyboard & mouse on side table ────────────────────────
    const sideTable = createSideTable();
    sideTable.position.set(ROOM.width / 2 - 3, 0, 5);
    group.add(sideTable);
    
    // ── Whiteboard #2 on right wall ───────────────────────────
    const kanban = createKanbanBoard();
    kanban.position.set(ROOM.width / 2 - 0.08, 2.5, -3);
    kanban.rotation.y = -Math.PI / 2;
    kanban.userData.interactive = 'kanban';
    group.add(kanban);
    animatables.push({ type: 'kanban', ref: kanban });
    
    // ── Lava lamp on coffee table ─────────────────────────────
    const lavaLamp = createLavaLamp();
    lavaLamp.position.set(-ROOM.width / 2 + 4.2, 0.37, ROOM.depth / 2 - 1.8);
    group.add(lavaLamp);
    animatables.push({ type: 'lavaLamp', ref: lavaLamp });
    
    // ── Headphones on couch arm ───────────────────────────────
    const headphones = createHeadphones();
    headphones.position.set(-ROOM.width / 2 + 2.2, 0.68, ROOM.depth / 2 - 2.7);
    headphones.rotation.z = 0.2;
    group.add(headphones);
    
    // ── Drone on shelf / floating ─────────────────────────────
    const drone = createDrone();
    drone.position.set(4, 3.5, -4);
    group.add(drone);
    animatables.push({ type: 'drone', ref: drone });
    
    // ── Neon sign on back wall ("WE NEVER SLEEP") ─────────────
    const neonSign = createNeonSign('WE NEVER SLEEP');
    // Moved to right wall (above workbench) to avoid world monitor
    neonSign.position.set(10.9, 4.5, 2); 
    neonSign.rotation.y = -Math.PI / 2;
    group.add(neonSign);
    animatables.push({ type: 'neonSign', ref: neonSign });
    
    // ── Trading Dashboard Screen (right wall, forward section) ──
    const tradingScreen = createWallScreen(4.5, 2.8, 0xFF9800, 'trading-dashboard');
    tradingScreen.position.set(ROOM.width / 2 - 0.12, 3.0, 6.5);
    tradingScreen.rotation.y = -Math.PI / 2; // Face left (into room)
    tradingScreen.userData.url = 'http://localhost:3200/#overview';
    tradingScreen.userData.clickable = 'trading-dashboard';
    // Make the screen mesh clickable too
    if (tradingScreen.userData.screenMesh) {
        tradingScreen.userData.screenMesh.userData.clickable = 'trading-dashboard';
        tradingScreen.userData.screenMesh.userData.url = 'http://localhost:3200/#overview';
    }
    group.add(tradingScreen);
    animatables.push({ type: 'liveScreen', mesh: tradingScreen });
    
    // ── Energy drink cans (only on coffee table — desk ones removed) ──
    const canPositions = [
        [-ROOM.width / 2 + 4.7, 0.37, ROOM.depth / 2 - 2.1],
    ];
    canPositions.forEach(pos => {
        const can = createEnergyDrinkCan();
        can.position.set(pos[0], pos[1], pos[2]);
        can.rotation.y = Math.random() * Math.PI * 2;
        group.add(can);
    });
    
    // ── Sticky notes on desk edge (by each workstation) ───────
    for (let i = 0; i < 5; i++) {
        const sticky = createStickyNote(
            ['TODO', 'BUG!', 'SHIP', 'YOLO', '???'][i],
            [0xffee44, 0xff6666, 0x44ff88, 0x44aaff, 0xff88ff][i]
        );
        sticky.position.set(-6 + i * 3, 0.04, -ROOM.depth / 2 + 0.5 + Math.random() * 0.5);
        sticky.rotation.x = -Math.PI / 2;
        sticky.rotation.z = (Math.random() - 0.5) * 0.3;
        group.add(sticky);
    }
    
    // ── Router/modem box (near server racks) ──────────────────
    const router = createRouter();
    router.position.set(ROOM.width / 2 - 4.5, 0, -ROOM.depth / 2 + 1);
    group.add(router);
    animatables.push({ type: 'router', ref: router });

    // ══════════════════════════════════════════════════════════
    // ADDITIONAL FURNISHINGS — make it homey
    // ══════════════════════════════════════════════════════════

    // ── Lounge rug (under couch area) ─────────────────────────
    const loungeRug = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 4),
        new THREE.MeshStandardMaterial({ color: 0x1e1028, roughness: 0.95 })
    );
    loungeRug.rotation.x = -Math.PI / 2;
    loungeRug.position.set(-ROOM.width / 2 + 4, 0.012, ROOM.depth / 2 - 3);
    group.add(loungeRug);

    // ── Extra potted plants ───────────────────────────────────
    // Tall plant back-right corner
    const tallPlant = createTallPlant();
    tallPlant.position.set(ROOM.width / 2 - 1, 0, -ROOM.depth / 2 + 2);
    group.add(tallPlant);
    
    // Small desk plant near fridge
    const smallPlant = createSmallPlant();
    smallPlant.position.set(ROOM.width / 2 - 2, 0, 4.5);
    group.add(smallPlant);
    
    // Hanging plant from ceiling near couch
    const hangPlant = createHangingPlant();
    hangPlant.position.set(-ROOM.width / 2 + 3, ROOM.wallHeight - 1.2, ROOM.depth / 2 - 4);
    group.add(hangPlant);
    
    // Plant on bookshelf side
    const shelfPlant = createSmallPlant();
    shelfPlant.position.set(-ROOM.width / 2 + 1.5, 0, -3);
    group.add(shelfPlant);
    
    // ── Bean bag chair (front-right, casual seating) ──────────
    const beanBag = createBeanBag(0x2a1a4a);
    beanBag.position.set(6, 0, 6);
    beanBag.rotation.y = -0.4;
    group.add(beanBag);
    
    // Second bean bag
    const beanBag2 = createBeanBag(0x1a2a3a);
    beanBag2.position.set(7.5, 0, 5);
    beanBag2.rotation.y = 0.6;
    group.add(beanBag2);
    
    // ── Whiteboard / corkboard on left wall ───────────────────
    const corkboard = createCorkboard();
    corkboard.position.set(-ROOM.width / 2 + 3, 2.8, -ROOM.depth / 2 + 0.12); // Front wall (TV side)
    // corkboard.rotation.y = Math.PI / 2; // No longer on side wall
    group.add(corkboard);
    
    // ── Shoe rack / coat hooks by entrance (front-right) ──────
    const coatRack = createCoatRack();
    coatRack.position.set(ROOM.width / 2 - 0.5, 0, 7.5);
    group.add(coatRack);
    
    // ── Small rug at entrance ─────────────────────────────────
    const entryRug = new THREE.Mesh(
        new THREE.PlaneGeometry(2.5, 1.5),
        new THREE.MeshStandardMaterial({ color: 0x221a15, roughness: 0.95 })
    );
    entryRug.rotation.x = -Math.PI / 2;
    entryRug.position.set(ROOM.width / 2 - 2, 0.012, 8);
    group.add(entryRug);
    
    // ── Wall art / framed prints on BACK wall (behind agents) ──
    const art1 = createWallArt('🌌', 0x4a9eff);
    art1.position.set(-6, 3.0, ROOM.depth / 2 - 0.08);
    art1.rotation.y = Math.PI; // Face into room from back wall
    group.add(art1);
    
    const art2 = createWallArt('🤖', 0x4ade80);
    art2.position.set(6, 3.5, ROOM.depth / 2 - 0.08);
    art2.rotation.y = Math.PI; // Face into room from back wall
    group.add(art2);
    
    // ── More back wall decor ──────────────────────────────────
    const art3 = createWallArt('⚡', 0xffaa4a);
    art3.position.set(8, 2.5, ROOM.depth / 2 - 0.08);
    art3.rotation.y = Math.PI;
    group.add(art3);
    
    // Motivational poster
    const poster2 = createWallArt('🚀', 0xff66aa);
    poster2.position.set(-8, 2.8, ROOM.depth / 2 - 0.08);
    poster2.rotation.y = Math.PI;
    group.add(poster2);
    
    // ── Video Wall — Dan's tweet video on back wall center ────
    const videoWall = createVideoWall('/media/sample-video.mp4');
    videoWall.position.set(0, 2.8, ROOM.depth / 2 - 0.08);
    videoWall.rotation.y = Math.PI;
    group.add(videoWall);
    animatables.push({ type: 'videoWall', mesh: videoWall });
    
    // ── Shelf with knick-knacks - moved to back wall ──────────
    const wallShelf = createWallShelf();
    // Moved to back wall, left side (away from video wall and art)
    wallShelf.position.set(-3, 2.5, ROOM.depth / 2 - 0.08); 
    wallShelf.rotation.y = Math.PI; // Face into room
    group.add(wallShelf);
    
    // ── Floor lamp (cozy reading light, near couch) ───────────
    const readingLamp = createReadingLamp();
    readingLamp.position.set(-ROOM.width / 2 + 1.5, 0, ROOM.depth / 2 - 2);
    group.add(readingLamp);
    
    // ── Small table with tech magazines near bean bags ────────
    const magTable = createMagazineTable();
    magTable.position.set(6.5, 0, 7);
    group.add(magTable);
    
    // ── Water cooler (near hallway entrance) ──────────────────
    const waterCooler = createWaterCooler();
    waterCooler.position.set(ROOM.width / 2 - 3.5, 0, 7);
    group.add(waterCooler);
    
    // ── Dartboard (back-left wall) ────────────────────────────
    const dartboard = createDartboard();
    dartboard.position.set(-8, 1.5, -ROOM.depth / 2 + 0.08);
    group.add(dartboard);
    
    // ── Trash can (for paper ball hoops) ─────────────────────
    const trashCan = createTrashCan();
    trashCan.position.set(ROOM.width / 2 - 2, 0, 1.5); // Tucked in by the hardware bench
    group.add(trashCan);

    // ══════════════════════════════════════════════════════════
    // LIGHTING
    // ══════════════════════════════════════════════════════════
    
    // Overhead soft light (PointLight — more compatible than RectAreaLight)
    const overhead = new THREE.PointLight(0xddeeff, 2.0, 25);
    overhead.position.set(0, ROOM.wallHeight - 0.3, 0);
    group.add(overhead);
    
    // Second overhead for even coverage
    const overhead2 = new THREE.PointLight(0xddeeff, 1.5, 20);
    overhead2.position.set(0, ROOM.wallHeight - 0.3, 3);
    group.add(overhead2);
    
    // Warm accent from back-left (cozy)
    const warmAccent = new THREE.PointLight(ROOM.warmLight, 1.0, 22);
    warmAccent.position.set(-ROOM.width / 2 + 2, 3, -ROOM.depth / 2 + 2);
    group.add(warmAccent);
    
    // Cool accent from right
    const coolAccent = new THREE.PointLight(ROOM.accentColor, 0.8, 22);
    coolAccent.position.set(ROOM.width / 2 - 2, 3, 2);
    group.add(coolAccent);
    
    // Fill light from front
    const fillLight = new THREE.PointLight(0xaabbdd, 0.8, 20);
    fillLight.position.set(0, 4, ROOM.depth / 2 - 1);
    group.add(fillLight);
    
    // Server rack area glow (subtle green)
    const rackGlow = new THREE.PointLight(ROOM.termGreen, 0.5, 8);
    rackGlow.position.set(ROOM.width / 2 - 2.5, 2, -ROOM.depth / 2 + 2);
    group.add(rackGlow);
    
    // Couch area warm glow
    const couchGlow = new THREE.PointLight(ROOM.warmLight, 0.5, 6);
    couchGlow.position.set(-ROOM.width / 2 + 3, 1.5, ROOM.depth / 2 - 3);
    group.add(couchGlow);

    scene.add(group);
    
    // ══════════════════════════════════════════════════════════
    // ANIMATION LOOP
    // ══════════════════════════════════════════════════════════
    
    return {
        group,
        rack,
        // Theme system references
        floor,
        backWall,
        leftWall,
        rightWall,
        ceiling,
        gridGroup,
        update(time, dt, liveData) {
            animatables.forEach(a => {
                switch (a.type) {
                    case 'kanban':
                        if (liveData && liveData.kanban) {
                            const hash = JSON.stringify(liveData.kanban);
                            if (a.ref.userData.lastHash !== hash) {
                                drawKanban(a.ref.userData.ctx, liveData.kanban);
                                a.ref.userData.tex.needsUpdate = true;
                                a.ref.userData.lastHash = hash;
                            }
                        }
                        break;
                    case 'rack':
                        if (a.ref.userData.leds) {
                            a.ref.userData.leds.forEach((led, i) => {
                                const blink = Math.sin(time * 3 + i * 1.7) > 0.3;
                                led.material.opacity = blink ? 0.9 : 0.2;
                            });
                        }
                        break;
                    case 'ceilRail':
                        a.mesh.material.opacity = 0.2 + Math.sin(time * 0.5 + a.offset * 1.5) * 0.08;
                        break;
                    case 'cmdDisplay':
                        if (a.mesh.userData.scanLine) {
                            a.mesh.userData.scanLine.position.y = 
                                (Math.sin(time * 0.8) * 0.5) * a.mesh.userData.screenH;
                        }
                        // Redraw hive screen every 2 seconds
                        if (a.mesh.userData.screenId === 'hive' && time - a.mesh.userData.lastRedraw > 2) {
                            drawHiveScreen(a.mesh, time, liveData);
                            a.mesh.userData.lastRedraw = time;
                        }
                        break;
                    case 'liveScreen':
                        // Redraw live data screens every 2 seconds
                        if (time - a.mesh.userData.lastRedraw > 2) {
                            if (a.mesh.userData.screenId === 'system') {
                                drawSystemScreen(a.mesh, time, liveData);
                            } else if (a.mesh.userData.screenId === 'events') {
                                drawEventFeedScreen(a.mesh, time, liveData);
                            } else if (a.mesh.userData.screenId === 'world-monitor') {
                                drawWorldMonitorScreen(a.mesh, time, liveData);
                            } else if (a.mesh.userData.screenId === 'trading-dashboard') {
                                drawTradingDashboardScreen(a.mesh, time, liveData);
                            }
                            a.mesh.userData.lastRedraw = time;
                            // Pulse border
                            if (a.mesh.userData.border) {
                                a.mesh.userData.border.material.opacity = 
                                    0.15 + Math.sin(time * 2) * 0.15;
                            }
                        }
                        break;
                    case 'steam':
                        if (a.ref.userData.steam) {
                            a.ref.userData.steam.children.forEach((p, i) => {
                                p.position.y += dt * 0.3;
                                p.material.opacity = Math.max(0, 0.4 - p.position.y * 0.5);
                                if (p.position.y > 0.8) {
                                    p.position.y = 0.1;
                                    p.position.x = (Math.random() - 0.5) * 0.06;
                                }
                            });
                        }
                        break;
                    case 'fan':
                        if (a.ref.userData.blades) {
                            a.ref.userData.blades.rotation.z += dt * 4;
                        }
                        break;
                    case 'clock':
                        if (a.ref.userData.secondHand) {
                            const d = new Date();
                            const sec = d.getSeconds() + d.getMilliseconds() / 1000;
                            const min = d.getMinutes() + sec / 60;
                            const hr = (d.getHours() % 12) + min / 60;
                            a.ref.userData.secondHand.rotation.z = -(sec / 60) * Math.PI * 2;
                            a.ref.userData.minuteHand.rotation.z = -(min / 60) * Math.PI * 2;
                            a.ref.userData.hourHand.rotation.z = -(hr / 12) * Math.PI * 2;
                        }
                        break;
                    case 'fridge':
                        if (a.ref.userData.led) {
                            a.ref.userData.led.material.opacity = 0.6 + Math.sin(time * 0.3) * 0.3;
                        }
                        break;
                    case 'lavaLamp':
                        if (a.ref.userData.blobs) {
                            a.ref.userData.blobs.forEach((blob, i) => {
                                blob.position.y = 0.1 + (Math.sin(time * 0.5 + i * 2.1) * 0.5 + 0.5) * 0.25;
                                blob.scale.setScalar(0.8 + Math.sin(time * 0.7 + i) * 0.2);
                            });
                        }
                        break;
                    case 'drone': {
                        // Complex flight path — large Lissajous-like pattern so repeats aren't obvious
                        const baseX = 4, baseZ = -4, baseY = 3.5;
                        const px = baseX + Math.sin(time * 0.23) * 5 + Math.sin(time * 0.11) * 2;
                        const pz = baseZ + Math.cos(time * 0.17) * 4 + Math.sin(time * 0.29) * 1.5;
                        const py = baseY + Math.sin(time * 0.31) * 0.5 + Math.sin(time * 0.53) * 0.25;
                        a.ref.position.set(px, py, pz);
                        // Face direction of travel
                        const dx = Math.cos(time * 0.23) * 5 * 0.23 + Math.cos(time * 0.11) * 2 * 0.11;
                        const dz = -Math.sin(time * 0.17) * 4 * 0.17 + Math.cos(time * 0.29) * 1.5 * 0.29;
                        a.ref.rotation.y = Math.atan2(dx, dz);
                        // Slight banking into turns
                        a.ref.rotation.z = -dx * 0.05;
                        if (a.ref.userData.propellers) {
                            a.ref.userData.propellers.forEach(p => p.rotation.y += dt * 25);
                        }
                        break;
                    }
                    case 'neonSign':
                        if (a.ref.userData.textMesh) {
                            a.ref.userData.textMesh.material.opacity = 0.7 + Math.sin(time * 1.5) * 0.2 + Math.sin(time * 7) * 0.05;
                        }
                        break;
                    case 'router':
                        if (a.ref.userData.leds) {
                            a.ref.userData.leds.forEach((led, i) => {
                                led.material.opacity = Math.sin(time * 5 + i * 0.8) > 0 ? 0.9 : 0.15;
                            });
                        }
                        break;
                }
            });
        }
    };
}


// ══════════════════════════════════════════════════════════════
// PROP FACTORY FUNCTIONS
// ══════════════════════════════════════════════════════════════

function addNeonStrip(parent, mat, pos, size) {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const mesh = new THREE.Mesh(geo, mat.clone());
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (window._enableBloom) window._enableBloom(mesh);
    parent.add(mesh);
    return mesh;
}

// ── Wall screens ──────────────────────────────────────────────
function createWallScreen(w, h, color, screenId) {
    const screen = new THREE.Group();
    
    // Screen surface
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(w * 128);
    canvas.height = Math.floor(h * 128);
    const ctx = canvas.getContext('2d');
    
    // Initial blank
    ctx.fillStyle = '#060614';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const tex = new THREE.CanvasTexture(canvas);
    const screenMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85 })
    );
    screen.add(screenMesh);
    
    // Store reference to screenMesh for clickability
    screen.userData.screenMesh = screenMesh;
    
    // Border
    const borderGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h));
    const borderColor = typeof color === 'number' ? color : 0x4a9eff;
    const border = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
        color: borderColor, transparent: true, opacity: 0.3,
    }));
    screen.add(border);
    
    // Scan line (for main display)
    if (screenId === 'hive') {
        const scanLine = new THREE.Mesh(
            new THREE.PlaneGeometry(w, 0.01),
            new THREE.MeshBasicMaterial({ color: borderColor, transparent: true, opacity: 0.4 })
        );
        scanLine.position.z = 0.01;
        screen.add(scanLine);
        screen.userData.scanLine = scanLine;
        screen.userData.screenH = h;
    }
    
    screen.userData.border = border;
    screen.userData.canvas = canvas;
    screen.userData.ctx = ctx;
    screen.userData.tex = tex;
    screen.userData.screenId = screenId;
    screen.userData.colorHex = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : '#4a9eff';
    screen.userData.lastRedraw = 0;
    return screen;
}

// ── Live TV renderers ─────────────────────────────────────────

function drawHiveScreen(screen, time, liveData) {
    const { canvas, ctx, tex, colorHex } = screen.userData;
    const w = canvas.width, h = canvas.height;
    
    ctx.fillStyle = '#060614';
    ctx.fillRect(0, 0, w, h);
    
    // Hex grid background
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.12;
    const hexSize = 24;
    for (let row = 0; row < h / hexSize; row++) {
        for (let col = 0; col < w / (hexSize * 1.5); col++) {
            const cx = col * hexSize * 1.5 + (row % 2) * hexSize * 0.75;
            const cy = row * hexSize * 0.86;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = Math.PI / 3 * i - Math.PI / 6;
                const px = cx + Math.cos(a) * hexSize * 0.4;
                const py = cy + Math.sin(a) * hexSize * 0.4;
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1.0;
    
    // Title
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'center';
    ctx.fillText('⬡ AUTOLAB HIVE STATUS', w / 2, 30);
    
    ctx.font = '10px monospace';
    ctx.fillStyle = '#555';
    const now = new Date();
    ctx.fillText(now.toLocaleTimeString('en-US', { hour12: false }) + ' PST', w / 2, 44);
    
    // Agent cards
    const agents = liveData?.agents || [];
    const cardW = Math.min(110, (w - 40) / Math.max(agents.length, 1));
    const startX = (w - agents.length * cardW) / 2;
    
    agents.forEach((agent, i) => {
        const x = startX + i * cardW;
        const y = 60;
        const agentColor = agent.color || colorHex;
        
        // Card bg
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(x + 2, y, cardW - 4, 65);
        
        // Status dot
        ctx.beginPath();
        ctx.arc(x + cardW / 2, y + 14, 5, 0, Math.PI * 2);
        ctx.fillStyle = agent.active ? '#4ade80' : '#555';
        ctx.fill();
        
        // Name
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = agentColor;
        ctx.textAlign = 'center';
        ctx.fillText(agent.emoji || '🤖', x + cardW / 2, y + 32);
        ctx.font = '9px monospace';
        ctx.fillText((agent.name || agent.id).toUpperCase(), x + cardW / 2, y + 44);
        
        // Status text
        ctx.font = '8px monospace';
        ctx.fillStyle = agent.active ? '#4ade80' : '#666';
        const statusText = agent.active ? 'ACTIVE' : `IDLE ${Math.floor((agent.idleSec || 0) / 60)}m`;
        ctx.fillText(statusText, x + cardW / 2, y + 56);
    });
    
    // Stats row
    const statsY = 140;
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(10, statsY, w - 20, 45);
    
    const stats = [
        { label: 'AGENTS', value: `${agents.filter(a => a.active).length}/${agents.length}` },
        { label: 'EVENTS/HR', value: `${liveData?.eventsPerHour || 0}` },
        { label: 'GATEWAYS', value: `${liveData?.gateways || 1}` },
        { label: 'UPTIME', value: liveData?.uptime || '—' },
    ];
    
    const statW = (w - 20) / stats.length;
    stats.forEach((s, i) => {
        const sx = 10 + i * statW + statW / 2;
        ctx.font = 'bold 16px monospace';
        ctx.fillStyle = colorHex;
        ctx.textAlign = 'center';
        ctx.fillText(s.value, sx, statsY + 22);
        ctx.font = '8px monospace';
        ctx.fillStyle = '#555';
        ctx.fillText(s.label, sx, statsY + 36);
    });
    
    // Mini activity sparkline
    const sparkY = 200;
    ctx.font = '8px monospace';
    ctx.fillStyle = '#444';
    ctx.textAlign = 'left';
    ctx.fillText('EVENT ACTIVITY (60 MIN)', 15, sparkY);
    
    const sparkData = liveData?.sparkline || [];
    if (sparkData.length > 0) {
        const maxVal = Math.max(...sparkData, 1);
        const barW = (w - 30) / sparkData.length;
        sparkData.forEach((val, i) => {
            const barH = (val / maxVal) * 35;
            ctx.fillStyle = colorHex;
            ctx.globalAlpha = 0.4 + (val / maxVal) * 0.6;
            ctx.fillRect(15 + i * barW, sparkY + 40 - barH, barW - 1, barH);
        });
        ctx.globalAlpha = 1.0;
    }
    
    tex.needsUpdate = true;
}

function drawSystemScreen(screen, time, liveData) {
    const { canvas, ctx, tex, colorHex } = screen.userData;
    const w = canvas.width, h = canvas.height;
    
    ctx.fillStyle = '#060614';
    ctx.fillRect(0, 0, w, h);
    
    // Title
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'center';
    ctx.fillText('SYSTEM RESOURCES', w / 2, 16);
    
    // Resource bars
    const resources = liveData?.resources || [
        { name: 'CPU', value: 0, color: '#4ade80' },
        { name: 'MEM', value: 0, color: '#4a9eff' },
        { name: 'DISK', value: 0, color: '#ffaa4a' },
        { name: 'NET', value: 0, color: '#b44aff' },
    ];
    
    const barStartY = 30;
    const barH = 14;
    const barGap = 22;
    
    resources.forEach((r, i) => {
        const y = barStartY + i * barGap;
        
        // Label
        ctx.font = '9px monospace';
        ctx.fillStyle = '#666';
        ctx.textAlign = 'left';
        ctx.fillText(r.name, 8, y + 10);
        
        // Bar bg
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(40, y, w - 80, barH);
        
        // Bar fill
        const fill = Math.min(r.value / 100, 1);
        ctx.fillStyle = r.color;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(40, y, (w - 80) * fill, barH);
        ctx.globalAlpha = 1.0;
        
        // Value
        ctx.font = '9px monospace';
        ctx.fillStyle = '#aaa';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(r.value)}%`, w - 8, y + 10);
    });
    
    // Devices section
    const devY = barStartY + resources.length * barGap + 10;
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'center';
    ctx.fillText('DEVICES', w / 2, devY);
    
    const devices = liveData?.devices || [];
    devices.forEach((d, i) => {
        const y = devY + 14 + i * 16;
        ctx.font = '8px monospace';
        ctx.fillStyle = d.online ? '#4ade80' : '#ff4a4a';
        ctx.textAlign = 'left';
        ctx.fillText(d.online ? '●' : '○', 8, y);
        ctx.fillStyle = '#888';
        ctx.fillText(d.name, 22, y);
    });
    
    tex.needsUpdate = true;
}

function drawEventFeedScreen(screen, time, liveData) {
    const { canvas, ctx, tex, colorHex } = screen.userData;
    const w = canvas.width, h = canvas.height;
    
    ctx.fillStyle = '#060614';
    ctx.fillRect(0, 0, w, h);
    
    // Title
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'center';
    ctx.fillText('⚡ LIVE EVENT FEED', w / 2, 16);
    
    // Event list
    const events = liveData?.recentEvents || [];
    const lineH = 14;
    const maxLines = Math.floor((h - 28) / lineH);
    const displayed = events.slice(-maxLines);
    
    const typeColors = {
        chat: '#4a9eff',
        agent: '#ff6b4a',
        tool: '#4ade80',
        cron: '#ffaa4a',
        spawn: '#b44aff',
    };
    
    displayed.forEach((evt, i) => {
        const y = 28 + i * lineH;
        const age = (Date.now() - (evt.ts || 0)) / 1000;
        const alpha = Math.max(0.3, 1 - age / 3600);
        ctx.globalAlpha = alpha;
        
        // Time
        ctx.font = '7px monospace';
        ctx.fillStyle = '#444';
        ctx.textAlign = 'left';
        const d = new Date(evt.ts);
        ctx.fillText(d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), 4, y);
        
        // Type dot
        ctx.fillStyle = typeColors[evt.type] || '#666';
        ctx.fillRect(54, y - 6, 4, 4);
        
        // Agent + type
        ctx.font = '8px monospace';
        ctx.fillStyle = '#888';
        const agent = (evt.agentId || '?').slice(0, 6);
        const desc = `${agent} · ${evt.type || '?'}`;
        ctx.fillText(desc, 62, y);
    });
    ctx.globalAlpha = 1.0;
    
    // Blinking cursor at bottom
    if (Math.sin(time * 3) > 0) {
        ctx.fillStyle = colorHex;
        ctx.globalAlpha = 0.6;
        ctx.fillText('█', 4, h - 6);
        ctx.globalAlpha = 1.0;
    }
    
    tex.needsUpdate = true;
}

function drawWorldMonitorScreen(screen, time, liveData) {
    const { canvas, ctx, tex, colorHex } = screen.userData;
    const w = canvas.width, h = canvas.height;
    
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);
    
    // Header bar
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(0, 0, w, 36);
    
    // Title
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'left';
    ctx.fillText('🌐 WORLD MONITOR', 12, 24);
    
    // URL
    ctx.font = '10px monospace';
    ctx.fillStyle = '#666';
    const url = screen.userData.url || 'http://localhost:3000/';
    ctx.fillText(url, 12, 46);
    
    // Message
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#4a9eff';
    ctx.textAlign = 'center';
    ctx.fillText('Click to Open', w / 2, h / 2 - 10);
    
    ctx.font = '11px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText('Live view available in browser', w / 2, h / 2 + 10);
    
    // Decorative border pulse
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3 + Math.sin(time * 2) * 0.2;
    ctx.strokeRect(8, 64, w - 16, h - 80);
    ctx.globalAlpha = 1.0;
    
    tex.needsUpdate = true;
}

function drawTradingDashboardScreen(screen, time, liveData) {
    const { canvas, ctx, tex, colorHex } = screen.userData;
    const w = canvas.width, h = canvas.height;
    
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    
    // Header bar
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, 40);
    
    // Title with icon
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'left';
    ctx.fillText('📊 TRADING DASHBOARD', 14, 26);
    
    // URL subtitle
    ctx.font = '9px monospace';
    ctx.fillStyle = '#666';
    const url = screen.userData.url || 'http://localhost:3200/#overview';
    ctx.fillText(url, 14, 50);
    
    // Fake chart visualization
    const chartY = 70;
    const chartH = h - chartY - 40;
    const chartW = w - 28;
    
    // Chart background
    ctx.fillStyle = 'rgba(255,152,0,0.05)';
    ctx.fillRect(14, chartY, chartW, chartH);
    
    // Grid lines
    ctx.strokeStyle = 'rgba(255,152,0,0.1)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
        const y = chartY + (chartH / 5) * i;
        ctx.beginPath();
        ctx.moveTo(14, y);
        ctx.lineTo(14 + chartW, y);
        ctx.stroke();
    }
    
    // Fake price line (sine wave)
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    const points = 60;
    for (let i = 0; i < points; i++) {
        const x = 14 + (chartW / points) * i;
        const wave = Math.sin((i / points) * Math.PI * 2 + time * 0.5) * 0.3 + 0.5;
        const y = chartY + chartH * 0.2 + wave * chartH * 0.5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;
    
    // Click prompt
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 8;
    ctx.fillText('▶ Click to View Live Dashboard', w / 2, h - 20);
    ctx.shadowBlur = 0;
    
    // Pulse effect on border
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3 + Math.sin(time * 1.5) * 0.2;
    ctx.strokeRect(10, chartY - 4, chartW + 8, chartH + 8);
    ctx.globalAlpha = 1.0;
    
    tex.needsUpdate = true;
}

// ── Whiteboard ────────────────────────────────────────────────
function createWhiteboard() {
    const wb = new THREE.Group();
    
    // Board surface
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#e8e8e0';
    ctx.fillRect(0, 0, 512, 384);
    
    // Scribbles
    ctx.strokeStyle = '#2244aa';
    ctx.lineWidth = 2;
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#333';
    ctx.fillText('TODO:', 20, 30);
    ctx.fillText('✓ deploy v0.5', 20, 55);
    ctx.fillText('✓ fix camera snap', 20, 80);
    ctx.fillText('• v0.7 — ???', 20, 105);
    
    // Draw some arrows and boxes
    ctx.strokeStyle = '#cc3333';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(280, 40); ctx.lineTo(400, 40); ctx.lineTo(400, 100); ctx.stroke();
    ctx.beginPath(); ctx.rect(260, 130, 120, 60); ctx.stroke();
    ctx.fillStyle = '#cc3333';
    ctx.font = '14px sans-serif';
    ctx.fillText('SHIP IT', 290, 165);
    
    // Sticky note vibe
    ctx.fillStyle = '#ffee88';
    ctx.fillRect(320, 220, 100, 80);
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.fillText('Don\'t forget:', 328, 245);
    ctx.fillText('coffee ☕', 328, 265);
    
    const tex = new THREE.CanvasTexture(canvas);
    const board = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 2.25),
        new THREE.MeshBasicMaterial({ map: tex })
    );
    wb.add(board);
    
    // Frame
    const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.1, 2.35)),
        new THREE.LineBasicMaterial({ color: 0x888888 })
    );
    wb.add(frame);
    
    return wb;
}

// ── Poster ────────────────────────────────────────────────────
function createPoster(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 280;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, 200, 280);
    
    const col = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : '#4a9eff';
    ctx.fillStyle = col;
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        ctx.fillText(line, 100, 100 + i * 40);
    });
    
    // Border
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, 192, 272);
    
    const tex = new THREE.CanvasTexture(canvas);
    const poster = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 1.0),
        new THREE.MeshBasicMaterial({ map: tex })
    );
    return poster;
}

// ── Cable runs ────────────────────────────────────────────────
function createCableRun(height) {
    const cable = new THREE.Group();
    const colors = [0x333355, 0x4a9eff, 0x333355];
    
    colors.forEach((c, i) => {
        const geo = new THREE.CylinderGeometry(0.015, 0.015, height, 4);
        const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(i * 0.04 - 0.04, height / 2, 0);
        cable.add(mesh);
    });
    
    return cable;
}

// ── Floor cables ──────────────────────────────────────────────
function createFloorCable(length) {
    const points = [];
    const segments = 8;
    for (let i = 0; i <= segments; i++) {
        points.push(new THREE.Vector3(
            (i / segments) * length - length / 2,
            0,
            Math.sin(i * 0.8) * 0.15
        ));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, 20, 0.015, 4, false);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x222244, roughness: 0.8, metalness: 0.2,
    });
    return new THREE.Mesh(geo, mat);
}

// ── Server Rack ───────────────────────────────────────────────
function createServerRack() {
    const rack = new THREE.Group();
    
    const bodyGeo = new THREE.BoxGeometry(1.2, 3.2, 0.8);
    const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x111122, roughness: 0.6, metalness: 0.7,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.6;
    body.castShadow = true;
    rack.add(body);
    
    // Server units (visible from front)
    for (let i = 0; i < 7; i++) {
        const unit = new THREE.Mesh(
            new THREE.BoxGeometry(1.05, 0.32, 0.02),
            new THREE.MeshStandardMaterial({ color: 0x0a0a1a, metalness: 0.8, roughness: 0.3 })
        );
        unit.position.set(0, 0.35 + i * 0.4, 0.41);
        rack.add(unit);
        
        // Vent holes
        const ventGeo = new THREE.PlaneGeometry(0.5, 0.08);
        const vent = new THREE.Mesh(ventGeo, new THREE.MeshBasicMaterial({
            color: 0x050510, transparent: true, opacity: 0.8,
        }));
        vent.position.set(-0.15, 0.35 + i * 0.4, 0.42);
        rack.add(vent);
    }
    
    // Status LEDs
    const leds = [];
    const ledColors = [0x4ade80, 0x4a9eff, 0xffaa4a, 0x4ade80, 0x4a9eff, 0x4ade80, 0xffaa4a];
    for (let i = 0; i < ledColors.length; i++) {
        const led = new THREE.Mesh(
            new THREE.SphereGeometry(0.025, 8, 8),
            new THREE.MeshBasicMaterial({ color: ledColors[i], transparent: true, opacity: 0.9 })
        );
        led.position.set(0.42, 0.35 + i * 0.4, 0.42);
        if (window._enableBloom) window._enableBloom(led);
        rack.add(led);
        leds.push(led);
    }
    
    rack.userData.leds = leds;
    return rack;
}

// ── Couch ─────────────────────────────────────────────────────
function createCouch() {
    const couch = new THREE.Group();
    const couchMat = new THREE.MeshStandardMaterial({ color: 0x1a1a3a, roughness: 0.85, metalness: 0.1 });
    
    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 0.8), couchMat);
    seat.position.y = 0.35;
    couch.add(seat);
    
    // Back
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 0.2), couchMat);
    back.position.set(0, 0.65, -0.3);
    couch.add(back);
    
    // Arms
    [-1, 1].forEach(side => {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.45, 0.8), couchMat);
        arm.position.set(side * 1.0, 0.45, 0);
        couch.add(arm);
    });
    
    // Cushion accents
    const cushionMat = new THREE.MeshStandardMaterial({ color: 0x2a2a5a, roughness: 0.9, metalness: 0.05 });
    [-0.4, 0.4].forEach(x => {
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.6), cushionMat);
        cushion.position.set(x, 0.52, 0.05);
        couch.add(cushion);
    });
    
    // Little throw pillow
    const pillow = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.25, 0.15),
        new THREE.MeshStandardMaterial({ color: 0x4a3aff, roughness: 0.9 })
    );
    pillow.position.set(0.7, 0.6, 0.1);
    pillow.rotation.z = 0.3;
    couch.add(pillow);
    
    return couch;
}

// ── Coffee Table ──────────────────────────────────────────────
function createCoffeeTable() {
    const table = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.4, metalness: 0.6 });
    
    // Top
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.5), mat);
    top.position.set(0, 0.35, 0);
    table.add(top);
    
    // Legs
    const legGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.33, 6);
    [[-0.4, -0.2], [0.4, -0.2], [-0.4, 0.2], [0.4, 0.2]].forEach(([x, z]) => {
        const leg = new THREE.Mesh(legGeo, mat);
        leg.position.set(x, 0.165, z);
        table.add(leg);
    });
    
    return table;
}

// ── Coffee Mug ────────────────────────────────────────────────
function createCoffeeMug() {
    const mug = new THREE.Group();
    
    // Cup body
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.035, 0.08, 12),
        new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3, metalness: 0.1 })
    );
    body.position.y = 0.04;
    mug.add(body);
    
    // Coffee inside
    const coffee = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.01, 12),
        new THREE.MeshBasicMaterial({ color: 0x3a1a08 })
    );
    coffee.position.y = 0.075;
    mug.add(coffee);
    
    // Handle
    const handleGeo = new THREE.TorusGeometry(0.025, 0.006, 6, 12, Math.PI);
    const handle = new THREE.Mesh(handleGeo, body.material.clone());
    handle.position.set(0.055, 0.04, 0);
    handle.rotation.y = Math.PI / 2;
    mug.add(handle);
    
    // Steam particles
    const steam = new THREE.Group();
    for (let i = 0; i < 5; i++) {
        const particle = new THREE.Mesh(
            new THREE.SphereGeometry(0.008, 4, 4),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 })
        );
        particle.position.set((Math.random() - 0.5) * 0.04, 0.1 + Math.random() * 0.4, 0);
        steam.add(particle);
    }
    mug.add(steam);
    mug.userData.steam = steam;
    
    return mug;
}

// ── Folder Stack (Epstein Files) ──────────────────────────────
function createFolderStack() {
    const stack = new THREE.Group();
    
    // Create 3 manila folders stacked
    const folderMat = new THREE.MeshStandardMaterial({ 
        color: 0xd4a574, // Manila folder color
        roughness: 0.8, 
        metalness: 0.0 
    });
    
    for (let i = 0; i < 3; i++) {
        const folder = new THREE.Group();
        
        // Folder body
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.008, 0.15),
            folderMat
        );
        body.position.y = i * 0.012;
        folder.add(body);
        
        // Folder tab (slightly offset)
        const tab = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.008, 0.02),
            folderMat.clone()
        );
        tab.position.set(0, i * 0.012, 0.085);
        folder.add(tab);
        
        // Slight rotation for natural stack look
        folder.rotation.y = (Math.random() - 0.5) * 0.1;
        
        stack.add(folder);
    }
    
    // "EPSTEIN" label on top folder (red stamp effect)
    const labelGeo = new THREE.PlaneGeometry(0.08, 0.02);
    const labelMat = new THREE.MeshBasicMaterial({ 
        color: 0xcc0000,
        transparent: true,
        opacity: 0.8
    });
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.set(0, 0.04, 0);
    label.rotation.x = -Math.PI / 2;
    stack.add(label);
    
    return stack;
}

// ── Bookshelf ─────────────────────────────────────────────────
function createBookshelf() {
    const shelf = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.7, metalness: 0.3 });
    
    // Frame
    const shelfBack = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.0, 0.03), woodMat);
    shelfBack.position.set(0, 1.5, -0.15);
    shelf.add(shelfBack);
    
    const shelfLeft = new THREE.Mesh(new THREE.BoxGeometry(0.03, 3.0, 0.35), woodMat);
    shelfLeft.position.set(-0.585, 1.5, 0);
    shelf.add(shelfLeft);
    
    const shelfRight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 3.0, 0.35), woodMat);
    shelfRight.position.set(0.585, 1.5, 0);
    shelf.add(shelfRight);
    
    // Shelves
    for (let i = 0; i < 5; i++) {
        const shelfPlank = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.03, 0.35), woodMat);
        shelfPlank.position.set(0, 0.05 + i * 0.7, 0);
        shelf.add(shelfPlank);
    }
    
    // Books (colorful rectangles on shelves)
    const bookColors = [0x4a9eff, 0xff4444, 0x44ff88, 0xffaa44, 0x9944ff, 0xff44aa, 0x44aaff, 0xaaff44];
    for (let row = 0; row < 4; row++) {
        let x = -0.5;
        for (let b = 0; b < 4 + Math.floor(Math.random() * 3); b++) {
            const bw = 0.05 + Math.random() * 0.08;
            const bh = 0.4 + Math.random() * 0.25;
            const book = new THREE.Mesh(
                new THREE.BoxGeometry(bw, bh, 0.22),
                new THREE.MeshStandardMaterial({
                    color: bookColors[Math.floor(Math.random() * bookColors.length)],
                    roughness: 0.8, metalness: 0.05,
                })
            );
            book.position.set(x + bw / 2, 0.08 + row * 0.7 + bh / 2, 0);
            shelf.add(book);
            x += bw + 0.01;
            if (x > 0.5) break;
        }
    }
    
    return shelf;
}

// ── Hardware Workbench (Mac/laptop display rack) ──────────────
function createHardwareBench() {
    const bench = new THREE.Group();
    const metalMat = new THREE.MeshStandardMaterial({
        color: 0x444455, metalness: 0.8, roughness: 0.3,
    });
    const darkMat = new THREE.MeshStandardMaterial({
        color: 0x222233, metalness: 0.5, roughness: 0.5,
    });
    
    // Bench table (industrial style, slightly wider than a desk)
    const tableTop = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, 0.06, 1.0), metalMat
    );
    tableTop.position.y = 0.8;
    bench.add(tableTop);
    
    // Legs (4 metal legs)
    const legGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8);
    [[-1.4, 0.4, -0.45], [1.4, 0.4, -0.45], [-1.4, 0.4, 0.45], [1.4, 0.4, 0.45]].forEach(pos => {
        const leg = new THREE.Mesh(legGeo, metalMat);
        leg.position.set(...pos);
        bench.add(leg);
    });
    
    // Back panel / pegboard
    const backPanel = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, 1.8, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x1a1a2a, roughness: 0.9 })
    );
    backPanel.position.set(0, 1.7, -0.5);
    bench.add(backPanel);
    
    // Upper shelf
    const upperShelf = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, 0.04, 0.6), metalMat
    );
    upperShelf.position.set(0, 1.6, -0.2);
    bench.add(upperShelf);
    
    // ── Device displays (dynamic from config) ──────────────────
    // Hardware bench devices are loaded from devices-config.json via server API
    // Labels and positions are set dynamically in public/app.js
    // This keeps room.js deployment-ready without hardcoded names
    
    // Status LEDs (3 generic positions)
    const ledPositions = [[-1.0, 0x4a9eff], [0.0, 0x4ade80], [1.0, 0xffaa4a]];
    ledPositions.forEach(([x, color]) => {
        const led = new THREE.Mesh(
            new THREE.SphereGeometry(0.025, 8, 8),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
        );
        led.position.set(x, 0.84, 0.35);
        if (window._enableBloom) window._enableBloom(led);
        bench.add(led);
    });
    
    // Some cables draped between devices
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    [[-0.5, 0.82, 0.2], [0.5, 0.82, 0.2]].forEach(pos => {
        const cable = new THREE.Mesh(
            new THREE.CylinderGeometry(0.01, 0.01, 0.6, 6),
            cableMat
        );
        cable.position.set(...pos);
        cable.rotation.z = Math.PI / 2;
        bench.add(cable);
    });
    
    return bench;
}

export function createMacDevice(type, monitors = []) {
    const device = new THREE.Group();
    const silverMat = new THREE.MeshStandardMaterial({
        color: 0x888899, metalness: 0.9, roughness: 0.15,
    });
    
    if (type === 'tower') {
        // Mac Studio / Mac Mini style — rounded box
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.12, 0.25), silverMat
        );
        body.position.y = 0.06;
        device.add(body);
        
        // Front LED indicator
        const frontLed = new THREE.Mesh(
            new THREE.CircleGeometry(0.01, 8),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
        );
        frontLed.position.set(0, 0.03, 0.126);
        if (window._enableBloom) window._enableBloom(frontLed);
        device.add(frontLed);
    }
        
    // Add multiple monitors (works for tower OR monitors-only type)
    if ((type === 'tower' || type === 'monitors-only') && monitors && monitors.length > 0) {
            const monitorWidth = 0.60;  // Even wider
            const monitorHeight = 0.40; // Even taller
            const monitorSpacing = 0.15;
            const shelfY = 1.6; // Upper shelf height
            const shelfThickness = 0.04;
            const totalWidth = (monitorWidth * monitors.length) + (monitorSpacing * (monitors.length - 1));
            const startX = -totalWidth / 2;
            
            monitors.forEach((monConfig, i) => {
                const xOffset = startX + (i * (monitorWidth + monitorSpacing)) + (monitorWidth / 2);
                
                // Monitor stand (sits on shelf BEHIND screen, not in front)
                const standGeo = new THREE.BoxGeometry(0.06, 0.03, 0.06);
                const standMat = new THREE.MeshStandardMaterial({ color: 0x444455, metalness: 0.7, roughness: 0.3 });
                const stand = new THREE.Mesh(standGeo, standMat);
                // Sit on TOP of shelf: shelfY + shelfThickness/2 + stand height/2
                // Device at 0.83, Shelf top at 1.62. Relative Y = 0.805
                stand.position.set(xOffset, 0.805, -0.15); // Behind the screen
                device.add(stand);
                
                // Monitor arm (short vertical support behind screen, from stand to monitor)
                const armHeight = monitorHeight / 2 + 0.02;
                const armGeo = new THREE.CylinderGeometry(0.008, 0.008, armHeight, 8);
                const arm = new THREE.Mesh(armGeo, standMat);
                // Arm base sits on stand, extends up
                arm.position.set(xOffset, 0.82 + armHeight/2, -0.15);
                device.add(arm);
                
                // Monitor screen backing - sits on shelf, center aligned with arm top
                const screenY = 0.82 + armHeight;
                const screenGeo = new THREE.BoxGeometry(monitorWidth, monitorHeight, 0.02);
                const screenMat = new THREE.MeshBasicMaterial({
                    color: 0x0a0a2a, transparent: true, opacity: 0.95,
                });
                const screen = new THREE.Mesh(screenGeo, screenMat);
                screen.position.set(xOffset, screenY, -0.22);
                screen.userData.monitorIndex = i;
                screen.userData.monitorUrl = monConfig.url;
                screen.userData.monitorLabel = monConfig.label;
                screen.userData.interactive = 'hw-monitor';
                screen.name = `monitor-${i}`;
                device.add(screen);
                
                // Screen bezel
                const bezel = new THREE.Mesh(
                    new THREE.BoxGeometry(monitorWidth + 0.015, monitorHeight + 0.015, 0.01),
                    new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.8, roughness: 0.2 })
                );
                bezel.position.set(xOffset, screenY, -0.225);
                device.add(bezel);
                
                // Screen content with label
                const glowCanvas = document.createElement('canvas');
                glowCanvas.width = 128;
                glowCanvas.height = 96;
                const gctx = glowCanvas.getContext('2d');
                gctx.fillStyle = '#060618';
                gctx.fillRect(0, 0, 128, 96);
                
                // Draw icon and label
                gctx.fillStyle = '#4a9eff';
                gctx.font = 'bold 20px monospace';
                const emoji = monConfig.label.split(' ')[0]; // Get emoji
                gctx.fillText(emoji, 50, 40);
                
                gctx.fillStyle = '#8899ff';
                gctx.font = '9px monospace';
                const labelText = monConfig.label.substring(emoji.length + 1);
                const words = labelText.split(' ');
                let y = 60;
                words.forEach(word => {
                    const x = 64 - (word.length * 2.5);
                    gctx.fillText(word, x, y);
                    y += 11;
                });
                
                const screenTex = new THREE.CanvasTexture(glowCanvas);
                const screenFace = new THREE.Mesh(
                    new THREE.PlaneGeometry(monitorWidth - 0.02, monitorHeight - 0.02),
                    new THREE.MeshBasicMaterial({ map: screenTex })
                );
                screenFace.position.set(xOffset, screenY, -0.209);
                screenFace.userData.interactive = 'hw-monitor';
                screenFace.userData.monitorIndex = i;
                screenFace.userData.monitorUrl = monConfig.url;
                screenFace.userData.monitorLabel = monConfig.label;
                device.add(screenFace);
            });
        } else {
            // Default single monitor (old behavior)
            const screenGeo = new THREE.BoxGeometry(0.35, 0.25, 0.02);
            const screenMat = new THREE.MeshBasicMaterial({
                color: 0x0a0a2a, transparent: true, opacity: 0.95,
            });
            const screen = new THREE.Mesh(screenGeo, screenMat);
            screen.position.set(0, 0.28, -0.15);
            device.add(screen);
            
            // Screen bezel
            const bezel = new THREE.Mesh(
                new THREE.BoxGeometry(0.37, 0.27, 0.015),
                new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.8, roughness: 0.2 })
            );
            bezel.position.set(0, 0.28, -0.155);
            device.add(bezel);
            
            // Screen content glow
            const glowCanvas = document.createElement('canvas');
            glowCanvas.width = 64;
            glowCanvas.height = 48;
            const gctx = glowCanvas.getContext('2d');
            gctx.fillStyle = '#060618';
            gctx.fillRect(0, 0, 64, 48);
            gctx.fillStyle = '#4a9eff';
            gctx.font = '8px monospace';
            gctx.fillText('$ _', 4, 20);
            gctx.fillStyle = '#333355';
            for (let i = 0; i < 5; i++) {
                gctx.fillRect(4, 26 + i * 4, 20 + Math.random() * 30, 2);
            }
            const screenTex = new THREE.CanvasTexture(glowCanvas);
            const screenFace = new THREE.Mesh(
                new THREE.PlaneGeometry(0.33, 0.23),
                new THREE.MeshBasicMaterial({ map: screenTex })
            );
            screenFace.position.set(0, 0.28, -0.139);
            device.add(screenFace);
        }
    
    if (type === 'laptop') {
        // Laptop — base + angled screen
        const base = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.02, 0.28), silverMat
        );
        base.position.y = 0.01;
        device.add(base);
        
        // Keyboard area (darker)
        const keyboard = new THREE.Mesh(
            new THREE.PlaneGeometry(0.3, 0.18),
            new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 })
        );
        keyboard.rotation.x = -Math.PI / 2;
        keyboard.position.set(0, 0.021, 0.02);
        device.add(keyboard);
        
        // Screen (angled)
        const screenGroup = new THREE.Group();
        const lscreen = new THREE.Mesh(
            new THREE.BoxGeometry(0.38, 0.26, 0.01), silverMat.clone()
        );
        screenGroup.add(lscreen);
        
        const lscreenFace = new THREE.Mesh(
            new THREE.PlaneGeometry(0.34, 0.22),
            new THREE.MeshBasicMaterial({ color: 0x0a0a2a })
        );
        lscreenFace.position.z = 0.006;
        screenGroup.add(lscreenFace);
        
        // Terminal text on laptop screen
        const lCanvas = document.createElement('canvas');
        lCanvas.width = 64;
        lCanvas.height = 48;
        const lctx = lCanvas.getContext('2d');
        lctx.fillStyle = '#060618';
        lctx.fillRect(0, 0, 64, 48);
        lctx.fillStyle = '#ffaa4a';
        lctx.font = '8px monospace';
        lctx.fillText('user@host:~$', 2, 12);
        const lTex = new THREE.CanvasTexture(lCanvas);
        const lFace = new THREE.Mesh(
            new THREE.PlaneGeometry(0.34, 0.22),
            new THREE.MeshBasicMaterial({ map: lTex })
        );
        lFace.position.z = 0.007;
        screenGroup.add(lFace);
        
        screenGroup.position.set(0, 0.15, -0.13);
        screenGroup.rotation.x = -0.2;  // slight angle
        device.add(screenGroup);
    }
    
    return device;
}

function createDeviceLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.textAlign = 'center';
    ctx.fillText(text, 128, 32);
    
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9 })
    );
    sprite.scale.set(1.0, 0.2, 1);
    return sprite;
}

// ── Trash Can ─────────────────────────────────────────────────
// (createTrashCan moved to bottom with other new furnishing functions)

// ── Potted Plant ──────────────────────────────────────────────
function createPottedPlant() {
    const plant = new THREE.Group();
    
    // Pot
    const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.14, 0.25, 12),
        new THREE.MeshStandardMaterial({ color: 0x664433, roughness: 0.85, metalness: 0.05 })
    );
    pot.position.y = 0.125;
    plant.add(pot);
    
    // Dirt
    const dirt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.17, 0.03, 12),
        new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.95 })
    );
    dirt.position.y = 0.24;
    plant.add(dirt);
    
    // Leaves (simple cones and spheres for a small bush)
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2a8a4a, roughness: 0.8 });
    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const leaf = new THREE.Mesh(
            new THREE.ConeGeometry(0.08, 0.25, 6),
            leafMat
        );
        leaf.position.set(
            Math.cos(angle) * 0.08,
            0.4 + Math.random() * 0.15,
            Math.sin(angle) * 0.08
        );
        leaf.rotation.x = (Math.random() - 0.5) * 0.4;
        leaf.rotation.z = (Math.random() - 0.5) * 0.4;
        plant.add(leaf);
    }
    
    // Center tall leaf
    const tall = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.35, 6), leafMat);
    tall.position.y = 0.5;
    plant.add(tall);
    
    return plant;
}

// ── Standing Fan ──────────────────────────────────────────────
function createStandingFan() {
    const fan = new THREE.Group();
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.8, roughness: 0.3 });
    
    // Base
    const fanBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 16), metalMat);
    fanBase.position.set(0, 0.025, 0);
    fan.add(fanBase);
    
    // Pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8), metalMat);
    pole.position.set(0, 0.65, 0);
    fan.add(pole);
    
    // Motor housing
    const motor = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), metalMat);
    motor.position.set(0, 1.25, 0);
    fan.add(motor);
    
    // Blades group — flat paddles radiating from center hub
    const blades = new THREE.Group();
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x555566, transparent: true, opacity: 0.7 });
    for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2;
        const blade = new THREE.Mesh(
            new THREE.BoxGeometry(0.28, 0.015, 0.06),
            bladeMat
        );
        // Position blade center halfway along its length, radiating outward
        blade.position.set(Math.cos(angle) * 0.14, Math.sin(angle) * 0.14, 0);
        blade.rotation.z = angle;
        blades.add(blade);
    }
    blades.position.set(0, 1.25, 0.1);
    // Blades spin around Z axis (facing forward)
    fan.add(blades);
    fan.userData.blades = blades;
    
    // Cage (wire frame circle)
    const cage = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.005, 4, 24),
        new THREE.MeshBasicMaterial({ color: 0x555566, transparent: true, opacity: 0.5 })
    );
    cage.position.set(0, 1.25, 0.12);
    fan.add(cage);
    
    return fan;
}

// ── Wall Clock ────────────────────────────────────────────────
function createWallClock() {
    const clock = new THREE.Group();
    
    // Face
    const face = new THREE.Mesh(
        new THREE.CircleGeometry(0.3, 32),
        new THREE.MeshBasicMaterial({ color: 0x111122 })
    );
    clock.add(face);
    
    // Rim
    const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.015, 8, 32),
        new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.8, roughness: 0.3 })
    );
    clock.add(rim);
    
    // Hour markers
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const marker = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, 0.04, 0.005),
            new THREE.MeshBasicMaterial({ color: ROOM.accentColor })
        );
        marker.position.set(Math.sin(a) * 0.24, Math.cos(a) * 0.24, 0.01);
        marker.rotation.z = -a;
        clock.add(marker);
    }
    
    // Hour hand
    const hourHand = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, 0.14, 0.005),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    hourHand.geometry.translate(0, 0.07, 0);
    clock.add(hourHand);
    
    // Minute hand
    const minuteHand = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, 0.2, 0.005),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    minuteHand.geometry.translate(0, 0.1, 0);
    minuteHand.position.z = 0.005;
    clock.add(minuteHand);
    
    // Second hand
    const secondHand = new THREE.Mesh(
        new THREE.BoxGeometry(0.005, 0.22, 0.005),
        new THREE.MeshBasicMaterial({ color: ROOM.dangerRed })
    );
    secondHand.geometry.translate(0, 0.11, 0);
    secondHand.position.z = 0.01;
    clock.add(secondHand);
    
    // Center cap
    const cap = new THREE.Mesh(
        new THREE.CircleGeometry(0.015, 12),
        new THREE.MeshBasicMaterial({ color: ROOM.accentColor })
    );
    cap.position.z = 0.015;
    clock.add(cap);
    
    clock.userData = { hourHand, minuteHand, secondHand };
    return clock;
}

// ── Pizza Box Stack ───────────────────────────────────────────
function createPizzaBoxStack() {
    const stack = new THREE.Group();
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xc4a46a, roughness: 0.95, metalness: 0.0 });
    
    for (let i = 0; i < 3; i++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.4), boxMat);
        box.position.y = 0.02 + i * 0.045;
        box.rotation.y = i * 0.15; // slightly askew
        stack.add(box);
    }
    
    return stack;
}

// ── Mini Fridge ───────────────────────────────────────────────
function createMiniFridge() {
    const fridge = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 0.3, metalness: 0.7 });
    
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.45), mat);
    body.position.y = 0.35;
    fridge.add(body);
    
    // Door handle
    const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.15, 0.03),
        new THREE.MeshStandardMaterial({ color: 0x444455, metalness: 0.9, roughness: 0.2 })
    );
    handle.position.set(0.2, 0.45, 0.24);
    fridge.add(handle);
    
    // Status LED
    const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 6, 6),
        new THREE.MeshBasicMaterial({ color: ROOM.accentColor, transparent: true, opacity: 0.8 })
    );
    led.position.set(-0.15, 0.6, 0.24);
    fridge.add(led);
    fridge.userData.led = led;
    
    // Brand label
    const label = createTinyLabel('CLAW COOL', ROOM.accentColor);
    label.position.set(0, 0.55, 0.235);
    fridge.add(label);
    
    return fridge;
}

// ── Tiny text label helper ────────────────────────────────────
function createTinyLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : '#4a9eff';
    ctx.textAlign = 'center';
    ctx.fillText(text, 64, 22);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.7 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.5, 0.12, 1);
    return sprite;
}

// ── Side Table ────────────────────────────────────────────────
function createSideTable() {
    const table = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.5, metalness: 0.5 });
    
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.4), mat);
    top.position.y = 0.55;
    table.add(top);
    
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.53, 6), mat);
    leg.position.y = 0.265;
    table.add(leg);
    
    // Keyboard on top
    const kb = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.015, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.4, metalness: 0.6 })
    );
    kb.position.set(0, 0.575, 0);
    table.add(kb);
    
    // Mouse
    const mouse = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.02, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.3, metalness: 0.7 })
    );
    mouse.position.set(0.22, 0.57, 0);
    table.add(mouse);
    
    return table;
}

// ── Kanban Board ──────────────────────────────────────────────
function createKanbanBoard() {
    const board = new THREE.Group();
    
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');
    
    // Initial draw (placeholder until real data loads)
    drawKanban(ctx, null);
    
    const tex = new THREE.CanvasTexture(canvas);
    const boardMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 2.25),
        new THREE.MeshBasicMaterial({ map: tex })
    );
    board.add(boardMesh);
    
    const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.1, 2.35)),
        new THREE.LineBasicMaterial({ color: 0x4a9eff, transparent: true, opacity: 0.3 })
    );
    board.add(frame);
    
    board.userData.canvas = canvas;
    board.userData.ctx = ctx;
    board.userData.tex = tex;
    board.userData.lastHash = '';
    
    return board;
}

function drawKanban(ctx, data) {
    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(0, 0, 512, 384);
    
    const cols = (data && data.columns) ? data.columns : [
        { name: 'BACKLOG', color: '#ff6b6b', cards: [] },
        { name: 'TODO', color: '#ffaa4a', cards: [] },
        { name: 'DOING', color: '#44aaff', cards: [] },
        { name: 'DONE', color: '#4ade80', cards: [] }
    ];
    
    const colW = 124; // 512/4
    
    cols.forEach((col, i) => {
        const x = 10 + i * colW;
        ctx.fillStyle = col.color || '#888';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(col.name, x, 25);
        
        if (i > 0) {
            ctx.strokeStyle = '#222';
            ctx.beginPath();
            ctx.moveTo(x - 6, 35);
            ctx.lineTo(x - 6, 380);
            ctx.stroke();
        }
        
        const cards = col.cards || [];
        // If no data, show fake placeholder ONLY on first load (when data is null)
        const displayCards = (!data && i === 0) 
            ? [{ text: 'Loading...' }, { text: 'Waiting for data...' }] 
            : cards.slice(0, 6); // Limit to ~6 cards per col visually
            
        displayCards.forEach((card, c) => {
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fillRect(x, 40 + c * 55, colW - 14, 45);
            ctx.strokeStyle = (col.color || '#888') + '44';
            ctx.strokeRect(x, 40 + c * 55, colW - 14, 45);
            
            ctx.fillStyle = '#aaa';
            ctx.font = '9px monospace';
            const text = (card.text || card.title || '???').slice(0, 20);
            ctx.fillText(text, x + 4, 58 + c * 55);
            
            if (card.tag) {
                ctx.fillStyle = '#666';
                ctx.font = '8px monospace';
                ctx.fillText(card.tag, x + 4, 76 + c * 55);
            }
        });
    });
}

// ── Lava Lamp ─────────────────────────────────────────────────
function createLavaLamp() {
    const lamp = new THREE.Group();
    
    const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.06, 0.04, 12),
        new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.7, roughness: 0.3 })
    );
    lamp.add(base);
    
    const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.04, 0.3, 12),
        new THREE.MeshPhysicalMaterial({
            color: 0x1a0a3a, transparent: true, opacity: 0.4,
            roughness: 0.1, metalness: 0.0,
        })
    );
    glass.position.y = 0.17;
    lamp.add(glass);
    
    const blobs = [];
    const blobColors = [0xff4488, 0xff6644, 0xff44aa];
    for (let i = 0; i < 3; i++) {
        const blob = new THREE.Mesh(
            new THREE.SphereGeometry(0.015 + Math.random() * 0.01, 8, 8),
            new THREE.MeshBasicMaterial({ color: blobColors[i], transparent: true, opacity: 0.8 })
        );
        blob.position.set(0, 0.1 + i * 0.08, 0);
        lamp.add(blob);
        blobs.push(blob);
    }
    
    const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.7, roughness: 0.3 })
    );
    cap.position.y = 0.32;
    lamp.add(cap);
    
    const glow = new THREE.PointLight(0xff4488, 0.2, 2);
    glow.position.y = 0.15;
    lamp.add(glow);
    
    lamp.userData.blobs = blobs;
    return lamp;
}

// ── Headphones ────────────────────────────────────────────────
function createHeadphones() {
    const hp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.3, metalness: 0.7 });
    
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.01, 8, 24, Math.PI), mat);
    band.position.y = 0.1;
    hp.add(band);
    
    [-1, 1].forEach(side => {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), mat);
        cup.position.set(side * 0.1, 0, 0);
        cup.rotation.z = Math.PI / 2;
        hp.add(cup);
        
        const cushion = new THREE.Mesh(
            new THREE.TorusGeometry(0.04, 0.015, 8, 16),
            new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.9 })
        );
        cushion.position.set(side * 0.1, 0, 0);
        cushion.rotation.y = Math.PI / 2;
        hp.add(cushion);
    });
    
    return hp;
}

// ── Drone ─────────────────────────────────────────────────────
function createDrone() {
    const drone = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.3, metalness: 0.8 });
    
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), mat);
    drone.add(body);
    
    const propellers = [];
    for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const x = Math.cos(angle) * 0.18;
        const z = Math.sin(angle) * 0.18;
        
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.02), mat);
        arm.rotation.y = angle;
        arm.position.set(x / 2, 0, z / 2);
        drone.add(arm);
        
        const prop = new THREE.Mesh(
            new THREE.BoxGeometry(0.15, 0.005, 0.02),
            new THREE.MeshBasicMaterial({ color: 0x4a9eff, transparent: true, opacity: 0.5 })
        );
        prop.position.set(x, 0.03, z);
        drone.add(prop);
        propellers.push(prop);
    }
    
    const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    eye.position.set(0, -0.01, 0.1);
    drone.add(eye);
    
    drone.userData.propellers = propellers;
    return drone;
}

// ── Neon Sign ─────────────────────────────────────────────────
function createNeonSign(text) {
    const sign = new THREE.Group();
    
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    ctx.font = 'bold 36px monospace';
    ctx.fillStyle = '#ff6b2b';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff6b2b';
    ctx.shadowBlur = 20;
    ctx.fillText(text, 256, 44);
    ctx.shadowBlur = 10;
    ctx.fillText(text, 256, 44);
    
    const tex = new THREE.CanvasTexture(canvas);
    const textMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(4, 0.5),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9 })
    );
    sign.add(textMesh);
    
    const glow = new THREE.PointLight(0xff6b2b, 0.4, 6);
    glow.position.z = 0.3;
    sign.add(glow);
    
    sign.userData.textMesh = textMesh;
    return sign;
}

// ── Energy Drink Can ──────────────────────────────────────────
function createEnergyDrinkCan() {
    const can = new THREE.Group();
    
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.09, 8),
        new THREE.MeshStandardMaterial({ color: 0x22aa44, roughness: 0.3, metalness: 0.7 })
    );
    body.position.y = 0.045;
    can.add(body);
    
    const top = new THREE.Mesh(
        new THREE.CylinderGeometry(0.023, 0.025, 0.005, 8),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 })
    );
    top.position.y = 0.09;
    can.add(top);
    
    return can;
}

// ── Sticky Note ───────────────────────────────────────────────
function createStickyNote(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    const col = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : '#ffee44';
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, 64, 64);
    
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.fillText(text, 32, 38);
    
    const tex = new THREE.CanvasTexture(canvas);
    return new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, 0.2),
        new THREE.MeshBasicMaterial({ map: tex })
    );
}

// ── Router ────────────────────────────────────────────────────
function createRouter() {
    const router = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.4, metalness: 0.6 });
    
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.2), mat);
    body.position.y = 0.03;
    router.add(body);
    
    for (let i = 0; i < 2; i++) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 4), mat);
        ant.position.set(-0.08 + i * 0.16, 0.16, 0);
        ant.rotation.z = (i === 0 ? 0.15 : -0.15);
        router.add(ant);
    }
    
    const leds = [];
    for (let i = 0; i < 4; i++) {
        const led = new THREE.Mesh(
            new THREE.SphereGeometry(0.008, 4, 4),
            new THREE.MeshBasicMaterial({
                color: [0x4ade80, 0x4a9eff, 0xffaa4a, 0x4ade80][i],
                transparent: true, opacity: 0.9,
            })
        );
        led.position.set(-0.06 + i * 0.04, 0.065, 0.1);
        router.add(led);
        leds.push(led);
    }
    
    router.userData.leds = leds;
    return router;
}

// ── Floor Lamp ────────────────────────────────────────────────
function createFloorLamp() {
    const lamp = new THREE.Group();
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.8, roughness: 0.3 });
    
    // Base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.04, 16), metalMat);
    base.position.y = 0.02;
    lamp.add(base);
    
    // Pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8, 8), metalMat);
    pole.position.y = 0.94;
    lamp.add(pole);
    
    // Shade (conical)
    const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 0.25, 16, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.6, side: THREE.DoubleSide })
    );
    shade.position.y = 1.85;
    shade.rotation.x = Math.PI; // cone opens downward
    lamp.add(shade);
    
    // Bulb glow (visible inside shade)
    const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffa54a })
    );
    bulb.position.y = 1.78;
    lamp.add(bulb);
    
    // Actual light
    const light = new THREE.PointLight(0xffa54a, 1.5, 12);
    light.position.y = 1.75;
    lamp.add(light);
    
    return lamp;
}

// ══════════════════════════════════════════════════════════════
// ADDITIONAL FURNISHING CREATION FUNCTIONS
// ══════════════════════════════════════════════════════════════

// ── Tall Plant (floor standing, ~1.5m) ────────────────────────
function createTallPlant() {
    const plant = new THREE.Group();
    // Pot
    const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.15, 0.35, 8),
        new THREE.MeshStandardMaterial({ color: 0x553322, roughness: 0.9 })
    );
    pot.position.y = 0.175;
    plant.add(pot);
    // Dirt
    const dirt = new THREE.Mesh(
        new THREE.CircleGeometry(0.18, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a2a1a })
    );
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.y = 0.35;
    plant.add(dirt);
    // Trunk
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.05, 0.8, 6),
        new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.9 })
    );
    trunk.position.y = 0.75;
    plant.add(trunk);
    // Foliage clusters
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2a6630, roughness: 0.8 });
    const leafPositions = [[0, 1.2, 0], [0.15, 1.1, 0.1], [-0.12, 1.15, -0.1], [0.08, 1.3, -0.08], [-0.1, 1.25, 0.12]];
    leafPositions.forEach(pos => {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), leafMat);
        leaf.position.set(...pos);
        leaf.scale.y = 0.7;
        plant.add(leaf);
    });
    return plant;
}

// ── Small Plant (tabletop / floor, ~0.4m) ─────────────────────
function createSmallPlant() {
    const plant = new THREE.Group();
    const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.06, 0.12, 8),
        new THREE.MeshStandardMaterial({ color: 0x664433, roughness: 0.9 })
    );
    pot.position.y = 0.06;
    plant.add(pot);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3a7744, roughness: 0.8 });
    for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 5), leafMat);
        const a = (i / 5) * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 0.06, 0.18 + Math.random() * 0.06, Math.sin(a) * 0.06);
        plant.add(leaf);
    }
    return plant;
}

// ── Hanging Plant ─────────────────────────────────────────────
function createHangingPlant() {
    const plant = new THREE.Group();
    // Chain/rope
    const rope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4),
        new THREE.MeshStandardMaterial({ color: 0x554433, roughness: 0.9 })
    );
    rope.position.y = 0.3;
    plant.add(rope);
    // Pot
    const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.08, 0.1, 8),
        new THREE.MeshStandardMaterial({ color: 0x553322, roughness: 0.9 })
    );
    plant.add(pot);
    // Trailing vines
    const vineMat = new THREE.MeshStandardMaterial({ color: 0x2a7735, roughness: 0.8 });
    for (let i = 0; i < 6; i++) {
        const vine = new THREE.Mesh(
            new THREE.CylinderGeometry(0.008, 0.005, 0.3 + Math.random() * 0.3, 4),
            vineMat
        );
        const a = (i / 6) * Math.PI * 2;
        vine.position.set(Math.cos(a) * 0.1, -0.2 - Math.random() * 0.1, Math.sin(a) * 0.1);
        vine.rotation.x = (Math.random() - 0.5) * 0.3;
        vine.rotation.z = (Math.random() - 0.5) * 0.3;
        plant.add(vine);
        // Leaf at end
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 4), vineMat);
        leaf.position.set(vine.position.x, vine.position.y - 0.2, vine.position.z);
        plant.add(leaf);
    }
    return plant;
}

// ── Bean Bag Chair ────────────────────────────────────────────
function createBeanBag(color) {
    const bag = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 12, 8),
        new THREE.MeshStandardMaterial({ color, roughness: 0.95 })
    );
    body.scale.set(1, 0.6, 1);
    body.position.y = 0.3;
    bag.add(body);
    // Squish detail
    const indent = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 8, 6),
        new THREE.MeshStandardMaterial({ color, roughness: 0.95 })
    );
    indent.position.set(0, 0.45, 0.1);
    indent.scale.set(1, 0.4, 0.8);
    bag.add(indent);
    return bag;
}

// ── Corkboard (with pinned items) ─────────────────────────────
function createCorkboard() {
    const board = new THREE.Group();
    // Board backing
    const backing = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 1.2, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x8a6633, roughness: 0.95 })
    );
    board.add(backing);
    // Frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x443322, roughness: 0.8 });
    [[-0.9, 0], [0.9, 0]].forEach(([x]) => {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.24, 0.06), frameMat);
        side.position.set(x, 0, 0.01);
        board.add(side);
    });
    [[0, 0.6], [0, -0.6]].forEach(([, y]) => {
        const side = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.04, 0.06), frameMat);
        side.position.set(0, y, 0.01);
        board.add(side);
    });
    // Pinned items (colorful cards)
    const pinColors = [0xff6666, 0x66ff66, 0x6666ff, 0xffff66, 0xff66ff];
    for (let i = 0; i < 5; i++) {
        const card = new THREE.Mesh(
            new THREE.PlaneGeometry(0.25, 0.2),
            new THREE.MeshBasicMaterial({ color: pinColors[i], transparent: true, opacity: 0.7 })
        );
        card.position.set(-0.5 + i * 0.3 + (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.4, 0.03);
        card.rotation.z = (Math.random() - 0.5) * 0.2;
        board.add(card);
        // Pin
        const pin = new THREE.Mesh(
            new THREE.SphereGeometry(0.02, 6, 6),
            new THREE.MeshBasicMaterial({ color: 0xff2222 })
        );
        pin.position.set(card.position.x, card.position.y + 0.08, 0.04);
        board.add(pin);
    }
    return board;
}

// ── Coat Rack ─────────────────────────────────────────────────
function createCoatRack() {
    const rack = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.7, roughness: 0.3 });
    // Pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.8, 8), poleMat);
    pole.position.y = 0.9;
    rack.add(pole);
    // Base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.03, 12), poleMat);
    base.position.y = 0.015;
    rack.add(base);
    // Hooks
    for (let i = 0; i < 4; i++) {
        const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 4), poleMat);
        const a = (i / 4) * Math.PI * 2;
        hook.position.set(Math.cos(a) * 0.08, 1.7, Math.sin(a) * 0.08);
        hook.rotation.z = Math.cos(a) * 0.5;
        hook.rotation.x = Math.sin(a) * 0.5;
        rack.add(hook);
    }
    // A hoodie draped on one hook
    const hoodie = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0x1a1a3a, roughness: 0.95 })
    );
    hoodie.scale.set(1, 1.5, 0.5);
    hoodie.position.set(0.1, 1.5, 0);
    rack.add(hoodie);
    return rack;
}

// ── Wall Art (framed emoji/icon) ──────────────────────────────
// ── Video Wall (plays mp4 on a wall-mounted screen) ───────────
function createVideoWall(videoSrc) {
    const group = new THREE.Group();
    
    // Video is portrait 464x688 (0.674 ratio) — scale to fit wall nicely
    const H = 2.8, W = H * (464 / 688); // ~1.89 wide x 2.8 tall
    
    // Frame (dark metal)
    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(W + 0.15, H + 0.15, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x111122, metalness: 0.8, roughness: 0.3 })
    );
    group.add(frame);
    
    // LED accent strip around frame
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x4a9eff, transparent: true, opacity: 0.6 });
    const topStrip = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.02, 0.02), stripMat);
    topStrip.position.set(0, H / 2 + 0.06, 0.02);
    group.add(topStrip);
    const botStrip = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.02, 0.02), stripMat.clone());
    botStrip.position.set(0, -H / 2 - 0.06, 0.02);
    group.add(botStrip);
    if (window._enableBloom) {
        window._enableBloom(topStrip);
        window._enableBloom(botStrip);
    }
    
    // Create HTML video element
    const video = document.createElement('video');
    video.src = videoSrc;
    video.crossOrigin = 'anonymous';
    video.loop = false;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    
    // Video texture
    const videoTex = new THREE.VideoTexture(video);
    videoTex.minFilter = THREE.LinearFilter;
    videoTex.magFilter = THREE.LinearFilter;
    
    const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(W, H),
        new THREE.MeshBasicMaterial({ map: videoTex, toneMapped: false })
    );
    screen.position.z = 0.035;
    group.add(screen);
    
    // State machine: play N loops, then freeze on a frame
    let loopCount = 0;
    const MAX_LOOPS = 3;
    let frozen = false;
    
    // Start playing once loaded
    video.addEventListener('loadeddata', () => {
        video.play().catch(() => {});
    });
    
    video.addEventListener('ended', () => {
        loopCount++;
        if (loopCount < MAX_LOOPS) {
            video.currentTime = 0;
            video.play().catch(() => {});
        } else if (!frozen) {
            // Freeze on a nice frame (25% through the video)
            frozen = true;
            video.currentTime = video.duration * 0.25;
            // Update texture one last time
            setTimeout(() => { videoTex.needsUpdate = true; }, 100);
        }
    });
    
    // Also handle autoplay blocking — try playing on first user interaction
    const tryPlay = () => {
        if (!frozen && video.paused) video.play().catch(() => {});
    };
    document.addEventListener('click', tryPlay, { once: true });
    document.addEventListener('keydown', tryPlay, { once: true });
    
    group.userData.video = video;
    group.userData.videoTexture = videoTex;
    group.userData.interactive = 'video-wall';
    
    return group;
}

function createWallArt(emoji, borderColor) {
    const art = new THREE.Group();
    // Frame
    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.04),
        new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.6, roughness: 0.3 })
    );
    art.add(frame);
    // Inner mat
    const mat = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x0a0a15 })
    );
    mat.position.z = 0.021;
    art.add(mat);
    // Canvas with emoji
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a15';
    ctx.fillRect(0, 0, 128, 128);
    ctx.font = '64px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const face = new THREE.Mesh(
        new THREE.PlaneGeometry(0.65, 0.65),
        new THREE.MeshBasicMaterial({ map: tex })
    );
    face.position.z = 0.022;
    art.add(face);
    // Accent light below frame
    const accent = new THREE.PointLight(borderColor, 0.3, 2);
    accent.position.set(0, -0.6, 0.2);
    art.add(accent);
    return art;
}

// ── Wall Shelf (with knick-knacks) ────────────────────────────
function createWallShelf() {
    const shelf = new THREE.Group();
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.5, roughness: 0.4 });
    // Shelf plank
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.04, 0.25), shelfMat);
    shelf.add(plank);
    // Brackets
    [-0.8, 0.8].forEach(x => {
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.2), shelfMat);
        bracket.position.set(x, -0.1, 0);
        shelf.add(bracket);
    });
    // Items on shelf
    // Small trophy
    const trophy = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.05, 0.15, 6),
        new THREE.MeshStandardMaterial({ color: 0xffcc00, metalness: 0.9, roughness: 0.1 })
    );
    trophy.position.set(-0.6, 0.1, 0);
    shelf.add(trophy);
    // Small globe
    const globe = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 12, 8),
        new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.4 })
    );
    globe.position.set(-0.2, 0.1, 0);
    shelf.add(globe);
    // Book stack
    const bookColors = [0xaa2222, 0x22aa44, 0x2244aa];
    bookColors.forEach((c, i) => {
        const book = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.04, 0.16),
            new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })
        );
        book.position.set(0.2, 0.04 + i * 0.04, 0);
        shelf.add(book);
    });
    // Small succulent
    const succ = createSmallPlant();
    succ.position.set(0.6, 0.02, 0);
    succ.scale.setScalar(0.5);
    shelf.add(succ);
    return shelf;
}

// ── Reading Lamp (floor, warm) ────────────────────────────────
function createReadingLamp() {
    const lamp = new THREE.Group();
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.3 });
    // Base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.04, 12), metalMat);
    base.position.y = 0.02;
    lamp.add(base);
    // Pole
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 6), metalMat);
    pole.position.y = 0.77;
    lamp.add(pole);
    // Shade
    const shade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.2, 0.25, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x443322, roughness: 0.9, side: THREE.DoubleSide })
    );
    shade.position.y = 1.55;
    lamp.add(shade);
    // Warm light
    const light = new THREE.PointLight(0xffaa66, 0.6, 4);
    light.position.y = 1.5;
    lamp.add(light);
    return lamp;
}

// ── Magazine Table ────────────────────────────────────────────
function createMagazineTable() {
    const table = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 });
    // Top
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.03, 12), woodMat);
    top.position.y = 0.4;
    table.add(top);
    // Leg
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.4, 6), woodMat);
    leg.position.y = 0.2;
    table.add(leg);
    // A couple magazines
    const magColors = [0xcc3333, 0x3333cc];
    magColors.forEach((c, i) => {
        const mag = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.01, 0.28),
            new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })
        );
        mag.position.set((i - 0.5) * 0.08, 0.42 + i * 0.01, 0);
        mag.rotation.y = i * 0.3;
        table.add(mag);
    });
    return table;
}

// ── Water Cooler ──────────────────────────────────────────────
function createWaterCooler() {
    const cooler = new THREE.Group();
    // Body
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 1.0, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3, metalness: 0.2 })
    );
    body.position.y = 0.5;
    cooler.add(body);
    // Water bottle (blue tinted)
    const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 0.4, 12),
        new THREE.MeshStandardMaterial({ color: 0x3388cc, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.6 })
    );
    bottle.position.y = 1.2;
    cooler.add(bottle);
    // Spout area
    const spout = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.05, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 })
    );
    spout.position.set(0, 0.7, 0.18);
    cooler.add(spout);
    // Tiny cup
    const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.02, 0.04, 8),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.3 })
    );
    cup.position.set(0.05, 0.6, 0.2);
    cooler.add(cup);
    return cooler;
}

// ── Dartboard ─────────────────────────────────────────────────
function createDartboard() {
    const board = new THREE.Group();
    // Backing circle
    const backing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.04, 24),
        new THREE.MeshStandardMaterial({ color: 0x3a2a15, roughness: 0.9 })
    );
    backing.rotation.x = Math.PI / 2;
    board.add(backing);
    // Rings (alternating red/green/white)
    const ringColors = [0xcc2222, 0x228833, 0xddddcc, 0xcc2222, 0x228833];
    ringColors.forEach((c, i) => {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.28 - i * 0.055, 0.33 - i * 0.055, 24),
            new THREE.MeshBasicMaterial({ color: c })
        );
        ring.position.z = 0.025;
        board.add(ring);
    });
    // Bullseye
    const bullseye = new THREE.Mesh(
        new THREE.CircleGeometry(0.04, 12),
        new THREE.MeshBasicMaterial({ color: 0xff2222 })
    );
    bullseye.position.z = 0.025;
    board.add(bullseye);
    // A dart stuck in the board
    const dart = new THREE.Mesh(
        new THREE.ConeGeometry(0.01, 0.08, 4),
        new THREE.MeshStandardMaterial({ color: 0xcccc33 })
    );
    dart.position.set(0.08, 0.05, 0.04);
    dart.rotation.x = -Math.PI / 2;
    board.add(dart);
    return board;
}

// ── Trash Can (for paper ball hoops) ──────────────────────────
function createTrashCan() {
    const can = new THREE.Group();
    // Bin body (cylinder, open top)
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.17, 0.5, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide })
    );
    body.position.y = 0.25;
    can.add(body);
    // Bottom
    const bottom = new THREE.Mesh(
        new THREE.CircleGeometry(0.17, 12),
        new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.8 })
    );
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.01;
    can.add(bottom);
    // Rim
    const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.2, 0.012, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0x555566, metalness: 0.5, roughness: 0.3 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.5;
    can.add(rim);
    // A couple crumpled paper balls inside
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xeeeecc, roughness: 0.9 });
    for (let i = 0; i < 3; i++) {
        const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), paperMat);
        ball.position.set((Math.random() - 0.5) * 0.12, 0.08 + i * 0.04, (Math.random() - 0.5) * 0.12);
        can.add(ball);
    }
    return can;
}
