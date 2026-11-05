/**
 * 漂浮物网格（visual 层）：按 DebrisObject.type 构建对应外观。
 */
import * as THREE from 'three';
import { woodPlankMaterial, darkWoodMaterial, ironMaterial, ropeMaterial, plasticMaterial, leafMaterial } from './shared';

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
