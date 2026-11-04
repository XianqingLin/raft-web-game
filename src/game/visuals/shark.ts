/**
 * 鲨鱼相关网格（visual 层）：鲨鱼本体、皮肤切换、掉落物鲨鱼肉。
 */
import * as THREE from 'three';

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
