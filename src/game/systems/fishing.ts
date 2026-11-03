import type { WorldView } from '../worldView';
import * as THREE from 'three';
import { soundManager } from '../../audio/soundManager';

export type FishingState = 'IDLE' | 'CASTING' | 'WAITING' | 'APPROACHING' | 'BITING' | 'REELING';

export interface CatchResult {
  caught: boolean;
  item: 'raw_fish' | 'raw_potato' | 'scrap';
  name: string;
}

export interface FishingSystemContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 玩家位置 getter（鱼跃落点/收线目标） */
  getPlayerPos: () => THREE.Vector3;
  /** 捕获成功时入包（GameWorld 接线到 InventorySystem） */
  addItemToInventory: (itemId: 'raw_fish' | 'raw_potato' | 'scrap', count: number) => void;
  /** 捕获成功时消耗一次手持鱼竿耐久（InventorySystem 的物品消耗规则） */
  consumeRodDurability: () => void;
  onToast?: (msg: string, color: string) => void;
  onPromptChange?: (prompt: string | null) => void;
}

export class FishingSystem {
  public state: FishingState = 'IDLE';
  public bobberMesh: THREE.Group;
  public lineMesh: THREE.Line;
  private lineGeometry: THREE.BufferGeometry;
  private linePointsCount = 14;

  // Physics & Position
  public bobberPos = new THREE.Vector3();
  public bobberVel = new THREE.Vector3();
  private targetWaveY = 0;

  // Timers
  private waitTimer = 0;
  private totalWaitDuration = 0;
  private approachTimer = 0;
  private approachDuration = 1.6;
  private biteTimer = 0;
  private biteDuration = 2.0;

  // Approach bubble particles (Minecraft style)
  private approachStartPos = new THREE.Vector3();
  private bubbleParticles: THREE.Mesh[] = [];
  private bubbleGroup: THREE.Group = new THREE.Group();

  // Splash particle burst
  private splashParticles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];
  private splashGroup: THREE.Group = new THREE.Group();

  // Leaping fish on catch
  private leapingFish: THREE.Group | null = null;
  private leapProgress = 0;
  private leapStartPos = new THREE.Vector3();

  // Callbacks
  private onToast?: (msg: string, color: string) => void;
  private onPromptChange?: (prompt: string | null) => void;

  private scene: THREE.Scene;

  /** 第一人称模型中竿尖的局部偏移（乘相机世界矩阵得到世界坐标） */
  private static readonly ROD_TIP_OFFSET = new THREE.Vector3(0.38, -0.16, -1.2);

  constructor(private ctx: FishingSystemContext) {
    this.scene = ctx.scene;
    this.onToast = ctx.onToast;
    this.onPromptChange = ctx.onPromptChange;

    // 1. Bobber Mesh (Iconic Red & White float)
    this.bobberMesh = new THREE.Group();
    this.bobberMesh.name = 'fishingBobber';

    // Top Red Hemisphere
    const topGeo = new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const topMat = new THREE.MeshStandardMaterial({
      color: 0xef4444, // Bright red
      roughness: 0.25,
      metalness: 0.1,
    });
    const topHemisphere = new THREE.Mesh(topGeo, topMat);

    // Bottom White Hemisphere
    const bottomGeo = new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const bottomMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // Pure white
      roughness: 0.25,
      metalness: 0.1,
    });
    const bottomHemisphere = new THREE.Mesh(bottomGeo, bottomMat);

    // Antenna Quill Pin
    const pinGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.14, 6);
    const pinMat = new THREE.MeshStandardMaterial({ color: 0x78350f });
    const pin = new THREE.Mesh(pinGeo, pinMat);
    pin.position.y = 0.12;

    // Small Red Float Tip on pin
    const tipGeo = new THREE.SphereGeometry(0.03, 8, 8);
    const tip = new THREE.Mesh(tipGeo, topMat);
    tip.position.y = 0.18;

    this.bobberMesh.add(topHemisphere, bottomHemisphere, pin, tip);
    this.bobberMesh.visible = false;
    this.scene.add(this.bobberMesh);

    // 2. Dynamic Segmented Fishing Line (with realistic catenary droop)
    const points = new Float32Array(this.linePointsCount * 3);
    this.lineGeometry = new THREE.BufferGeometry();
    this.lineGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.85,
    });
    this.lineMesh = new THREE.Line(this.lineGeometry, lineMat);
    this.lineMesh.visible = false;
    this.scene.add(this.lineMesh);

    // 3. Minecraft-style Bubble Trail Pool
    this.scene.add(this.bubbleGroup);
    const bubbleGeo = new THREE.SphereGeometry(0.045, 6, 6);
    const bubbleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
    });
    for (let i = 0; i < 18; i++) {
      const bubble = new THREE.Mesh(bubbleGeo, bubbleMat.clone());
      bubble.visible = false;
      this.bubbleParticles.push(bubble);
      this.bubbleGroup.add(bubble);
    }

    // 4. Splash Burst Pool
    this.scene.add(this.splashGroup);
    const dropletGeo = new THREE.DodecahedronGeometry(0.035);
    const dropletMat = new THREE.MeshBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.9,
    });
    for (let i = 0; i < 20; i++) {
      const d = new THREE.Mesh(dropletGeo, dropletMat.clone());
      d.visible = false;
      this.splashParticles.push({
        mesh: d,
        vel: new THREE.Vector3(),
        life: 0,
      });
      this.splashGroup.add(d);
    }
  }

  /**
   * Cast the fishing rod into open sea
   */
  public cast(rodTipPos: THREE.Vector3, lookDir: THREE.Vector3) {
    this.state = 'CASTING';
    soundManager.playFishingCast();

    this.bobberPos.copy(rodTipPos);
    this.bobberMesh.position.copy(this.bobberPos);
    this.bobberMesh.visible = true;
    this.lineMesh.visible = true;

    // Arc forward with initial launch velocity
    const launchSpeed = 16.0;
    this.bobberVel.copy(lookDir).multiplyScalar(launchSpeed);
    this.bobberVel.y += 3.8; // Upward casting arc

    // Randomize time before fish approaches (3.5 to 7.0 seconds)
    this.totalWaitDuration = 3.5 + Math.random() * 3.5;
    this.waitTimer = 0;
    this.approachTimer = 0;
    this.biteTimer = 0;

    this.hideBubbles();
    this.onToast?.('Cast fishing line into the ocean...', '#38bdf8');
  }

  /**
   * Reel in the fishing rod
   */
  public reel(playerPos: THREE.Vector3): CatchResult {
    const wasBiting = this.state === 'BITING';
    const wasInWater = this.state === 'WAITING' || this.state === 'APPROACHING' || this.state === 'BITING';

    soundManager.playReelClick();

    if (wasBiting) {
      // SUCCESSFUL CATCH!
      this.state = 'REELING';
      soundManager.playFishCatch();
      this.spawnSplashBurst(this.bobberPos, 14);

      // Determine catch loot
      const r = Math.random();
      let lootItem: 'raw_fish' | 'raw_potato' | 'scrap' = 'raw_fish';
      let lootName = 'Raw Mackerel';
      if (r > 0.92) {
        lootItem = 'scrap';
        lootName = 'Sunken Scrap Metal';
      } else if (r > 0.85) {
        lootItem = 'raw_potato';
        lootName = 'Drifting Potato';
      }

      // Spawn leaping fish mesh towards player
      this.spawnLeapingFish(this.bobberPos, playerPos);

      this.onToast?.(`🎣 Splendid Catch! Reeled in ${lootName}!`, '#22c55e');

      // Reset bobber after brief reel
      setTimeout(() => {
        this.reset();
      }, 700);

      return {
        caught: true,
        item: lootItem,
        name: lootName,
      };
    } else {
      // Empty reel
      if (wasInWater) {
        this.onToast?.('Reeled in empty line.', '#94a3b8');
      }
      this.reset();
      return {
        caught: false,
        item: 'raw_fish',
        name: '',
      };
    }
  }

  /** 当前竿尖世界坐标（第一人称模型偏移 × 相机世界矩阵） */
  private getRodTip(): THREE.Vector3 {
    return FishingSystem.ROD_TIP_OFFSET.clone().applyMatrix4(this.ctx.camera.matrixWorld);
  }

  /**
   * 手持鱼竿时的左键动作：空闲则出竿，否则收线。
   * 捕获入包与耐久消耗在此一并路由，GameWorld 只负责按键分发。
   */
  public onPrimaryAction() {
    if (this.state === 'IDLE') {
      const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ctx.camera.quaternion).normalize();
      this.cast(this.getRodTip(), lookDir);
    } else {
      const result = this.reel(this.ctx.getPlayerPos());
      if (result.caught) {
        this.ctx.addItemToInventory(result.item, 1);
        this.ctx.consumeRodDurability();
      }
    }
  }

  public reset() {
    this.state = 'IDLE';
    this.bobberMesh.visible = false;
    this.lineMesh.visible = false;
    this.hideBubbles();
    if (this.leapingFish) {
      this.scene.remove(this.leapingFish);
      this.leapingFish = null;
    }
  }

  private hideBubbles() {
    this.bubbleParticles.forEach((b) => {
      b.visible = false;
    });
  }

  private triggerApproach() {
    this.state = 'APPROACHING';
    this.approachTimer = 0;
    soundManager.playFishApproach();

    // Pick a random approach angle 7 to 10 units away in the water
    const angle = Math.random() * Math.PI * 2;
    const dist = 7.0 + Math.random() * 3.0;
    this.approachStartPos.set(
      this.bobberPos.x + Math.cos(angle) * dist,
      0.02,
      this.bobberPos.z + Math.sin(angle) * dist
    );
  }

  private triggerBite() {
    this.state = 'BITING';
    this.biteTimer = 0;
    soundManager.playFishBite();
    this.spawnSplashBurst(this.bobberPos, 16);
    this.onToast?.('🐟 BITE! A fish struck! CLICK NOW TO REEL!', '#f59e0b');
  }

  private spawnSplashBurst(center: THREE.Vector3, count: number = 14) {
    soundManager.playWaterSplash(0.7);
    for (let i = 0; i < Math.min(count, this.splashParticles.length); i++) {
      const p = this.splashParticles[i];
      p.mesh.position.copy(center);
      p.mesh.position.y += 0.05;
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 2.0 + Math.random() * 2.8;
      p.vel.set(Math.cos(angle) * speed, 3.2 + Math.random() * 2.5, Math.sin(angle) * speed);
      p.life = 1.0;
      p.mesh.visible = true;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
    }
  }

  private spawnLeapingFish(start: THREE.Vector3, target: THREE.Vector3) {
    if (this.leapingFish) {
      this.scene.remove(this.leapingFish);
    }

    const fish = new THREE.Group();

    // Silvery ocean fish body
    const bodyGeo = new THREE.ConeGeometry(0.12, 0.55, 6);
    bodyGeo.rotateZ(Math.PI / 2);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.3,
      metalness: 0.6,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);

    // Tail fin
    const tailGeo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      -0.3, 0, 0,
      -0.5, 0.15, 0,
      -0.5, -0.15, 0,
    ]);
    tailGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const tailMat = new THREE.MeshBasicMaterial({ color: 0x0284c7, side: THREE.DoubleSide });
    const tail = new THREE.Mesh(tailGeo, tailMat);

    fish.add(body, tail);
    fish.position.copy(start);
    this.scene.add(fish);

    this.leapingFish = fish;
    this.leapStartPos.copy(start);
    this.leapProgress = 0;
  }

  /**
   * Main frame update
   */
  public update(
    dt: number,
    playerPos: THREE.Vector3,
    elapsed: number,
    getWaveHeight: (x: number, z: number) => number
  ) {
    // 1. Splash Particle Physics
    this.splashParticles.forEach((p) => {
      if (p.life > 0) {
        p.vel.y -= 14.0 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.life -= dt * 2.4;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life);
        if (p.life <= 0) p.mesh.visible = false;
      }
    });

    // 2. Leaping Fish Arc to Player
    if (this.leapingFish) {
      this.leapProgress += dt * 2.8;
      if (this.leapProgress >= 1.0) {
        this.scene.remove(this.leapingFish);
        this.leapingFish = null;
      } else {
        const t = this.leapProgress;
        const currentTarget = new THREE.Vector3(playerPos.x, playerPos.y + 0.2, playerPos.z);
        this.leapingFish.position.lerpVectors(this.leapStartPos, currentTarget, t);
        // Parabolic arc
        this.leapingFish.position.y += Math.sin(t * Math.PI) * 2.2;
        this.leapingFish.rotation.z = Math.sin(t * Math.PI * 6) * 0.4;
        this.leapingFish.lookAt(currentTarget);
      }
    }

    if (this.state === 'IDLE') {
      this.bobberMesh.visible = false;
      this.lineMesh.visible = false;
      return;
    }

    // 3. State Machine
    const oceanSurfaceY = getWaveHeight(this.bobberPos.x, this.bobberPos.z);

    if (this.state === 'CASTING') {
      // In-flight physics
      this.bobberVel.y -= 14.0 * dt;
      this.bobberPos.addScaledVector(this.bobberVel, dt);

      if (this.bobberPos.y <= oceanSurfaceY) {
        // Splash down into water!
        this.bobberPos.y = oceanSurfaceY;
        this.state = 'WAITING';
        soundManager.playWaterSplash(0.85);
        this.spawnSplashBurst(this.bobberPos, 8);
      }
    } else if (this.state === 'WAITING') {
      // Bobbing on ocean waves
      this.bobberPos.y = THREE.MathUtils.lerp(this.bobberPos.y, oceanSurfaceY, dt * 10);
      this.bobberMesh.rotation.z = Math.sin(elapsed * 3.0) * 0.15;
      this.bobberMesh.rotation.x = Math.cos(elapsed * 2.5) * 0.15;

      this.waitTimer += dt;
      if (this.waitTimer >= this.totalWaitDuration) {
        this.triggerApproach();
      }
    } else if (this.state === 'APPROACHING') {
      // Water bubbles racing towards bobber
      this.bobberPos.y = THREE.MathUtils.lerp(this.bobberPos.y, oceanSurfaceY, dt * 10);
      this.approachTimer += dt;
      const progress = Math.min(1.0, this.approachTimer / this.approachDuration);

      // Bubble position along path
      const currentBubbleFront = new THREE.Vector3().lerpVectors(this.approachStartPos, this.bobberPos, progress);

      // Spawn bubbles along trail
      const activeIdx = Math.floor(progress * (this.bubbleParticles.length - 1));
      for (let i = 0; i < this.bubbleParticles.length; i++) {
        const b = this.bubbleParticles[i];
        if (i <= activeIdx && i >= activeIdx - 4) {
          const trailT = (i / (this.bubbleParticles.length - 1)) * progress;
          b.position.lerpVectors(this.approachStartPos, this.bobberPos, trailT);
          b.position.y = getWaveHeight(b.position.x, b.position.z) + 0.03 + Math.sin(elapsed * 12 + i) * 0.02;
          b.visible = true;
          (b.material as THREE.MeshBasicMaterial).opacity = 0.85 - (activeIdx - i) * 0.18;
        } else {
          b.visible = false;
        }
      }

      if (progress >= 1.0) {
        this.hideBubbles();
        this.triggerBite();
      }
    } else if (this.state === 'BITING') {
      // Bobber plunges underwater and shakes vigorously!
      this.biteTimer += dt;
      const plungeY = oceanSurfaceY - 0.28 + Math.sin(elapsed * 28.0) * 0.08;
      this.bobberPos.y = THREE.MathUtils.lerp(this.bobberPos.y, plungeY, dt * 18);
      this.bobberMesh.rotation.x = (Math.random() - 0.5) * 0.6;
      this.bobberMesh.rotation.z = (Math.random() - 0.5) * 0.6;

      // Ongoing mini splashes while biting
      if (Math.random() < 0.2) {
        this.spawnSplashBurst(this.bobberPos, 3);
      }

      if (this.biteTimer >= this.biteDuration) {
        // Escaped!
        this.onToast?.('The fish got away! Cast again.', '#ef4444');
        this.state = 'WAITING';
        this.waitTimer = 0;
        this.totalWaitDuration = 3.5 + Math.random() * 3.0;
      }
    }

    this.bobberMesh.position.copy(this.bobberPos);

    // 4. Update Segmented Fishing Line with Natural Gravity Sag
    const linePos = this.lineGeometry.attributes.position.array as Float32Array;
    const start = this.getRodTip();
    const end = this.bobberPos.clone().add(new THREE.Vector3(0, 0.08, 0));
    const dist = start.distanceTo(end);

    // Sag depends on slack: more distance = less sag, bite = tight line
    const sagDepth = this.state === 'BITING' ? 0.05 : Math.min(1.2, dist * 0.08);

    for (let i = 0; i < this.linePointsCount; i++) {
      const t = i / (this.linePointsCount - 1);
      // Lerp straight line
      const lx = THREE.MathUtils.lerp(start.x, end.x, t);
      const ly = THREE.MathUtils.lerp(start.y, end.y, t);
      const lz = THREE.MathUtils.lerp(start.z, end.z, t);

      // Parabolic dip in middle
      const sag = Math.sin(t * Math.PI) * sagDepth;

      linePos[i * 3] = lx;
      linePos[i * 3 + 1] = ly - sag;
      linePos[i * 3 + 2] = lz;
    }
    this.lineGeometry.attributes.position.needsUpdate = true;
  }

  public dispose() {
    this.scene.remove(this.bobberMesh);
    this.scene.remove(this.lineMesh);
    this.scene.remove(this.bubbleGroup);
    this.scene.remove(this.splashGroup);
    if (this.leapingFish) this.scene.remove(this.leapingFish);
  }
}

// ==================== Factory（依赖接线集中于此，GameWorld 一行调用） ====================

export function createFishingSystem(w: WorldView): FishingSystem {
  return new FishingSystem({
    scene: w.scene,
    camera: w.camera,
    getPlayerPos: () => w.player().player.pos,
    addItemToInventory: (itemId, count) => w.inventory().addItemToInventory(itemId, count),
    consumeRodDurability: () => w.inventory().consumeRodDurability(),
    onToast: w.toast,
  });
}
