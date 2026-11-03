/**
 * 漂流商人筏网格（visual 层）：MerchantSystem.spawn 使用。
 */
import * as THREE from 'three';

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
