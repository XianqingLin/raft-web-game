import * as THREE from 'three';
import { ResourceId } from '../../types/game';
import { soundManager } from '../../audio/soundManager';

export interface IslandResource {
  id: string;
  type: 'coconut' | 'driftwood' | 'stone' | 'berry' | 'nest' | 'crate' | 'ore';
  pos: THREE.Vector3;
  mesh: THREE.Group;
  harvested: boolean;
  respawnTimer: number;
  yields: Partial<Record<ResourceId, number>>;
  prompt: string;
}

export interface IslandManager {
  group: THREE.Group;
  resources: IslandResource[];
  getHeightAt: (x: number, z: number) => number;
  update: (dt: number) => void;
  checkResourceInteract: (raycaster: THREE.Raycaster, cameraPos: THREE.Vector3) => IslandResource | null;
  harvestResource: (res: IslandResource, onAddInventory: (id: ResourceId, count: number) => boolean, onToast: (msg: string, color?: string) => void) => boolean;
  dispose: () => void;
}

// Island definitions with exact coordinates and radii
const ISLAND_DEFS = [
  {
    name: 'Coral Bay Isle',
    cx: 48,
    cz: -52,
    radius: 34,
    peakHeight: 6.8,
    frequency: 0.14,
  },
  {
    name: 'Isla Tortuga Atoll',
    cx: -56,
    cz: 34,
    radius: 38,
    peakHeight: 5.2,
    frequency: 0.12,
  },
  {
    name: 'Emerald Palm Sanctuary',
    cx: -32,
    cz: -75,
    radius: 32,
    peakHeight: 6.2,
    frequency: 0.15,
  },
  {
    name: 'Sunken Ruin Isle',
    cx: 72,
    cz: 65,
    radius: 36,
    peakHeight: 7.4,
    frequency: 0.13,
  },
];

/**
 * Analytical height function for the island terrain.
 * Guarantees 100% sync between 3D visual mesh and player collision physics.
 */
export function getIslandTerrainHeight(x: number, z: number): number {
  let maxHeight = -Infinity;

  for (const isle of ISLAND_DEFS) {
    const dx = x - isle.cx;
    const dz = z - isle.cz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < isle.radius) {
      // Normalized distance 0 at center, 1 at beach border
      const t = 1 - dist / isle.radius;
      // Smooth bell curve elevation
      const baseH = Math.pow(t, 1.8) * isle.peakHeight;

      // Natural organic noise hills, ridges, and beach curves
      const detail =
        Math.sin(dx * isle.frequency * 1.5 + dz * 0.1) * 0.75 +
        Math.cos(dz * isle.frequency * 1.8 - dx * 0.1) * 0.65 +
        Math.sin((dx + dz) * 0.3) * 0.25;

      // Submerge below water level outside beach zone
      const finalH = baseH + detail * t - 0.35;
      if (finalH > maxHeight) {
        maxHeight = finalH;
      }
    }
  }

  return maxHeight;
}

/**
 * Creates procedural curved tropical palm tree
 */
function createPalmTree(x: number, z: number, y: number, height = 5.5, leanAngle = 0.25, rotY = 0): THREE.Group {
  const tree = new THREE.Group();
  tree.position.set(x, y, z);
  tree.rotation.y = rotY;

  // Trunk with segments
  const trunkSegments = 7;
  const segHeight = height / trunkSegments;
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x8b5a2b,
    roughness: 0.85,
  });

  let currentPos = new THREE.Vector3(0, 0, 0);
  let currentRotZ = 0;

  for (let i = 0; i < trunkSegments; i++) {
    const radiusTop = 0.22 - (i / trunkSegments) * 0.08;
    const radiusBottom = 0.26 - (i / trunkSegments) * 0.08;
    const segGeo = new THREE.CylinderGeometry(radiusTop, radiusBottom, segHeight, 7);
    segGeo.translate(0, segHeight / 2, 0);
    const segMesh = new THREE.Mesh(segGeo, trunkMat);
    segMesh.castShadow = true;
    segMesh.receiveShadow = true;

    segMesh.position.copy(currentPos);
    segMesh.rotation.z = currentRotZ;
    tree.add(segMesh);

    // Cumulative curve
    const leanStep = leanAngle / trunkSegments;
    currentRotZ += leanStep;
    currentPos.x += Math.sin(currentRotZ) * segHeight;
    currentPos.y += Math.cos(currentRotZ) * segHeight;
  }

  // Crown of lush palm fronds
  const frondCount = 8;
  const frondMat = new THREE.MeshStandardMaterial({
    color: 0x15803d, // Lush tropical palm green
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

  const crownGroup = new THREE.Group();
  crownGroup.position.copy(currentPos);

  for (let f = 0; f < frondCount; f++) {
    const angle = (f / frondCount) * Math.PI * 2;
    const frondGeo = new THREE.ConeGeometry(0.7, 3.2, 5);
    frondGeo.rotateX(Math.PI / 2);
    frondGeo.scale(1, 0.15, 1);
    frondGeo.translate(0, 0, 1.5);

    const frondMesh = new THREE.Mesh(frondGeo, frondMat);
    frondMesh.castShadow = true;
    frondMesh.rotation.y = angle;
    frondMesh.rotation.x = 0.45; // Arched downward
    crownGroup.add(frondMesh);
  }

  // Hanging coconuts in the crown
  const coconutMat = new THREE.MeshStandardMaterial({
    color: 0x5c3d2e,
    roughness: 0.9,
  });
  for (let c = 0; c < 3; c++) {
    const nutGeo = new THREE.SphereGeometry(0.18, 6, 6);
    nutGeo.scale(1, 1.25, 1);
    const nut = new THREE.Mesh(nutGeo, coconutMat);
    const nutAngle = (c / 3) * Math.PI * 2 + 0.3;
    nut.position.set(Math.cos(nutAngle) * 0.3, -0.2, Math.sin(nutAngle) * 0.3);
    crownGroup.add(nut);
  }

  tree.add(crownGroup);
  return tree;
}

/**
 * Creates natural weathered coastal boulder
 */
function createBoulder(x: number, y: number, z: number, scale = 1.0): THREE.Group {
  const rockGroup = new THREE.Group();
  rockGroup.position.set(x, y, z);

  const rockGeo = new THREE.DodecahedronGeometry(1.2 * scale, 1);
  // Jitter vertices for organic rocky facets
  const pos = rockGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    pos.setXYZ(i, vx * (0.9 + Math.sin(vx * 4) * 0.15), vy * 0.75, vz * (0.9 + Math.cos(vz * 4) * 0.15));
  }
  rockGeo.computeVertexNormals();

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x64748b, // Slate granite rock
    roughness: 0.88,
  });

  const rockMesh = new THREE.Mesh(rockGeo, rockMat);
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  rockMesh.rotation.set(Math.random(), Math.random(), Math.random());
  rockGroup.add(rockMesh);

  return rockGroup;
}

/**
 * Creates harvestable coconut pickup model
 */
function createCoconutPickupMesh(): THREE.Group {
  const group = new THREE.Group();
  const nutMat = new THREE.MeshStandardMaterial({
    color: 0x78350f, // Brown fibrous coconut
    roughness: 0.9,
  });
  const huskMat = new THREE.MeshStandardMaterial({
    color: 0x84cc16, // Fresh green husk patch
    roughness: 0.7,
  });

  const nutGeo = new THREE.SphereGeometry(0.22, 8, 8);
  nutGeo.scale(1, 1.25, 1);
  const nutMesh = new THREE.Mesh(nutGeo, nutMat);
  nutMesh.castShadow = true;

  const huskGeo = new THREE.ConeGeometry(0.12, 0.14, 5);
  const huskMesh = new THREE.Mesh(huskGeo, huskMat);
  huskMesh.position.y = 0.22;

  group.add(nutMesh, huskMesh);
  return group;
}

/**
 * Creates harvestable driftwood log pickup model
 */
function createDriftwoodMesh(): THREE.Group {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x92400e, // Weathered washed timber
    roughness: 0.85,
  });

  const logGeo = new THREE.CylinderGeometry(0.16, 0.18, 1.4, 6);
  logGeo.rotateZ(Math.PI / 2);
  const logMesh = new THREE.Mesh(logGeo, woodMat);
  logMesh.castShadow = true;
  logMesh.position.y = 0.12;

  const branchGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.6, 5);
  branchGeo.rotateX(Math.PI / 3);
  const branchMesh = new THREE.Mesh(branchGeo, woodMat);
  branchMesh.position.set(0.3, 0.2, 0.2);

  group.add(logMesh, branchMesh);
  return group;
}

/**
 * Creates harvestable loose stone rock pickup model
 */
function createLooseStoneMesh(): THREE.Group {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.92,
  });

  const s1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 0), stoneMat);
  s1.position.set(0, 0.12, 0);
  s1.castShadow = true;

  const s2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), stoneMat);
  s2.position.set(0.22, 0.08, 0.1);
  s2.castShadow = true;

  group.add(s1, s2);
  return group;
}

/**
 * Creates harvestable Wild Coral Berry Bush model
 */
function createBerryBushMesh(): THREE.Group {
  const group = new THREE.Group();
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.7 });
  const berryMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.3 });

  // Bush body
  const bushMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 1), foliageMat);
  bushMesh.position.y = 0.45;
  bushMesh.castShadow = true;
  group.add(bushMesh);

  // Red cluster berries
  const berryOffsets = [
    [0.3, 0.6, 0.3],
    [-0.32, 0.55, 0.25],
    [0.1, 0.8, -0.3],
    [-0.2, 0.7, -0.25],
    [0.35, 0.4, -0.15],
  ];
  berryOffsets.forEach(([bx, by, bz]) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), berryMat);
    b.position.set(bx, by, bz);
    group.add(b);
  });

  return group;
}

/**
 * Creates harvestable Seagull Nest with eggs and feathers
 */
function createSeagullNestMesh(): THREE.Group {
  const group = new THREE.Group();
  const twigMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.95 });
  const eggMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.4 });
  const featherMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });

  // Woven twig nest bowl
  const bowlGeo = new THREE.TorusGeometry(0.35, 0.1, 6, 12);
  bowlGeo.rotateX(Math.PI / 2);
  const bowl = new THREE.Mesh(bowlGeo, twigMat);
  bowl.position.y = 0.08;
  bowl.castShadow = true;
  group.add(bowl);

  // Two eggs
  const egg1 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), eggMat);
  egg1.scale.set(1, 1.3, 1);
  egg1.position.set(-0.08, 0.1, 0);
  const egg2 = egg1.clone();
  egg2.position.set(0.08, 0.1, 0.04);
  group.add(egg1, egg2);

  // Plucked white feathers
  const fGeo = new THREE.ConeGeometry(0.06, 0.35, 4);
  fGeo.rotateZ(Math.PI / 4);
  const fMesh = new THREE.Mesh(fGeo, featherMat);
  fMesh.position.set(0.2, 0.14, -0.1);
  group.add(fMesh);

  return group;
}

/**
 * Creates Castaway Ruin Supply Crate
 */
function createSupplyCrateMesh(): THREE.Group {
  const group = new THREE.Group();
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x854d0e, roughness: 0.8 });
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7 });

  const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), crateMat);
  box.position.y = 0.3;
  box.castShadow = true;
  group.add(box);

  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.72), strapMat);
  strap.position.y = 0.3;
  group.add(strap);

  return group;
}

/**
 * Creates Shallow Coral Reef Ore Vein
 */
function createCoralOreMesh(): THREE.Group {
  const group = new THREE.Group();
  const coralMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.6 });
  const oreMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.3 });

  const mound = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 1), coralMat);
  mound.position.y = 0.2;
  group.add(mound);

  // Metal nuggets
  for (let i = 0; i < 3; i++) {
    const nugget = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), oreMat);
    nugget.position.set(Math.sin(i * 2) * 0.25, 0.35, Math.cos(i * 2) * 0.25);
    nugget.rotation.set(Math.random(), Math.random(), 0);
    group.add(nugget);
  }

  return group;
}

export function createIslandManager(scene: THREE.Scene): IslandManager {
  const group = new THREE.Group();
  scene.add(group);

  const resources: IslandResource[] = [];
  let nextResId = 1;

  // Build each island
  for (const isle of ISLAND_DEFS) {
    const segments = 64;
    const terrainSize = isle.radius * 2.3;
    const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, segments, segments);
    terrainGeo.rotateX(-Math.PI / 2);

    const posAttr = terrainGeo.attributes.position;
    const colorAttr = new Float32Array(posAttr.count * 3);

    const sandColor = new THREE.Color(0xf6d799); // Warm golden beach sand
    const wetSandColor = new THREE.Color(0x38bdf8); // Turquoise submerged coral fringe
    const grassColor = new THREE.Color(0x16a34a); // Lush tropical grass
    const deepGrassColor = new THREE.Color(0x15803d); // Deep rainforest green
    const rockColor = new THREE.Color(0x64748b); // Granite cliff rock

    for (let i = 0; i < posAttr.count; i++) {
      const localX = posAttr.getX(i);
      const localZ = posAttr.getZ(i);
      const worldX = isle.cx + localX;
      const worldZ = isle.cz + localZ;

      const h = getIslandTerrainHeight(worldX, worldZ);
      // Clamp bottom so it doesn't drop down indefinitely
      const finalY = Math.max(-2.5, h);
      posAttr.setY(i, finalY);

      // Vertex color gradient based on terrain height and steepness
      const c = new THREE.Color();
      if (finalY < 0.1) {
        c.lerpColors(wetSandColor, sandColor, Math.max(0, (finalY + 1.0) / 1.1));
      } else if (finalY < 1.3) {
        c.copy(sandColor);
      } else if (finalY < 2.2) {
        const t = (finalY - 1.3) / 0.9;
        c.lerpColors(sandColor, grassColor, t);
      } else if (finalY < 4.2) {
        const t = (finalY - 2.2) / 2.0;
        c.lerpColors(grassColor, deepGrassColor, t);
      } else {
        const t = Math.min(1.0, (finalY - 4.2) / 2.0);
        c.lerpColors(deepGrassColor, rockColor, t);
      }

      colorAttr[i * 3] = c.r;
      colorAttr[i * 3 + 1] = c.g;
      colorAttr[i * 3 + 2] = c.b;
    }

    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
    });

    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.position.set(isle.cx, 0, isle.cz);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    group.add(terrainMesh);

    // Populate Palm Trees on the island
    const palmPositions = [
      { r: 0.35, angle: 0.4, h: 5.8, lean: 0.3 },
      { r: 0.55, angle: 1.2, h: 6.2, lean: 0.25 },
      { r: 0.4, angle: 2.1, h: 5.4, lean: 0.35 },
      { r: 0.65, angle: 3.2, h: 6.0, lean: 0.2 },
      { r: 0.5, angle: 4.5, h: 5.6, lean: 0.28 },
      { r: 0.7, angle: 5.3, h: 6.4, lean: 0.32 },
    ];

    palmPositions.forEach((p, idx) => {
      const dist = p.r * isle.radius;
      const px = isle.cx + Math.cos(p.angle) * dist;
      const pz = isle.cz + Math.sin(p.angle) * dist;
      const py = getIslandTerrainHeight(px, pz);

      if (py > 0.4) {
        const palm = createPalmTree(px, pz, py, p.h, p.lean, p.angle + Math.PI / 2);
        group.add(palm);

        // Place a collectible coconut pickup under the palm!
        const nutOffsetAngle = p.angle + Math.PI * 0.4;
        const nutX = px + Math.cos(nutOffsetAngle) * (1.8 + (idx % 2) * 0.8);
        const nutZ = pz + Math.sin(nutOffsetAngle) * (1.8 + (idx % 2) * 0.8);
        const nutY = getIslandTerrainHeight(nutX, nutZ);

        if (nutY > 0.15) {
          const nutMesh = createCoconutPickupMesh();
          nutMesh.position.set(nutX, nutY + 0.1, nutZ);
          nutMesh.rotation.y = Math.random() * Math.PI * 2;
          group.add(nutMesh);

          resources.push({
            id: `coconut_${nextResId++}`,
            type: 'coconut',
            pos: new THREE.Vector3(nutX, nutY + 0.1, nutZ),
            mesh: nutMesh,
            harvested: false,
            respawnTimer: 0,
            yields: { coconut: 1 },
            prompt: '[E] Harvest Fresh Coconut (+25 Thirst, +20 Hunger)',
          });
        }
      }
    });

    // Populate Coastal Boulders
    const boulderAngles = [0.2, 1.6, 2.8, 3.9, 4.9, 5.8];
    boulderAngles.forEach((angle, idx) => {
      const dist = (0.75 + (idx % 3) * 0.1) * isle.radius;
      const bx = isle.cx + Math.cos(angle) * dist;
      const bz = isle.cz + Math.sin(angle) * dist;
      const by = getIslandTerrainHeight(bx, bz);
      const boulder = createBoulder(bx, by, bz, 1.2 + (idx % 2) * 0.6);
      group.add(boulder);

      // Add collectible stone deposit nearby
      const stoneX = bx + Math.cos(angle + 0.3) * 2.2;
      const stoneZ = bz + Math.sin(angle + 0.3) * 2.2;
      const stoneY = getIslandTerrainHeight(stoneX, stoneZ);
      if (stoneY > 0.1) {
        const stoneMesh = createLooseStoneMesh();
        stoneMesh.position.set(stoneX, stoneY, stoneZ);
        stoneMesh.rotation.y = Math.random() * Math.PI * 2;
        group.add(stoneMesh);

        resources.push({
          id: `stone_${nextResId++}`,
          type: 'stone',
          pos: new THREE.Vector3(stoneX, stoneY, stoneZ),
          mesh: stoneMesh,
          harvested: false,
          respawnTimer: 0,
          yields: { stone: 2 },
          prompt: '[E] Collect Stone Ballast (+2 Stone)',
        });
      }
    });

    // Populate Beach Driftwood Logs
    const logAngles = [0.9, 2.4, 3.6, 5.2];
    logAngles.forEach((angle) => {
      const dist = 0.82 * isle.radius;
      const lx = isle.cx + Math.cos(angle) * dist;
      const lz = isle.cz + Math.sin(angle) * dist;
      const ly = getIslandTerrainHeight(lx, lz);

      if (ly > 0.1) {
        const woodMesh = createDriftwoodMesh();
        woodMesh.position.set(lx, ly, lz);
        woodMesh.rotation.y = angle + Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        group.add(woodMesh);

        resources.push({
          id: `driftwood_${nextResId++}`,
          type: 'driftwood',
          pos: new THREE.Vector3(lx, ly, lz),
          mesh: woodMesh,
          harvested: false,
          respawnTimer: 0,
          yields: { wood: 3 },
          prompt: '[E] Salvage Island Driftwood (+3 Wood Planks)',
        });
      }
    });

    // Populate Wild Coral Berry Bushes
    const bushAngles = [0.6, 2.0, 3.8, 5.0];
    bushAngles.forEach((angle) => {
      const dist = 0.55 * isle.radius;
      const bx = isle.cx + Math.cos(angle) * dist;
      const bz = isle.cz + Math.sin(angle) * dist;
      const by = getIslandTerrainHeight(bx, bz);
      if (by > 0.8) {
        const bushMesh = createBerryBushMesh();
        bushMesh.position.set(bx, by, bz);
        group.add(bushMesh);

        resources.push({
          id: `berry_${nextResId++}`,
          type: 'berry',
          pos: new THREE.Vector3(bx, by + 0.3, bz),
          mesh: bushMesh,
          harvested: false,
          respawnTimer: 0,
          yields: { berry: 3 },
          prompt: '[E] Harvest Wild Coral Berries (+15 Thirst, +12 Hunger)',
        });
      }
    });

    // Populate Seagull Nests on High Rock Crags
    const nestAngles = [1.4, 4.2];
    nestAngles.forEach((angle) => {
      const dist = 0.3 * isle.radius;
      const nx = isle.cx + Math.cos(angle) * dist;
      const nz = isle.cz + Math.sin(angle) * dist;
      const ny = getIslandTerrainHeight(nx, nz);
      if (ny > 2.5) {
        const nestMesh = createSeagullNestMesh();
        nestMesh.position.set(nx, ny + 0.1, nz);
        group.add(nestMesh);

        resources.push({
          id: `nest_${nextResId++}`,
          type: 'nest',
          pos: new THREE.Vector3(nx, ny + 0.2, nz),
          mesh: nestMesh,
          harvested: false,
          respawnTimer: 0,
          yields: { egg: 1, feather: 2 },
          prompt: '[E] Gather Seagull Nest (+1 Egg, +2 Feathers)',
        });
      }
    });

    // Populate Castaway Supply Crates
    const crateAngle = (isle.cx > 0 ? 0.3 : 3.5);
    const crateDist = 0.65 * isle.radius;
    const cx = isle.cx + Math.cos(crateAngle) * crateDist;
    const cz = isle.cz + Math.sin(crateAngle) * crateDist;
    const cy = getIslandTerrainHeight(cx, cz);
    if (cy > 0.3) {
      const crateMesh = createSupplyCrateMesh();
      crateMesh.position.set(cx, cy, cz);
      group.add(crateMesh);

      resources.push({
        id: `crate_${nextResId++}`,
        type: 'crate',
        pos: new THREE.Vector3(cx, cy + 0.3, cz),
        mesh: crateMesh,
        harvested: false,
        respawnTimer: 0,
        yields: { wood: 4, scrap: 2, plastic: 3, bolt: 1 },
        prompt: '[E] Salvage Castaway Supply Crate (+Wood, Scrap, Plastic, Bolt)',
      });
    }

    // Populate Shallow Submerged Coral Reef Ore Veins
    const reefAngles = [0.1, 2.2, 4.4];
    reefAngles.forEach((angle) => {
      const dist = 1.05 * isle.radius; // In shallow water fringe!
      const rx = isle.cx + Math.cos(angle) * dist;
      const rz = isle.cz + Math.sin(angle) * dist;
      const ry = -0.4;
      const oreMesh = createCoralOreMesh();
      oreMesh.position.set(rx, ry, rz);
      group.add(oreMesh);

      resources.push({
        id: `ore_${nextResId++}`,
        type: 'ore',
        pos: new THREE.Vector3(rx, ry + 0.3, rz),
        mesh: oreMesh,
        harvested: false,
        respawnTimer: 0,
        yields: { metal_ingot: 1, scrap: 2 },
        prompt: '[E] Mine Shallow Reef Metal Ore (+1 Ingot, +2 Scrap)',
      });
    });
  }

  const getHeightAt = (x: number, z: number): number => {
    return getIslandTerrainHeight(x, z);
  };

  const update = (dt: number) => {
    // Respawn timer for harvested resources
    for (const res of resources) {
      if (res.harvested) {
        res.respawnTimer -= dt;
        if (res.respawnTimer <= 0) {
          res.harvested = false;
          res.mesh.visible = true;
        }
      } else {
        // Subtle idle bob/glow
        if (res.type === 'coconut' || res.type === 'berry') {
          res.mesh.rotation.y += dt * 0.6;
        }
      }
    }
  };

  const checkResourceInteract = (raycaster: THREE.Raycaster, cameraPos: THREE.Vector3): IslandResource | null => {
    let closestRes: IslandResource | null = null;
    let minDistance = 3.6; // 3.6 meter reach

    for (const res of resources) {
      if (res.harvested) continue;
      const dist = cameraPos.distanceTo(res.pos);
      if (dist < minDistance) {
        // Check if camera is pointing generally towards it
        const dirToRes = res.pos.clone().sub(cameraPos).normalize();
        const lookDir = raycaster.ray.direction;
        const dot = lookDir.dot(dirToRes);
        if (dot > 0.72) {
          closestRes = res;
          minDistance = dist;
        }
      }
    }

    return closestRes;
  };

  const harvestResource = (
    res: IslandResource,
    onAddInventory: (id: ResourceId, count: number) => boolean,
    onToast: (msg: string, color?: string) => void
  ): boolean => {
    if (res.harvested) return false;

    let success = false;
    for (const [id, count] of Object.entries(res.yields)) {
      if (count && onAddInventory(id as ResourceId, count)) {
        success = true;
        let color = '#38bdf8';
        if (id === 'coconut') color = '#84cc16';
        else if (id === 'wood') color = '#ca8a04';
        else if (id === 'berry') color = '#f43f5e';
        else if (id === 'egg') color = '#fef08a';
        else if (id === 'feather') color = '#e2e8f0';
        else if (id === 'metal_ingot') color = '#cbd5e1';
        else if (id === 'scrap') color = '#94a3b8';
        onToast(`+${count} ${id.toUpperCase()}`, color);
      }
    }

    if (success) {
      res.harvested = true;
      res.mesh.visible = false;
      res.respawnTimer = 90; // Respawn in 90s
      soundManager.playGather();
    }
    return success;
  };

  const dispose = () => {
    scene.remove(group);
  };

  return {
    group,
    resources,
    getHeightAt,
    update,
    checkResourceInteract,
    harvestResource,
    dispose,
  };
}
