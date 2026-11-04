/**
 * 建筑网格（visual 层）：BuildingType 对应的外观构建函数。
成本/吸附面等数据定义在 data/buildings.ts；共用材质与网格尺寸见 shared.ts。
 */
import * as THREE from 'three';
import { BLOCK_SIZE, BLOCK_HEIGHT, WALL_HEIGHT, woodPlankMaterial, darkWoodMaterial, ironMaterial, ropeMaterial, leafMaterial } from './shared';

export function createFoundationMesh(): THREE.Group {
  const group = new THREE.Group();

  // 4 main planks
  const plankW = (BLOCK_SIZE - 0.1) / 4;
  for (let i = 0; i < 4; i++) {
    const pGeo = new THREE.BoxGeometry(plankW - 0.04, BLOCK_HEIGHT, BLOCK_SIZE * 0.96);
    const pMesh = new THREE.Mesh(pGeo, woodPlankMaterial);
    pMesh.position.set(-BLOCK_SIZE / 2 + plankW / 2 + i * plankW + 0.05, 0, 0);
    pMesh.castShadow = true;
    pMesh.receiveShadow = true;
    group.add(pMesh);
  }

  // Cross support beams underneath
  const beamGeo = new THREE.BoxGeometry(BLOCK_SIZE * 0.94, BLOCK_HEIGHT * 0.6, 0.14);
  const beam1 = new THREE.Mesh(beamGeo, darkWoodMaterial);
  beam1.position.set(0, -BLOCK_HEIGHT * 0.25, -BLOCK_SIZE * 0.35);
  const beam2 = beam1.clone();
  beam2.position.set(0, -BLOCK_HEIGHT * 0.25, BLOCK_SIZE * 0.35);
  group.add(beam1, beam2);

  // Corner rope lashings
  const ropeLashingGeo = new THREE.CylinderGeometry(0.04, 0.04, BLOCK_HEIGHT * 1.1, 6);
  const corners = [
    [-0.9, -0.9],
    [0.9, -0.9],
    [-0.9, 0.9],
    [0.9, 0.9],
  ];
  corners.forEach(([cx, cz]) => {
    const rope = new THREE.Mesh(ropeLashingGeo, ropeMaterial);
    rope.position.set(cx, 0, cz);
    group.add(rope);
  });

  return group;
}

// Collection Net Mesh (Foundation with embedded sturdy rope mesh)

export function createCollectionNetMesh(): THREE.Group {
  const group = new THREE.Group();

  // Outer wooden frame border
  const frameThick = 0.16;
  const frameGeoLong = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_HEIGHT, frameThick);
  const frameGeoShort = new THREE.BoxGeometry(frameThick, BLOCK_HEIGHT, BLOCK_SIZE - frameThick * 2);

  const north = new THREE.Mesh(frameGeoLong, darkWoodMaterial);
  north.position.set(0, 0, -BLOCK_SIZE / 2 + frameThick / 2);
  const south = new THREE.Mesh(frameGeoLong, darkWoodMaterial);
  south.position.set(0, 0, BLOCK_SIZE / 2 - frameThick / 2);

  const east = new THREE.Mesh(frameGeoShort, darkWoodMaterial);
  east.position.set(BLOCK_SIZE / 2 - frameThick / 2, 0, 0);
  const west = new THREE.Mesh(frameGeoShort, darkWoodMaterial);
  west.position.set(-BLOCK_SIZE / 2 + frameThick / 2, 0, 0);

  group.add(north, south, east, west);

  // Woven Rope Netting Mesh inside
  const netCylGeo = new THREE.CylinderGeometry(0.02, 0.02, BLOCK_SIZE - 0.4, 4);
  for (let i = -3; i <= 3; i++) {
    const r1 = new THREE.Mesh(netCylGeo, ropeMaterial);
    r1.rotation.z = Math.PI / 2;
    r1.position.set(0, -0.02, (i * (BLOCK_SIZE - 0.4)) / 7);
    const r2 = new THREE.Mesh(netCylGeo, ropeMaterial);
    r2.rotation.x = Math.PI / 2;
    r2.position.set((i * (BLOCK_SIZE - 0.4)) / 7, -0.02, 0);
    group.add(r1, r2);
  }

  // Trapped Items indicator container (empty initially)
  const caughtGroup = new THREE.Group();
  caughtGroup.name = 'caughtItems';
  caughtGroup.position.set(0, 0.08, 0);
  group.add(caughtGroup);

  return group;
}

// Triangle Foundation

export function createTriFoundationMesh(): THREE.Group {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-BLOCK_SIZE / 2, -BLOCK_SIZE / 2);
  shape.lineTo(BLOCK_SIZE / 2, -BLOCK_SIZE / 2);
  shape.lineTo(-BLOCK_SIZE / 2, BLOCK_SIZE / 2);
  shape.closePath();

  const extrudeSettings = { depth: BLOCK_HEIGHT, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.02, bevelThickness: 0.02 };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, BLOCK_HEIGHT / 2, 0);

  const mesh = new THREE.Mesh(geo, woodPlankMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// Pillar Model (Sturdy vertical timber with support angled brackets)

export function createPillarMesh(): THREE.Group {
  const group = new THREE.Group();
  const postGeo = new THREE.BoxGeometry(0.24, WALL_HEIGHT, 0.24);
  const post = new THREE.Mesh(postGeo, darkWoodMaterial);
  post.position.set(0, WALL_HEIGHT / 2, 0);
  post.castShadow = true;
  post.receiveShadow = true;
  group.add(post);

  // 4 top diagonal support gussets
  const gussetGeo = new THREE.BoxGeometry(0.12, 0.45, 0.12);
  const angles = [
    [0.2, 0, Math.PI / 4],
    [-0.2, 0, -Math.PI / 4],
    [0, 0.2, Math.PI / 4],
    [0, -0.2, -Math.PI / 4],
  ];
  angles.forEach(([dx, dz, rotZ], idx) => {
    const gusset = new THREE.Mesh(gussetGeo, woodPlankMaterial);
    gusset.position.set(dx, WALL_HEIGHT - 0.2, dz);
    if (idx < 2) gusset.rotation.z = rotZ;
    else gusset.rotation.x = rotZ;
    group.add(gusset);
  });

  return group;
}

// Upper Deck Floor

export function createFloorMesh(): THREE.Group {
  const group = new THREE.Group();
  const plankCount = 5;
  const pw = BLOCK_SIZE / plankCount;
  for (let i = 0; i < plankCount; i++) {
    const geo = new THREE.BoxGeometry(pw - 0.02, 0.12, BLOCK_SIZE * 0.98);
    const m = new THREE.Mesh(geo, woodPlankMaterial);
    m.position.set(-BLOCK_SIZE / 2 + pw / 2 + i * pw, 0.06, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // Support joists underneath
  const joistGeo = new THREE.BoxGeometry(0.12, 0.12, BLOCK_SIZE);
  const joist1 = new THREE.Mesh(joistGeo, darkWoodMaterial);
  joist1.position.set(-BLOCK_SIZE * 0.35, -0.06, 0);
  const joist2 = joist1.clone();
  joist2.position.set(BLOCK_SIZE * 0.35, -0.06, 0);
  group.add(joist1, joist2);

  return group;
}

// Wooden Stairs

export function createStairsMesh(): THREE.Group {
  const group = new THREE.Group();
  const stepCount = 8;
  const stepH = WALL_HEIGHT / stepCount;
  const stepD = BLOCK_SIZE / stepCount;

  for (let i = 0; i < stepCount; i++) {
    const stepGeo = new THREE.BoxGeometry(BLOCK_SIZE * 0.88, stepH, stepD * 1.05);
    const step = new THREE.Mesh(stepGeo, woodPlankMaterial);
    step.position.set(0, (i + 0.5) * stepH, -BLOCK_SIZE / 2 + (i + 0.5) * stepD);
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);
  }

  // Side stringers / banisters
  const stringerLen = Math.sqrt(WALL_HEIGHT * WALL_HEIGHT + BLOCK_SIZE * BLOCK_SIZE);
  const stringerGeo = new THREE.BoxGeometry(0.1, 0.28, stringerLen);
  const stringerAngle = -Math.atan2(WALL_HEIGHT, BLOCK_SIZE);

  const stringerLeft = new THREE.Mesh(stringerGeo, darkWoodMaterial);
  stringerLeft.position.set(-BLOCK_SIZE * 0.44, WALL_HEIGHT / 2, 0);
  stringerLeft.rotation.x = stringerAngle;

  const stringerRight = new THREE.Mesh(stringerGeo, darkWoodMaterial);
  stringerRight.position.set(BLOCK_SIZE * 0.44, WALL_HEIGHT / 2, 0);
  stringerRight.rotation.x = stringerAngle;

  // Railing handrails
  const handrailGeo = new THREE.BoxGeometry(0.08, 0.08, stringerLen);
  const handrailLeft = new THREE.Mesh(handrailGeo, woodPlankMaterial);
  handrailLeft.position.set(-BLOCK_SIZE * 0.44, WALL_HEIGHT / 2 + 0.75, 0);
  handrailLeft.rotation.x = stringerAngle;

  const handrailRight = new THREE.Mesh(handrailGeo, woodPlankMaterial);
  handrailRight.position.set(BLOCK_SIZE * 0.44, WALL_HEIGHT / 2 + 0.75, 0);
  handrailRight.rotation.x = stringerAngle;

  group.add(stringerLeft, stringerRight, handrailLeft, handrailRight);
  return group;
}

// Wooden Wall

export function createWallMesh(hasWindow: boolean = false): THREE.Group {
  const group = new THREE.Group();

  // Frame columns
  const colGeo = new THREE.BoxGeometry(0.18, WALL_HEIGHT, 0.18);
  const col1 = new THREE.Mesh(colGeo, darkWoodMaterial);
  col1.position.set(-BLOCK_SIZE / 2 + 0.09, WALL_HEIGHT / 2, 0);
  const col2 = col1.clone();
  col2.position.x = BLOCK_SIZE / 2 - 0.09;
  group.add(col1, col2);

  // Top header & bottom sill
  const beamGeo = new THREE.BoxGeometry(BLOCK_SIZE, 0.16, 0.16);
  const topBeam = new THREE.Mesh(beamGeo, darkWoodMaterial);
  topBeam.position.set(0, WALL_HEIGHT - 0.08, 0);
  const bottomBeam = new THREE.Mesh(beamGeo, darkWoodMaterial);
  bottomBeam.position.set(0, 0.08, 0);
  group.add(topBeam, bottomBeam);

  if (!hasWindow) {
    // Solid planks
    const plankGeo = new THREE.BoxGeometry(BLOCK_SIZE - 0.36, WALL_HEIGHT - 0.32, 0.08);
    const wallPlanks = new THREE.Mesh(plankGeo, woodPlankMaterial);
    wallPlanks.position.set(0, WALL_HEIGHT / 2, 0);
    wallPlanks.castShadow = true;
    wallPlanks.receiveShadow = true;
    group.add(wallPlanks);
  } else {
    // Wall with window cutout
    const lowerGeo = new THREE.BoxGeometry(BLOCK_SIZE - 0.36, 0.8, 0.08);
    const lower = new THREE.Mesh(lowerGeo, woodPlankMaterial);
    lower.position.set(0, 0.48, 0);

    const upperGeo = new THREE.BoxGeometry(BLOCK_SIZE - 0.36, 0.5, 0.08);
    const upper = new THREE.Mesh(upperGeo, woodPlankMaterial);
    upper.position.set(0, WALL_HEIGHT - 0.33, 0);

    const sillGeo = new THREE.BoxGeometry(BLOCK_SIZE - 0.3, 0.08, 0.14);
    const sill = new THREE.Mesh(sillGeo, darkWoodMaterial);
    sill.position.set(0, 0.88, 0);

    group.add(lower, upper, sill);
  }

  return group;
}

// Fence / Safety Railing

export function createFenceMesh(): THREE.Group {
  const group = new THREE.Group();
  const railH = 0.95;

  const postGeo = new THREE.BoxGeometry(0.12, railH, 0.12);
  const p1 = new THREE.Mesh(postGeo, darkWoodMaterial);
  p1.position.set(-BLOCK_SIZE / 2 + 0.06, railH / 2, 0);
  const p2 = p1.clone();
  p2.position.x = BLOCK_SIZE / 2 - 0.06;

  const railGeo = new THREE.BoxGeometry(BLOCK_SIZE, 0.08, 0.08);
  const topRail = new THREE.Mesh(railGeo, woodPlankMaterial);
  topRail.position.set(0, railH - 0.04, 0);
  const midRail = new THREE.Mesh(railGeo, woodPlankMaterial);
  midRail.position.set(0, railH * 0.45, 0);

  group.add(p1, p2, topRail, midRail);
  return group;
}

// Simple Purifier Station

export function createPurifierMesh(): THREE.Group {
  const group = new THREE.Group();

  // 4 Legs
  const legGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6);
  [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(legGeo, darkWoodMaterial);
    leg.position.set(lx, 0.45, lz);
    group.add(leg);
  });

  // Table shelf
  const shelfGeo = new THREE.BoxGeometry(0.9, 0.08, 0.9);
  const shelf = new THREE.Mesh(shelfGeo, woodPlankMaterial);
  shelf.position.set(0, 0.88, 0);
  group.add(shelf);

  // Firebox / burner at bottom
  const fireBox = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.2, 8), ironMaterial);
  fireBox.position.set(0, 0.15, 0);
  const coalGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xff5500 })
  );
  coalGlow.position.set(0, 0.22, 0);
  group.add(fireBox, coalGlow);

  // Boiling pot on top
  const potGeo = new THREE.CylinderGeometry(0.24, 0.2, 0.32, 12);
  const pot = new THREE.Mesh(potGeo, ironMaterial);
  pot.position.set(0, 1.08, 0);
  group.add(pot);

  // Fresh water collection cup on side
  const cupGeo = new THREE.CylinderGeometry(0.1, 0.08, 0.2, 8);
  const cup = new THREE.Mesh(cupGeo, darkWoodMaterial);
  cup.position.set(0.32, 1.02, 0.2);
  group.add(cup);

  // Water level indicator
  const waterDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.02, 8),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.1, metalness: 0.2 })
  );
  waterDisc.name = 'waterSurface';
  waterDisc.position.set(0.32, 1.08, 0.2);
  waterDisc.visible = false;
  group.add(waterDisc);

  return group;
}

// Simple Grill Station

export function createGrillMesh(): THREE.Group {
  const group = new THREE.Group();

  // Stone ring base
  const stoneGeo = new THREE.DodecahedronGeometry(0.12);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.95 });
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
    const s = new THREE.Mesh(stoneGeo, stoneMat);
    s.position.set(Math.cos(a) * 0.42, 0.1, Math.sin(a) * 0.42);
    group.add(s);
  }

  // Charcoal embers
  const coalMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.4, 0.12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3b00 })
  );
  coalMesh.position.set(0, 0.08, 0);
  group.add(coalMesh);

  // Metal grill mesh grate
  const grateGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.04, 12);
  const grateMat = new THREE.MeshStandardMaterial({ color: 0x334155, wireframe: true });
  const grate = new THREE.Mesh(grateGeo, grateMat);
  grate.position.set(0, 0.26, 0);
  group.add(grate);

  // Cooking food item slot (hidden when nothing cooking)
  const fishFood = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.08, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.6 })
  );
  fishFood.name = 'foodCooking';
  fishFood.position.set(0, 0.32, 0);
  fishFood.visible = false;
  group.add(fishFood);

  return group;
}

// Crop Plot Station

export function createCropPlotMesh(): THREE.Group {
  const group = new THREE.Group();

  // Wooden planter box
  const boxGeo = new THREE.BoxGeometry(1.2, 0.35, 1.2);
  const box = new THREE.Mesh(boxGeo, darkWoodMaterial);
  box.position.set(0, 0.18, 0);
  group.add(box);

  // Rich soil
  const soilGeo = new THREE.BoxGeometry(1.05, 0.08, 1.05);
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.98 });
  const soil = new THREE.Mesh(soilGeo, soilMat);
  soil.position.set(0, 0.34, 0);
  group.add(soil);

  // Potato Plant shoots (grow visibly)
  const plantGroup = new THREE.Group();
  plantGroup.name = 'plantShoots';
  plantGroup.position.set(0, 0.38, 0);

  const stemGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 5);
  const leafSproutGeo = new THREE.SphereGeometry(0.12, 5, 5);
  for (let i = 0; i < 3; i++) {
    const px = (i - 1) * 0.3;
    const stem = new THREE.Mesh(stemGeo, leafMaterial);
    stem.position.set(px, 0.2, 0);
    const leafy = new THREE.Mesh(leafSproutGeo, leafMaterial);
    leafy.position.set(px, 0.4, 0);
    leafy.scale.set(1.5, 0.5, 1.2);
    plantGroup.add(stem, leafy);
  }
  plantGroup.visible = false;
  group.add(plantGroup);

  return group;
}

// Storage Chest

export function createChestMesh(): THREE.Group {
  const group = new THREE.Group();

  // Base trunk
  const trunkGeo = new THREE.BoxGeometry(0.85, 0.45, 0.6);
  const trunk = new THREE.Mesh(trunkGeo, darkWoodMaterial);
  trunk.position.set(0, 0.22, 0);
  trunk.castShadow = true;
  group.add(trunk);

  // Brass corner fittings & lock plate
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.06), ironMaterial);
  lock.position.set(0, 0.32, 0.31);
  group.add(lock);

  // Hinged lid
  const lidGeo = new THREE.BoxGeometry(0.88, 0.16, 0.64);
  const lid = new THREE.Mesh(lidGeo, woodPlankMaterial);
  lid.name = 'chestLid';
  lid.position.set(0, 0.48, 0);
  group.add(lid);

  return group;
}

// Canvas Sail

export function createSailMesh(): THREE.Group {
  const group = new THREE.Group();

  // Mast pole
  const mastGeo = new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8);
  const mast = new THREE.Mesh(mastGeo, darkWoodMaterial);
  mast.position.set(0, 1.6, 0);
  group.add(mast);

  // Horizontal boom
  const boomGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6);
  const boom = new THREE.Mesh(boomGeo, darkWoodMaterial);
  boom.rotation.z = Math.PI / 2;
  boom.position.set(0.7, 0.8, 0);
  group.add(boom);

  // Billowing Canvas Sail cloth
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 2.9);
  sailShape.lineTo(1.4, 0.9);
  sailShape.lineTo(0, 0.9);
  sailShape.closePath();
  const sailGeo = new THREE.ShapeGeometry(sailShape);
  const sailMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const sail = new THREE.Mesh(sailGeo, sailMat);
  sail.position.set(0.05, 0, 0);
  group.add(sail);

  return group;
}

// Bed / Hammock

export function createBedMesh(): THREE.Group {
  const group = new THREE.Group();

  // Timber frame
  const frameGeo = new THREE.BoxGeometry(1.6, 0.22, 0.9);
  const frame = new THREE.Mesh(frameGeo, darkWoodMaterial);
  frame.position.set(0, 0.15, 0);
  group.add(frame);

  // Leaf matting / mattress
  const mattressGeo = new THREE.BoxGeometry(1.45, 0.15, 0.75);
  const mattress = new THREE.Mesh(mattressGeo, leafMaterial);
  mattress.position.set(0, 0.28, 0);
  group.add(mattress);

  // Blanket
  const blanketGeo = new THREE.BoxGeometry(0.9, 0.08, 0.72);
  const blanketMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.85 });
  const blanket = new THREE.Mesh(blanketGeo, blanketMat);
  blanket.position.set(-0.25, 0.36, 0);
  group.add(blanket);

  return group;
}

/**
 * 9. FLOATING SHARK MEAT DROP
 * Succulent prime cut of Bruce dropped upon defeat with floating marker buoy
 */
