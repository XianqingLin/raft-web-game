import * as THREE from 'three';
import { BuildingType, ResourceId } from '../../types/game';

// Standard grid size
export const BLOCK_SIZE = 2.0;
export const BLOCK_HEIGHT = 0.35;
export const WALL_HEIGHT = 2.4;

// Common Shared Materials
const woodColor = 0x9c6631;
const woodDarkColor = 0x5c3a1e;
const woodPlankMaterial = new THREE.MeshStandardMaterial({
  color: woodColor,
  roughness: 0.85,
  metalness: 0.05,
});

const darkWoodMaterial = new THREE.MeshStandardMaterial({
  color: woodDarkColor,
  roughness: 0.9,
  metalness: 0.05,
});

const ironMaterial = new THREE.MeshStandardMaterial({
  color: 0x475569,
  roughness: 0.4,
  metalness: 0.8,
});

const ropeMaterial = new THREE.MeshStandardMaterial({
  color: 0xd97706,
  roughness: 0.95,
  metalness: 0.0,
});

const plasticMaterial = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  roughness: 0.3,
  metalness: 0.1,
  transparent: true,
  opacity: 0.85,
});

const leafMaterial = new THREE.MeshStandardMaterial({
  color: 0x16a34a,
  roughness: 0.6,
  metalness: 0.05,
});

/**
 * 1. RAFT STRUCTURE MODELS
 */

// Foundation Plank Block (4 composite planks + cross tie + side ropes)
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
/**
 * 2. SHARK MODEL (BRUCE & BLOOD BRUCE)
 * High-fidelity predatory shark model with sculpted torpedo body, menacing jaws,
 * sharp 3D triangular teeth, 5 gill slits, curved hydrofoil pectoral fins,
 * dual-lobed caudal tail fluke, and dynamic Blood Shark skin transformation!
 */
export function createSharkMesh(isBloodShark: boolean = false): THREE.Group {
  const shark = new THREE.Group();
  shark.name = 'BruceTheShark';

  // Base materials (swappable between Normal and Blood Shark)
  const dorsalMat = new THREE.MeshStandardMaterial({
    color: isBloodShark ? 0x881337 : 0x273549, // Blood crimson vs Deep oceanic slate
    roughness: 0.35,
    metalness: 0.15,
  });
  dorsalMat.name = 'sharkDorsalMat';

  const bellyMat = new THREE.MeshStandardMaterial({
    color: isBloodShark ? 0x4c0519 : 0xf1f5f9, // Dark blood belly vs pale pearl underbelly
    roughness: 0.45,
    metalness: 0.05,
  });
  bellyMat.name = 'sharkBellyMat';

  const teethMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.1,
  });

  const eyeMat = new THREE.MeshBasicMaterial({
    color: isBloodShark ? 0xff002b : 0x0f172a, // Glowing fiery blood red vs dark predatory pupil
  });
  eyeMat.name = 'sharkEyeMat';

  // 1. Root / Main Torso
  const torsoGroup = new THREE.Group();
  torsoGroup.name = 'sharkTorso';
  torsoGroup.position.set(0, 0, 0);

  // Main Muscular Torso Body
  const bodyGeo = new THREE.CylinderGeometry(0.68, 0.62, 1.6, 12);
  bodyGeo.rotateZ(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, dorsalMat);
  body.name = 'sharkBody';
  body.castShadow = true;
  body.receiveShadow = true;
  torsoGroup.add(body);

  // Torso Belly Plate
  const bellyGeo = new THREE.BoxGeometry(1.5, 0.24, 0.82);
  const belly = new THREE.Mesh(bellyGeo, bellyMat);
  belly.name = 'sharkBelly';
  belly.position.set(0, -0.42, 0);
  torsoGroup.add(belly);

  // Iconic Great White Dorsal Fin
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.quadraticCurveTo(0.2, 0.6, 0.5, 1.25);
  finShape.lineTo(0.72, 1.15);
  finShape.quadraticCurveTo(0.65, 0.4, 0.88, 0.08);
  finShape.lineTo(0.85, 0);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
  finGeo.rotateY(Math.PI / 2);
  finGeo.translate(-0.045, 0, 0);
  const dorsalFin = new THREE.Mesh(finGeo, dorsalMat);
  dorsalFin.name = 'dorsalFin';
  dorsalFin.position.set(-0.1, 0.45, 0);
  dorsalFin.castShadow = true;
  torsoGroup.add(dorsalFin);

  // Pectoral Fins (Left & Right hydrofoils with natural dihedral sweep)
  const pecShape = new THREE.Shape();
  pecShape.moveTo(0, 0);
  pecShape.quadraticCurveTo(0.4, -0.1, 1.05, -0.45);
  pecShape.quadraticCurveTo(0.7, -0.55, 0.35, -0.58);
  pecShape.closePath();
  const pecGeo = new THREE.ExtrudeGeometry(pecShape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015 });

  const pecLeft = new THREE.Mesh(pecGeo, dorsalMat);
  pecLeft.name = 'sharkPecL';
  pecLeft.position.set(0.35, -0.22, 0.52);
  pecLeft.rotation.set(0.35, -0.1, 0.15);
  pecLeft.castShadow = true;

  const pecRight = new THREE.Mesh(pecGeo, dorsalMat);
  pecRight.name = 'sharkPecR';
  pecRight.position.set(0.35, -0.22, -0.52);
  pecRight.rotation.set(-0.35, 0.1, 0.15);
  pecRight.scale.z = -1;
  pecRight.castShadow = true;
  torsoGroup.add(pecLeft, pecRight);

  // 5 Sculpted Gill Slits on both flanks
  const gillMat = new THREE.MeshBasicMaterial({ color: isBloodShark ? 0x2e020d : 0x0f172a });
  gillMat.name = 'sharkGillMat';
  const gillGeo = new THREE.BoxGeometry(0.02, 0.32, 0.025);
  for (let side = -1; side <= 1; side += 2) {
    for (let g = 0; g < 5; g++) {
      const gill = new THREE.Mesh(gillGeo, gillMat);
      gill.position.set(0.55 - g * 0.11, -0.06, side * 0.62);
      gill.rotation.y = side * 0.15;
      torsoGroup.add(gill);
    }
  }

  // 2. Articulated Head & Snout (Forward pivot from +0.8)
  const headGroup = new THREE.Group();
  headGroup.name = 'sharkHeadGroup';
  headGroup.position.set(0.8, 0, 0);

  const headGeo = new THREE.ConeGeometry(0.66, 1.4, 12);
  headGeo.rotateZ(-Math.PI / 2);
  const headMesh = new THREE.Mesh(headGeo, dorsalMat);
  headMesh.name = 'sharkHead';
  headMesh.position.set(0.7, -0.04, 0);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  // Eyes
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeMat);
  eyeL.name = 'sharkEyeL';
  eyeL.position.set(0.75, 0.16, 0.38);
  const eyeR = eyeL.clone();
  eyeR.name = 'sharkEyeR';
  eyeR.position.z = -0.38;
  headGroup.add(eyeL, eyeR);

  // Jaws with Hinged Lower Jaw for biting action!
  const jawGroup = new THREE.Group();
  jawGroup.name = 'sharkJaws';
  jawGroup.position.set(0.75, -0.28, 0);

  // Upper Jaw
  const upperJawGeo = new THREE.BoxGeometry(0.5, 0.1, 0.48);
  const upperJaw = new THREE.Mesh(upperJawGeo, bellyMat);
  upperJaw.position.set(0.1, 0.08, 0);
  jawGroup.add(upperJaw);

  // Hinged Lower Jaw
  const lowerJawGroup = new THREE.Group();
  lowerJawGroup.name = 'sharkLowerJaw';
  lowerJawGroup.position.set(-0.15, -0.05, 0);
  const lowerJawGeo = new THREE.BoxGeometry(0.55, 0.1, 0.46);
  const lowerJaw = new THREE.Mesh(lowerJawGeo, bellyMat);
  lowerJaw.position.set(0.25, 0, 0);
  lowerJawGroup.add(lowerJaw);

  // Sharp 3D Triangular Teeth
  const toothGeo = new THREE.ConeGeometry(0.045, 0.14, 4);
  toothGeo.rotateX(Math.PI);
  for (let i = -3; i <= 3; i++) {
    const tTop = new THREE.Mesh(toothGeo, teethMat);
    tTop.position.set(0.12 - Math.abs(i) * 0.04, 0.15, (i * 0.38) / 6);
    jawGroup.add(tTop);

    const tBottom = new THREE.Mesh(toothGeo, teethMat);
    tBottom.rotation.x = 0;
    tBottom.position.set(0.22 - Math.abs(i) * 0.03, 0.06, (i * 0.36) / 6);
    lowerJawGroup.add(tBottom);
  }
  jawGroup.add(lowerJawGroup);
  headGroup.add(jawGroup);
  torsoGroup.add(headGroup);

  // 3. Articulated Mid-Body (Posterior Torso)
  const midGroup = new THREE.Group();
  midGroup.name = 'sharkMid';
  midGroup.position.set(-0.8, 0, 0);

  const midGeo = new THREE.ConeGeometry(0.6, 1.3, 12);
  midGeo.rotateZ(Math.PI / 2);
  const midMesh = new THREE.Mesh(midGeo, dorsalMat);
  midMesh.position.set(-0.65, 0, 0);
  midMesh.castShadow = true;
  midGroup.add(midMesh);

  // Secondary small stabilizing dorsal fin
  const secFinShape = new THREE.Shape();
  secFinShape.moveTo(0, 0);
  secFinShape.lineTo(0.18, 0.32);
  secFinShape.lineTo(0.3, 0);
  secFinShape.closePath();
  const secFinGeo = new THREE.ExtrudeGeometry(secFinShape, { depth: 0.04, bevelEnabled: false });
  secFinGeo.rotateY(Math.PI / 2);
  const secFin = new THREE.Mesh(secFinGeo, dorsalMat);
  secFin.position.set(-0.65, 0.28, 0);
  midGroup.add(secFin);

  // 4. Articulated Caudal Peduncle (Tail Base)
  const tailGroup = new THREE.Group();
  tailGroup.name = 'sharkTail';
  tailGroup.position.set(-1.3, 0, 0);

  const tailPeduncleGeo = new THREE.CylinderGeometry(0.18, 0.38, 0.9, 8);
  tailPeduncleGeo.rotateZ(Math.PI / 2);
  const peduncleMesh = new THREE.Mesh(tailPeduncleGeo, dorsalMat);
  peduncleMesh.position.set(-0.45, 0, 0);
  peduncleMesh.castShadow = true;
  tailGroup.add(peduncleMesh);

  // Lateral keels
  const keelGeo = new THREE.BoxGeometry(0.65, 0.05, 0.38);
  const keel = new THREE.Mesh(keelGeo, dorsalMat);
  keel.position.set(-0.45, 0, 0);
  tailGroup.add(keel);

  // 5. Crescent Caudal Fin (Fluke)
  const flukeShape = new THREE.Shape();
  flukeShape.moveTo(0, 0);
  flukeShape.quadraticCurveTo(-0.45, 0.4, -0.95, 1.15); // Upper lobe
  flukeShape.lineTo(-0.72, 0.2);
  flukeShape.lineTo(-0.62, 0);
  flukeShape.lineTo(-0.72, -0.2);
  flukeShape.quadraticCurveTo(-0.45, -0.5, -0.85, -0.88); // Lower lobe
  flukeShape.quadraticCurveTo(-0.35, -0.3, 0, 0);
  flukeShape.closePath();

  const flukeGeo = new THREE.ExtrudeGeometry(flukeShape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015 });
  const tailFluke = new THREE.Mesh(flukeGeo, dorsalMat);
  tailFluke.name = 'sharkTailFluke';
  tailFluke.position.set(-0.9, 0, -0.035);
  tailFluke.castShadow = true;
  tailGroup.add(tailFluke);

  midGroup.add(tailGroup);
  torsoGroup.add(midGroup);
  shark.add(torsoGroup);

  // Overhead 3D Floating Name & Health Bar
  const healthBarGroup = new THREE.Group();
  healthBarGroup.name = 'sharkHealthBar';
  healthBarGroup.position.set(0.2, 2.05, 0);

  // Name Tag Banner
  const nameCanvas = document.createElement('canvas');
  nameCanvas.width = 256;
  nameCanvas.height = 64;
  const ctx = nameCanvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = isBloodShark ? '#991b1b' : '#1e293b';
    ctx.roundRect(0, 0, 256, 64, 12);
    ctx.fill();
    ctx.strokeStyle = isBloodShark ? '#f87171' : '#38bdf8';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isBloodShark ? '🩸 Blood Bruce' : '🦈 Bruce', 128, 34);
  }
  const nameTex = new THREE.CanvasTexture(nameCanvas);
  const nameMat = new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, side: THREE.DoubleSide });
  const nameMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), nameMat);
  nameMesh.name = 'sharkNameMesh';
  nameMesh.position.set(0, 0.3, 0);
  healthBarGroup.add(nameMesh);

  // Health Bar Background
  const bgGeo = new THREE.PlaneGeometry(1.7, 0.22);
  const bgMat = new THREE.MeshBasicMaterial({ color: 0x0f172a, side: THREE.DoubleSide });
  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  healthBarGroup.add(bgMesh);

  // Health Bar Fill
  const fillGeo = new THREE.PlaneGeometry(1.6, 0.16);
  fillGeo.translate(0.8, 0, 0);
  const fillMat = new THREE.MeshBasicMaterial({ color: isBloodShark ? 0xdc2626 : 0x22c55e, side: THREE.DoubleSide });
  const fillMesh = new THREE.Mesh(fillGeo, fillMat);
  fillMesh.name = 'sharkHealthFill';
  fillMesh.position.set(-0.8, 0, 0.01);
  healthBarGroup.add(fillMesh);

  shark.add(healthBarGroup);

  // Scale overall shark to majestic, terrifying predator proportions
  shark.scale.set(1.35, 1.35, 1.35);
  return shark;
}

/**
 * Apply Blood Shark transformation after Bruce is defeated the first time!
 */
export function applySharkSkin(sharkMesh: THREE.Group, isBloodShark: boolean) {
  const dorsalHex = isBloodShark ? 0x881337 : 0x273549; // Crimson Blood vs Oceanic Slate
  const bellyHex = isBloodShark ? 0x4c0519 : 0xf1f5f9;
  const eyeHex = isBloodShark ? 0xff002b : 0x0f172a;
  const fillHex = isBloodShark ? 0xdc2626 : 0x22c55e;

  sharkMesh.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (
        child.name === 'dorsalFin' ||
        child.name === 'sharkBody' ||
        child.name === 'sharkHead' ||
        child.name === 'sharkTailFluke' ||
        child.name === 'sharkPecL' ||
        child.name === 'sharkPecR'
      ) {
        if (child.material) (child.material as THREE.MeshStandardMaterial).color.setHex(dorsalHex);
      } else if (child.name === 'sharkBelly' || child.name === 'sharkJaws') {
        if (child.material) (child.material as THREE.MeshStandardMaterial).color.setHex(bellyHex);
      } else if (child.name === 'sharkEyeL' || child.name === 'sharkEyeR') {
        if (child.material) (child.material as THREE.MeshBasicMaterial).color.setHex(eyeHex);
      } else if (child.name === 'sharkHealthFill') {
        if (child.material) (child.material as THREE.MeshBasicMaterial).color.setHex(fillHex);
      }
    }
  });

  // Update Name Tag Canvas if available
  const nameMesh = sharkMesh.getObjectByName('sharkNameMesh') as THREE.Mesh;
  if (nameMesh && (nameMesh.material as any)?.map) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = isBloodShark ? '#881337' : '#1e293b';
      ctx.roundRect(0, 0, 256, 64, 12);
      ctx.fill();
      ctx.strokeStyle = isBloodShark ? '#f87171' : '#38bdf8';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isBloodShark ? '🩸 Blood Bruce' : '🦈 Bruce', 128, 34);
    }
    const newTex = new THREE.CanvasTexture(canvas);
    (nameMesh.material as THREE.MeshBasicMaterial).map = newTex;
    (nameMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }
}


/**
 * 3. FLOATING DEBRIS MODELS
 */
export function createDebrisMesh(type: string): THREE.Group {
  const group = new THREE.Group();

  if (type === 'wood') {
    // 3 bound planks
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 0.28), woodPlankMaterial);
      p.position.set(0, 0, (i - 1) * 0.32);
      p.rotation.y = (Math.random() - 0.5) * 0.15;
      p.castShadow = true;
      group.add(p);
    }
    // Cross binding rope
    const r1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 6), ropeMaterial);
    r1.rotation.x = Math.PI / 2;
    r1.position.set(0.35, 0.08, 0);
    const r2 = r1.clone();
    r2.position.x = -0.35;
    group.add(r1, r2);
  } else if (type === 'plastic') {
    // Crushed plastic bottles & polymer jug
    const jug = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.45, 0.35), plasticMaterial);
    jug.castShadow = true;
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8),
      new THREE.MeshStandardMaterial({ color: 0xef4444 })
    );
    cap.position.set(0, 0.25, 0);
    group.add(jug, cap);
  } else if (type === 'leaf') {
    // Palm frond
    const frond = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.55), leafMaterial);
    frond.rotation.z = 0.1;
    group.add(frond);
  } else if (type === 'barrel') {
    // Floating wooden barrel with iron hoops
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.48, 0.9, 10);
    const barrel = new THREE.Mesh(barrelGeo, darkWoodMaterial);
    barrel.rotation.z = Math.PI / 2; // Floating on its side
    barrel.castShadow = true;
    group.add(barrel);

    const hoop1 = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.03, 6, 12), ironMaterial);
    hoop1.rotation.y = Math.PI / 2;
    hoop1.position.x = 0.26;
    const hoop2 = hoop1.clone();
    hoop2.position.x = -0.26;
    group.add(hoop1, hoop2);
  } else if (type === 'crate') {
    // Wooden Nautical Cargo Crate
    const crateGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const crate = new THREE.Mesh(crateGeo, woodPlankMaterial);
    crate.castShadow = true;
    group.add(crate);

    // Cross braces
    const braceGeo = new THREE.BoxGeometry(0.82, 0.1, 0.82);
    const b1 = new THREE.Mesh(braceGeo, darkWoodMaterial);
    group.add(b1);
  } else if (type === 'scrap') {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8), ironMaterial);
    pipe.rotation.x = Math.PI / 4;
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.5), ironMaterial);
    group.add(pipe, sheet);
  } else {
    // Stone
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.35),
      new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.9 })
    );
    group.add(stone);
  }

  return group;
}

/**
 * 4. FIRST PERSON PLAYER TOOLS & WEAPONS
 */

// Distinct Salvage Grappling Hook (4-pronged forged iron claw with rear eyelet and hemp rope wrap)
export function createGrapplingHookMesh(isFPSTool: boolean = false): THREE.Group {
  const group = new THREE.Group();
  group.name = isFPSTool ? 'fpsHookTool' : 'projectileGrapplingHook';

  const darkIronMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.38,
    metalness: 0.88,
  });

  const shinySteelMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.22,
    metalness: 0.94,
  });

  const cordMat = new THREE.MeshStandardMaterial({
    color: 0xb45309,
    roughness: 0.92,
    metalness: 0.0,
  });

  const weightMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.3,
    metalness: 0.8,
  });

  // 1. Central Hexagonal Forged Shank
  const shankGeo = new THREE.CylinderGeometry(0.024, 0.034, 0.54, 6);
  const shank = new THREE.Mesh(shankGeo, darkIronMat);
  shank.rotation.x = Math.PI / 2;
  shank.castShadow = true;
  group.add(shank);

  // 2. Heavy Welded Rear Eyelet (Hitch Ring)
  const eyeletGeo = new THREE.TorusGeometry(0.052, 0.016, 8, 16);
  const eyelet = new THREE.Mesh(eyeletGeo, darkIronMat);
  eyelet.position.set(0, 0, 0.28);
  eyelet.castShadow = true;
  group.add(eyelet);

  // 3. Thick Hemp Cord Whipping / Binding around Shank
  const wrapGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.15, 8);
  const wrap = new THREE.Mesh(wrapGeo, cordMat);
  wrap.rotation.x = Math.PI / 2;
  wrap.position.set(0, 0, 0.18);
  group.add(wrap);

  // Knot hitch passing through the eyelet
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 6), cordMat);
  knot.position.set(0, 0, 0.28);
  group.add(knot);

  // 4. Weighted Aerodynamic Nose Collar
  const collarGeo = new THREE.CylinderGeometry(0.065, 0.055, 0.09, 8);
  const collar = new THREE.Mesh(collarGeo, weightMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0, -0.22);
  collar.castShadow = true;
  group.add(collar);

  // 5. Four Forged Curved Claws (Flukes) arranged symmetrically at 90° intervals
  const clawAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  clawAngles.forEach((ang) => {
    const clawRoot = new THREE.Group();
    clawRoot.rotation.z = ang;

    // Outward extending base strut
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.14, 0.03), darkIronMat);
    strut.position.set(0, 0.09, -0.23);
    strut.rotation.x = -0.38;
    strut.castShadow = true;

    // Curved elbow connector
    const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.032, 6), darkIronMat);
    elbow.rotation.z = Math.PI / 2;
    elbow.position.set(0, 0.165, -0.275);

    // Backward-hooked curved tine pointing back towards shank
    const tine = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.13, 0.024), darkIronMat);
    tine.position.set(0, 0.175, -0.19);
    tine.rotation.x = 0.58;
    tine.castShadow = true;

    // Polished sharp chisel/pyramid barb point
    const barbPoint = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.065, 4), shinySteelMat);
    barbPoint.rotation.x = 0.58 + Math.PI;
    barbPoint.rotation.y = Math.PI / 4;
    barbPoint.position.set(0, 0.15, -0.12);
    barbPoint.castShadow = true;

    clawRoot.add(strut, elbow, tine, barbPoint);
    group.add(clawRoot);
  });

  // 6. Welded Circular Stabilizer Ring connecting the 4 claws
  const ringGeo = new THREE.TorusGeometry(0.125, 0.007, 6, 20);
  const ring = new THREE.Mesh(ringGeo, darkIronMat);
  ring.position.set(0, 0, -0.22);
  ring.castShadow = true;
  group.add(ring);

  // 7. FPS Tool specific additions (Coiled rope bundle held in hands)
  if (isFPSTool) {
    const ropeCoil1 = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.024, 8, 16), cordMat);
    ropeCoil1.position.set(-0.06, -0.06, 0.32);
    ropeCoil1.rotation.y = 0.45;

    const ropeCoil2 = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.022, 8, 16), cordMat);
    ropeCoil2.position.set(-0.08, -0.05, 0.36);
    ropeCoil2.rotation.y = 0.35;

    const leadGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6);
    const lead = new THREE.Mesh(leadGeo, cordMat);
    lead.rotation.x = Math.PI / 3;
    lead.position.set(-0.04, -0.04, 0.24);

    group.add(ropeCoil1, ropeCoil2, lead);

    group.position.set(0.32, -0.24, -0.52);
    group.rotation.set(0.25, -0.18, 0.08);
  }

  return group;
}

// Distinct Survival Shark Spear (1.95m long hardwood shaft, cross-stitched leather grip, swept-back shark barbs, and gleaming diamond blade)
export function createSurvivalSpearMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fpsSurvivalSpear';

  const woodShaftMat = new THREE.MeshStandardMaterial({
    color: 0x78350f, // Warm rich ironwood / hardwood timber
    roughness: 0.76,
    metalness: 0.04,
  });

  const darkLeatherGripMat = new THREE.MeshStandardMaterial({
    color: 0x26170d, // Dark rawhide / cross-stitched leather wrap
    roughness: 0.94,
    metalness: 0.0,
  });

  const sinewBandMat = new THREE.MeshStandardMaterial({
    color: 0xd97706, // Amber sinew wrapping cords
    roughness: 0.88,
    metalness: 0.06,
  });

  const bronzePommelMat = new THREE.MeshStandardMaterial({
    color: 0xb45309, // Polished bronze / copper counterweight butt
    roughness: 0.42,
    metalness: 0.78,
  });

  const steelSocketMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b, // Dark tempered iron socket fitting
    roughness: 0.4,
    metalness: 0.85,
  });

  const gleamingBladeMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8, // Forged weapon-grade steel blade body
    roughness: 0.22,
    metalness: 0.94,
  });

  const razorEdgeMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9, // Polished silver razor cutting edges
    roughness: 0.12,
    metalness: 0.98,
  });

  // 1. Long Carved Hardwood Shaft (1.95m length)
  const shaftGeo = new THREE.CylinderGeometry(0.022, 0.03, 1.95, 8);
  const shaft = new THREE.Mesh(shaftGeo, woodShaftMat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(0, 0, 0.1);
  shaft.castShadow = true;
  group.add(shaft);

  // 2. Bronze Rounded Counterweight Pommel & Butt Ring
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), bronzePommelMat);
  pommel.position.set(0, 0, 1.08);

  const buttRing = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.06, 8), bronzePommelMat);
  buttRing.rotation.x = Math.PI / 2;
  buttRing.position.set(0, 0, 1.04);
  group.add(pommel, buttRing);

  // 3. Ergonomic Cross-Stitched Rawhide Leather Grip Section
  const gripGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.48, 8);
  const grip = new THREE.Mesh(gripGeo, darkLeatherGripMat);
  grip.rotation.x = Math.PI / 2;
  grip.position.set(0, 0, 0.35);
  group.add(grip);

  // 4 Raised Sinew Wound Ring Bands along grip
  [0.12, 0.26, 0.44, 0.58].forEach((gz) => {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.005, 6, 12), sinewBandMat);
    band.position.set(0, 0, gz);
    group.add(band);
  });

  // 4. Heavy Forged Steel Socket Ferrule Fitting
  const socketGeo = new THREE.CylinderGeometry(0.032, 0.036, 0.24, 8);
  const socket = new THREE.Mesh(socketGeo, steelSocketMat);
  socket.rotation.x = Math.PI / 2;
  socket.position.set(0, 0, -0.82);
  socket.castShadow = true;
  group.add(socket);

  // Rivet Studs securing socket to wooden shaft
  [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach((rAng) => {
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.007, 4, 4), gleamingBladeMat);
    rivet.position.set(Math.cos(rAng) * 0.036, Math.sin(rAng) * 0.036, -0.84);
    group.add(rivet);
  });

  // 5. Dual Swept-Back Barbed Shark Hunting Wings (Distinct Harpoon Feature)
  // Left Wing
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.038, 0.16), steelSocketMat);
  wingL.position.set(-0.065, 0, -0.92);
  wingL.rotation.y = 0.55; // Angled backwards towards player
  wingL.castShadow = true;

  const barbTipL = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 4), razorEdgeMat);
  barbTipL.rotation.y = 0.55 + Math.PI;
  barbTipL.position.set(-0.11, 0, -0.86);
  barbTipL.castShadow = true;
  group.add(wingL, barbTipL);

  // Right Wing
  const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.038, 0.16), steelSocketMat);
  wingR.position.set(0.065, 0, -0.92);
  wingR.rotation.y = -0.55;
  wingR.castShadow = true;

  const barbTipR = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 4), razorEdgeMat);
  barbTipR.rotation.y = -0.55 + Math.PI;
  barbTipR.position.set(0.11, 0, -0.86);
  barbTipR.castShadow = true;
  group.add(wingR, barbTipR);

  // 6. Broad Forged Double-Edged Spearhead Blade
  const spineGeo = new THREE.BoxGeometry(0.02, 0.075, 0.48);
  const spine = new THREE.Mesh(spineGeo, gleamingBladeMat);
  spine.position.set(0, 0, -1.16);
  spine.castShadow = true;

  const edgeGeo = new THREE.BoxGeometry(0.012, 0.095, 0.42);
  const edge = new THREE.Mesh(edgeGeo, razorEdgeMat);
  edge.position.set(0, 0, -1.18);
  edge.castShadow = true;

  // Needle-sharp 4-sided diamond stiletto point
  const tipGeo = new THREE.ConeGeometry(0.052, 0.24, 4);
  const tip = new THREE.Mesh(tipGeo, razorEdgeMat);
  tip.rotation.x = -Math.PI / 2;
  tip.rotation.y = Math.PI / 4; // Diamond cross-section facet
  tip.position.set(0, 0, -1.48);
  tip.castShadow = true;

  group.add(spine, edge, tip);

  // First-person ready pose: pointing cleanly down the crosshair
  group.position.set(0.32, -0.28, -0.45);
  group.rotation.set(0.08, -0.12, 0.04);

  return group;
}

export function createFPSTool(tool: string): THREE.Group {
  if (tool === 'hook') {
    return createGrapplingHookMesh(true);
  } else if (tool === 'spear') {
    return createSurvivalSpearMesh();
  }

  const toolGroup = new THREE.Group();

  if (tool === 'hammer') {
    // Building hammer
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.7, 6), darkWoodMaterial);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.32), ironMaterial);
    head.position.set(0, 0.32, 0);

    toolGroup.add(handle, head);
    toolGroup.position.set(0.35, -0.22, -0.5);
    toolGroup.rotation.set(0.2, 0, -0.2);
  } else if (tool === 'fishing_rod') {
    // Bamboo/hardwood fishing rod with brass reel and guide eyelets
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.45, 8), darkWoodMaterial);
    grip.position.set(0, -0.6, 0);

    const blank = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.034, 1.9, 8), woodPlankMaterial);
    blank.position.set(0, 0.5, -0.2);
    blank.rotation.x = -0.2;

    const reelBase = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.08), ironMaterial);
    reelBase.position.set(0, -0.35, 0.06);

    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.1, 12), ironMaterial);
    spool.rotation.z = Math.PI / 2;
    spool.position.set(0.04, -0.35, 0.08);

    const reelHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.09, 6), darkWoodMaterial);
    reelHandle.position.set(0.1, -0.35, 0.14);

    // Guide Eyelet rings along rod
    const guideGeo = new THREE.TorusGeometry(0.02, 0.005, 4, 8);
    const g1 = new THREE.Mesh(guideGeo, ironMaterial);
    g1.position.set(0, 0.2, -0.14);
    const g2 = new THREE.Mesh(guideGeo, ironMaterial);
    g2.position.set(0, 0.8, -0.28);
    const g3 = new THREE.Mesh(guideGeo, ironMaterial);
    g3.position.set(0, 1.4, -0.42);

    toolGroup.add(grip, blank, reelBase, spool, reelHandle, g1, g2, g3);
    toolGroup.position.set(0.38, -0.26, -0.62);
    toolGroup.rotation.set(0.45, -0.1, -0.15);
  }

  return toolGroup;
}


/**
 * 6. DEBRIS COMPACTOR STATION
 * Heavy hydraulic mechanical press for forging Salvaged Scrap Blocks
 */
export function createDebrisCompactorMesh(): THREE.Group {
  const group = new THREE.Group();

  // Heavy steel base and wooden workbench frame
  const baseGeo = new THREE.BoxGeometry(1.4, 0.22, 1.2);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.7 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.set(0, 0.11, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // 4 Corner hydraulic support pillars
  const colGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8);
  const colMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.35, metalness: 0.85 });
  const corners = [
    [-0.55, -0.45],
    [0.55, -0.45],
    [-0.55, 0.45],
    [0.55, 0.45],
  ];
  corners.forEach(([cx, cz]) => {
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.set(cx, 0.9, cz);
    col.castShadow = true;
    group.add(col);
  });

  // Top hydraulic header beam
  const topGeo = new THREE.BoxGeometry(1.3, 0.24, 1.1);
  const topMesh = new THREE.Mesh(topGeo, baseMat);
  topMesh.position.set(0, 1.6, 0);
  topMesh.castShadow = true;
  group.add(topMesh);

  // Central hydraulic press cylinder
  const cylGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.7, 10);
  const cyl = new THREE.Mesh(cylGeo, colMat);
  cyl.position.set(0, 1.25, 0);
  cyl.castShadow = true;
  group.add(cyl);

  // Moving Compactor Press Piston
  const pistonGroup = new THREE.Group();
  pistonGroup.name = 'compactorPiston';
  pistonGroup.position.set(0, 0.7, 0);
  const pistonHeadGeo = new THREE.BoxGeometry(0.85, 0.16, 0.75);
  const pistonHeadMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.6 }); // Industrial safety yellow
  const pistonHead = new THREE.Mesh(pistonHeadGeo, pistonHeadMat);
  pistonHead.castShadow = true;
  pistonGroup.add(pistonHead);
  group.add(pistonGroup);

  // Feed Hopper Chute at back
  const hopperGeo = new THREE.ConeGeometry(0.4, 0.5, 4);
  hopperGeo.rotateY(Math.PI / 4);
  const hopperMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7, metalness: 0.4 });
  const hopper = new THREE.Mesh(hopperGeo, hopperMat);
  hopper.position.set(0, 1.7, -0.3);
  group.add(hopper);

  // Manual Hydraulic Lever
  const leverGroup = new THREE.Group();
  leverGroup.name = 'compactorLever';
  leverGroup.position.set(0.68, 1.0, 0);
  const leverRod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), colMat);
  leverRod.position.set(0, 0.25, 0);
  const leverKnob = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), new THREE.MeshStandardMaterial({ color: 0xef4444 }));
  leverKnob.position.set(0, 0.55, 0);
  leverGroup.add(leverRod, leverKnob);
  leverGroup.rotation.z = -0.3;
  group.add(leverGroup);

  // Output Block Tray
  const trayGeo = new THREE.BoxGeometry(0.6, 0.08, 0.5);
  const tray = new THREE.Mesh(trayGeo, baseMat);
  tray.position.set(0, 0.28, 0.5);
  group.add(tray);

  return group;
}

/**
 * 9. FLOATING SHARK MEAT DROP
 * Succulent prime cut of Bruce dropped upon defeat with floating marker buoy
 */
export function createSharkMeatMesh(): THREE.Group {
  const group = new THREE.Group();

  // Floating orange marker buoy
  const buoyGeo = new THREE.SphereGeometry(0.18, 8, 8);
  const buoyMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4, metalness: 0.2 });
  const buoy = new THREE.Mesh(buoyGeo, buoyMat);
  buoy.position.set(0, 0.15, 0);
  buoy.castShadow = true;
  group.add(buoy);

  // Flagstick
  const stickGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.45, 4);
  const stickMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const stick = new THREE.Mesh(stickGeo, stickMat);
  stick.position.set(0, 0.35, 0);
  group.add(stick);

  // Little red ribbon pennant
  const flagGeo = new THREE.BufferGeometry();
  const verts = new Float32Array([0, 0.52, 0, 0.22, 0.46, 0, 0, 0.4, 0]);
  flagGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  flagGeo.computeVertexNormals();
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide }));
  group.add(flag);

  // Large Prime Shark Meat Slab floating underneath
  const meatShape = new THREE.Shape();
  meatShape.moveTo(0, 0);
  meatShape.quadraticCurveTo(0.2, 0.25, 0.45, 0.15);
  meatShape.quadraticCurveTo(0.55, -0.15, 0.3, -0.35);
  meatShape.quadraticCurveTo(0.0, -0.4, -0.25, -0.25);
  meatShape.quadraticCurveTo(-0.35, 0.1, 0, 0);
  meatShape.closePath();

  const meatGeo = new THREE.ExtrudeGeometry(meatShape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03 });
  meatGeo.rotateX(Math.PI / 2);
  const meatMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5, metalness: 0.1 });
  const meat = new THREE.Mesh(meatGeo, meatMat);
  meat.position.set(0, -0.05, 0);
  meat.castShadow = true;
  group.add(meat);

  // Center bone marrow ring
  const boneGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.22, 8);
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.7 });
  const bone = new THREE.Mesh(boneGeo, boneMat);
  bone.position.set(0.08, -0.05, -0.05);
  group.add(bone);

  return group;
}

/**
 * 10. DRIFTING MERCHANT OUTPOST RAFT
 * Reinforced trade barge with survivor NPC, canopy stall, barter crates & lanterns
 */
export function createMerchantRaftMesh(): THREE.Group {
  const group = new THREE.Group();

  // Multi-plank catamaran hull
  const hullW = 4.2;
  const hullL = 4.2;
  const deckGeo = new THREE.BoxGeometry(hullW, 0.38, hullL);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.85 });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.set(0, 0.19, 0);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Perimeter steel scrap barricade railing
  const barriMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.7 });
  const b1 = new THREE.Mesh(new THREE.BoxGeometry(hullW, 0.7, 0.12), barriMat);
  b1.position.set(0, 0.65, -hullL / 2 + 0.1);
  const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, hullL), barriMat);
  b2.position.set(-hullW / 2 + 0.1, 0.65, 0);
  const b3 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, hullL), barriMat);
  b3.position.set(hullW / 2 - 0.1, 0.65, 0);
  group.add(b1, b2, b3);

  // Striped Survivor Trading Stall Canopy Awning
  const canopyGeo = new THREE.BoxGeometry(2.8, 0.08, 2.4);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.8, side: THREE.DoubleSide });
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 2.4, -0.4);
  canopy.castShadow = true;
  group.add(canopy);

  // 4 Canopy Posts
  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.1, 6);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x78350f });
  [
    [-1.2, -1.4],
    [1.2, -1.4],
    [-1.2, 0.6],
    [1.2, 0.6],
  ].forEach(([px, pz]) => {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(px, 1.35, pz);
    post.castShadow = true;
    group.add(post);
  });

  // Trade Counter Desk
  const counterGeo = new THREE.BoxGeometry(2.2, 0.8, 0.7);
  const counterMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 });
  const counter = new THREE.Mesh(counterGeo, counterMat);
  counter.position.set(0, 0.75, 0.4);
  counter.castShadow = true;
  group.add(counter);

  // Trade Goods on counter (Salvaged blocks, power cell, ingots)
  const blockGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.7 });
  const bMesh1 = new THREE.Mesh(blockGeo, blockMat);
  bMesh1.position.set(-0.6, 1.25, 0.4);
  const bMesh2 = new THREE.Mesh(blockGeo, blockMat);
  bMesh2.position.set(-0.6, 1.48, 0.4);
  group.add(bMesh1, bMesh2);

  // Glowing Lantern on mast
  const lanternGeo = new THREE.DodecahedronGeometry(0.14, 0);
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.0,
    roughness: 0.2,
  });
  const lantern = new THREE.Mesh(lanternGeo, lanternMat);
  lantern.position.set(1.2, 2.2, 0.6);
  group.add(lantern);

  // Merchant NPC Survivor behind counter
  const npcGroup = new THREE.Group();
  npcGroup.position.set(0, 0.38, -0.3);

  // Torso (Survivor Vest)
  const npcTorso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x0284c7 }));
  npcTorso.position.set(0, 0.8, 0);
  npcGroup.add(npcTorso);

  // Head with bandana
  const npcHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), new THREE.MeshStandardMaterial({ color: 0xfbcfe8 }));
  npcHead.position.set(0, 1.3, 0);
  const bandana = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.32), new THREE.MeshStandardMaterial({ color: 0xdc2626 }));
  bandana.position.set(0, 1.4, 0);
  npcGroup.add(npcHead, bandana);

  group.add(npcGroup);

  // Overhead Trade Sign Billboard
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 256;
  signCanvas.height = 64;
  const ctx = signCanvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1e293b';
    ctx.roundRect(0, 0, 256, 64, 12);
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚖️ Survivor Merchant', 128, 32);
  }
  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 0.45),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide })
  );
  signMesh.name = 'merchantSign';
  signMesh.position.set(0, 2.8, 0.8);
  group.add(signMesh);

  return group;
}

