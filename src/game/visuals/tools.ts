/**
 * 手持工具网格（visual 层）：钩爪、鱼叉与 FPS 视角工具模型。
 */
import * as THREE from 'three';
import { darkWoodMaterial, ironMaterial } from './shared';

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
  }

  return toolGroup;
}
