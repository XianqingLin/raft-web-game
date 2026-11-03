import type { WorldView } from '../worldView';
import * as THREE from 'three';
import { SharkData, PlacedStructure, ItemId } from '../../types/game';
import { soundManager } from '../../audio/soundManager';
import { BLOCK_SIZE, createSharkMesh, applySharkSkin, createSharkMeatMesh } from '../visuals/models';
import { PlayerState } from '../context';

/**
 * Shark AI & Combat System (Bruce the Great White).
 * Extracted from engine.ts — owns shark state machine, mesh animation,
 * spear combat and the floating Prime Shark Meat drops.
 */
export interface SharkCallbacks {
  onToast: (text: string, color?: string) => void;
  onSharkAlert: (alerting: boolean) => void;
  onSharkDataChange?: (shark: SharkData) => void;
  onStatsChange: (stats: PlayerStatsLike) => void;
}
type PlayerStatsLike = PlayerState['stats'];

export interface SharkContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  player: PlayerState;
  structures: Map<string, PlacedStructure>;
  raftGroup: THREE.Group;
  callbacks: SharkCallbacks;
  addItemToInventory: (itemId: ItemId, count?: number) => boolean;
  saveWorld: (notify?: boolean) => void;
  getHookState: () => string;
  getHookPos: () => THREE.Vector3;
}

export class SharkSystem {
  public shark: SharkData = {
    health: 100,
    maxHealth: 100,
    state: 'CIRCLING',
    pos: { x: 20, y: -0.4, z: 0 },
    targetPos: { x: 20, y: -0.4, z: 0 },
    angle: 0,
    circleRadius: 18,
    speed: 3.5,
    targetPlankKey: null,
    biteTimer: 0,
    fleeTimer: 0,
    inWaterAttackTimer: 0,
  };
  public sharkMesh: THREE.Group;
  public sharkDefeatedOnce: boolean = false;
  public floatingMeatList: { id: number; mesh: THREE.Group; pos: THREE.Vector3; caught: boolean; bobPhase: number }[] = [];
  private nextMeatId = 1;
  private uiPushTimer: number = 0;

  // Context mirrors (engine-provided shared state & services)
  private ctx: SharkContext;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private player: PlayerState;
  private structures: Map<string, PlacedStructure>;
  private raftGroup: THREE.Group;
  private callbacks: SharkCallbacks;
  private addItemToInventory: (itemId: ItemId, count?: number) => boolean;
  private saveWorld: (notify?: boolean) => void;

  constructor(ctx: SharkContext) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.player = ctx.player;
    this.structures = ctx.structures;
    this.raftGroup = ctx.raftGroup;
    this.callbacks = ctx.callbacks;
    this.addItemToInventory = ctx.addItemToInventory;
    this.saveWorld = ctx.saveWorld;

    // Shark Mesh (High-Fidelity Predatory Great White)
    this.sharkMesh = createSharkMesh(this.sharkDefeatedOnce);
    this.scene.add(this.sharkMesh);
  }

  // Save restore
  setDefeated(v: boolean) {
    this.sharkDefeatedOnce = v;
    applySharkSkin(this.sharkMesh, v);
  }

  // World reset
  reset() {
    this.sharkDefeatedOnce = false;
    applySharkSkin(this.sharkMesh, false);
  }

  isNearMeat(pos: THREE.Vector3): boolean {
    return this.floatingMeatList.some((m) => pos.distanceTo(m.pos) < 3.2);
  }

  update(dt: number, elapsed: number) {
    // 1. Articulated Sinusoidal Spine Undulation Kinematics
    const headGroup = this.sharkMesh.getObjectByName('sharkHeadGroup') as THREE.Group;
    const torsoGroup = this.sharkMesh.getObjectByName('sharkTorso') as THREE.Group;
    const midGroup = this.sharkMesh.getObjectByName('sharkMid') as THREE.Group;
    const tailGroup = this.sharkMesh.getObjectByName('sharkTail') as THREE.Group;
    const tailFluke = this.sharkMesh.getObjectByName('sharkTailFluke') as THREE.Mesh;
    const lowerJaw = this.sharkMesh.getObjectByName('sharkLowerJaw') as THREE.Group;
    const pecL = this.sharkMesh.getObjectByName('sharkPecL') as THREE.Mesh;
    const pecR = this.sharkMesh.getObjectByName('sharkPecR') as THREE.Mesh;

    const currentSpeed = this.shark.state === 'FLEEING' ? 6.8 : this.shark.state === 'CIRCLING' ? 3.6 : 5.8;
    const swimFreq = currentSpeed * 1.6;
    const swimTime = elapsed * swimFreq;

    // Sinusoidal wave propagation through body segments
    if (headGroup) headGroup.rotation.y = Math.sin(swimTime) * 0.09;
    if (midGroup) midGroup.rotation.y = Math.sin(swimTime - 0.7) * 0.22;
    if (tailGroup) tailGroup.rotation.y = Math.sin(swimTime - 1.4) * 0.38;
    if (tailFluke) tailFluke.rotation.y = Math.sin(swimTime - 2.1) * 0.52;

    // Subtle hydrofoil pectoral fin dihedral rhythm
    if (pecL && pecR) {
      const pecFlap = Math.sin(swimTime * 0.5) * 0.08;
      pecL.rotation.z = 0.15 + pecFlap;
      pecR.rotation.z = 0.15 + pecFlap;
    }

    // Dynamic jaw snap biting animation
    if (lowerJaw) {
      if (this.shark.state === 'ATTACKING_RAFT' || this.shark.state === 'ATTACKING_PLAYER') {
        lowerJaw.rotation.z = (Math.sin(elapsed * 15) + 1) * 0.28;
      } else {
        lowerJaw.rotation.z = THREE.MathUtils.lerp(lowerJaw.rotation.z, 0, dt * 6);
      }
    }

    // Overhead 3D Health Bar update
    const hpBar = this.sharkMesh.getObjectByName('sharkHealthBar');
    if (hpBar) {
      if (this.shark.state === 'FLEEING') {
        hpBar.visible = false;
      } else {
        hpBar.visible = true;
        hpBar.quaternion.copy(this.camera.quaternion);
        const fill = hpBar.getObjectByName('sharkHealthFill') as THREE.Mesh;
        if (fill) {
          const ratio = Math.max(0, Math.min(1, this.shark.health / this.shark.maxHealth));
          fill.scale.x = ratio;
          if ((fill.material as any)?.color) {
            if (this.sharkDefeatedOnce) {
              (fill.material as any).color.setHex(0xdc2626); // Red blood bar
            } else {
              if (ratio > 0.6) (fill.material as any).color.setHex(0x22c55e);
              else if (ratio > 0.3) (fill.material as any).color.setHex(0xf59e0b);
              else (fill.material as any).color.setHex(0xef4444);
            }
          }
        }
      }
    }

    if (this.shark.state === 'FLEEING') {
      this.shark.fleeTimer -= dt;
      // Dive deep below water surface and swim away
      this.shark.pos.y = -8.0;
      this.shark.angle += (this.shark.speed * 1.5 * dt) / this.shark.circleRadius;
      const fleeX = Math.cos(this.shark.angle) * (this.shark.circleRadius + 15);
      const fleeZ = Math.sin(this.shark.angle) * (this.shark.circleRadius + 15);
      this.shark.pos.x = THREE.MathUtils.lerp(this.shark.pos.x, fleeX, dt * 1.5);
      this.shark.pos.z = THREE.MathUtils.lerp(this.shark.pos.z, fleeZ, dt * 1.5);

      if (this.shark.fleeTimer <= 0) {
        this.shark.state = 'CIRCLING';
        this.shark.health = 100;
        this.shark.pos.y = -0.35;
        if (this.sharkDefeatedOnce) {
          applySharkSkin(this.sharkMesh, true);
          this.callbacks.onToast('🩸 The Enraged Blood Bruce has returned to circle the raft...', '#ef4444');
        } else {
          this.callbacks.onToast('🦈 Bruce has recovered and returned to circle the raft...', '#f59e0b');
        }
      }
    } else {
      // Check if player is in water: stalking/attacking player!
      if (this.player.inWater) {
        this.player.waterTime += dt;
        if (this.player.waterTime > 3.0) {
          this.shark.state = 'ATTACKING_PLAYER';
          this.callbacks.onSharkAlert(true);
        }
      } else {
        this.player.waterTime = 0;
        if (this.shark.state === 'ATTACKING_PLAYER') {
          this.shark.state = 'CIRCLING';
          this.callbacks.onSharkAlert(false);
        }
      }

      if (this.shark.state === 'CIRCLING') {
        this.shark.angle += (this.shark.speed * dt) / this.shark.circleRadius;
        const tx = Math.cos(this.shark.angle) * this.shark.circleRadius;
        const tz = Math.sin(this.shark.angle) * this.shark.circleRadius;

        this.shark.pos.x = THREE.MathUtils.lerp(this.shark.pos.x, tx, dt * 2);
        this.shark.pos.z = THREE.MathUtils.lerp(this.shark.pos.z, tz, dt * 2);
        this.shark.pos.y = -0.35; // Fin breaks surface!

        // Shark attack raft timer
        this.shark.biteTimer += dt;
        if (this.shark.biteTimer > 85.0 && this.structures.size > 0) {
          const foundations: PlacedStructure[] = [];
          this.structures.forEach((s) => {
            if (s.type === 'foundation' || s.type === 'collection_net' || s.type === 'tri_foundation') {
              foundations.push(s);
            }
          });

          if (foundations.length > 0) {
            const target = foundations[Math.floor(Math.random() * foundations.length)];
            this.shark.targetPlankKey = target.id;
            this.shark.state = 'ATTACKING_RAFT';
            this.shark.biteTimer = 0;
            this.callbacks.onSharkAlert(true);
            this.callbacks.onToast('SHARK ATTACK! Bruce is biting your raft foundation! Jab with Spear!', '#ef4444');
          }
        }
      } else if (this.shark.state === 'ATTACKING_RAFT') {
        const targetPlank = this.structures.get(this.shark.targetPlankKey || '');
        if (!targetPlank) {
          this.shark.state = 'CIRCLING';
          this.callbacks.onSharkAlert(false);
          return;
        }

        const tx = targetPlank.gx * BLOCK_SIZE;
        const tz = targetPlank.gz * BLOCK_SIZE;
        const toPlank = new THREE.Vector3(tx - this.shark.pos.x, 0, tz - this.shark.pos.z);
        const dist = toPlank.length();

        if (dist > 1.2) {
          toPlank.normalize();
          this.shark.pos.x += toPlank.x * (this.shark.speed * 1.6) * dt;
          this.shark.pos.z += toPlank.z * (this.shark.speed * 1.6) * dt;
          this.shark.pos.y = -0.15;
        } else {
          // Biting plank!
          targetPlank.health -= 15 * dt;
          targetPlank.mesh.position.y = Math.sin(elapsed * 25) * 0.08;

          if (Math.random() < 0.05) {
            soundManager.playSharkBite();
          }

          if (targetPlank.health <= 0) {
            this.raftGroup.remove(targetPlank.mesh);
            this.structures.delete(targetPlank.id);
            this.shark.state = 'CIRCLING';
            this.callbacks.onSharkAlert(false);
            this.callbacks.onToast('Bruce destroyed a raft plank!', '#ef4444');
          }
        }
      } else if (this.shark.state === 'ATTACKING_PLAYER') {
        const toPlayer = new THREE.Vector3(this.player.pos.x - this.shark.pos.x, 0, this.player.pos.z - this.shark.pos.z);
        const dist = toPlayer.length();

        if (dist > 1.4) {
          toPlayer.normalize();
          this.shark.pos.x += toPlayer.x * (this.shark.speed * 1.8) * dt;
          this.shark.pos.z += toPlayer.z * (this.shark.speed * 1.8) * dt;
          this.shark.pos.y = -0.15;
        } else {
          this.player.stats.health -= 25 * dt;
          soundManager.playSharkBite();
          this.callbacks.onToast('BRUCE BIT YOU! (-25 Health)', '#ef4444');
          this.callbacks.onStatsChange({ ...this.player.stats });
        }
      }
    }

    // Realistic Turn-Rate Inertia, Banking Roll, and Pitch Dives
    const prevPos = this.sharkMesh.position.clone();
    this.sharkMesh.position.set(this.shark.pos.x, this.shark.pos.y, this.shark.pos.z);
    const deltaMove = this.sharkMesh.position.clone().sub(prevPos);

    if (deltaMove.lengthSq() > 0.0001) {
      // Calculate target horizontal yaw angle (model forward is along +X)
      const targetYaw = Math.atan2(-deltaMove.z, deltaMove.x);
      const currentYaw = this.sharkMesh.rotation.y;
      let diff = targetYaw - currentYaw;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;

      this.sharkMesh.rotation.y += diff * Math.min(1, dt * 5.2);

      // Realistic hydrodynamic banking roll into turns!
      const rollTarget = THREE.MathUtils.clamp(-diff * 2.4, -0.45, 0.45);
      if (torsoGroup) {
        torsoGroup.rotation.x = THREE.MathUtils.lerp(torsoGroup.rotation.x, rollTarget, dt * 4.5);
        // Vertical pitch up/down when diving or surfacing
        const pitchTarget = THREE.MathUtils.clamp(-deltaMove.y * 1.8, -0.42, 0.42);
        torsoGroup.rotation.z = THREE.MathUtils.lerp(torsoGroup.rotation.z, pitchTarget, dt * 4.5);
      }
    }

    // Push shark HUD data at most 4x/sec (event-driven push in spearThrust stays immediate)
    this.uiPushTimer -= dt;
    if (this.uiPushTimer <= 0) {
      this.uiPushTimer = 0.25;
      this.callbacks.onSharkDataChange?.({ ...this.shark });
    }
  }

  // Spear Thrust Action against Bruce the Shark
  spearThrust(toolModel: THREE.Group | null) {
    soundManager.playSpearThrust();

    // Visual thrust punch animation
    if (toolModel) {
      toolModel.position.z -= 0.45;
      setTimeout(() => {
        if (toolModel) toolModel.position.z += 0.45;
      }, 120);
    }

    // Check hit against shark
    const sharkWorldPos = new THREE.Vector3(this.shark.pos.x, this.shark.pos.y, this.shark.pos.z);
    const distToShark = this.camera.position.distanceTo(sharkWorldPos);

    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const toShark = sharkWorldPos.clone().sub(this.camera.position);
    const forwardDot = lookDir.dot(toShark.clone().normalize());

    // Generous reach so players can effectively jab Bruce from the raft or while swimming
    if (distToShark < 6.5 && (forwardDot > 0.3 || distToShark < 3.5) && this.shark.state !== 'FLEEING') {
      const damage = 25; // 4 hits = 100 damage (or 3-4 hits)
      this.shark.health = Math.max(0, this.shark.health - damage);
      soundManager.playSharkHit();
      this.flashSharkDamage();

      if (this.shark.health <= 0) {
        this.shark.state = 'FLEEING';
        this.shark.fleeTimer = 60; // Flees for 60 seconds
        this.callbacks.onSharkAlert(false);

        // Spawn floating Prime Shark Meat in the ocean!
        this.spawnSharkMeat(this.shark.pos.x, this.shark.pos.z);
        this.spawnSharkMeat(this.shark.pos.x + (Math.random() - 0.5) * 3, this.shark.pos.z + (Math.random() - 0.5) * 3);

        if (!this.sharkDefeatedOnce) {
          this.sharkDefeatedOnce = true;
          applySharkSkin(this.sharkMesh, true);
          this.saveWorld(false);
          this.callbacks.onToast('🩸 BRUCE DEFEATED! Prime Shark Meat dropped into the sea! Transforms into the BLOOD SHARK!', '#ef4444');
          soundManager.playAchievementUnlocked();
        } else {
          this.callbacks.onToast('🥩 Bruce defeated! Slabs of Prime Shark Meat floated to the surface!', '#22c55e');
        }
      } else {
        // Interrupt shark attack on raft or player!
        if (this.shark.state === 'ATTACKING_RAFT') {
          this.shark.state = 'CIRCLING';
          this.callbacks.onSharkAlert(false);
        }
        const hitsNeeded = Math.ceil(this.shark.health / damage);
        this.callbacks.onToast(`🦈 Pierced Bruce! (${Math.round(this.shark.health)}/100 HP - ${hitsNeeded} more hit${hitsNeeded > 1 ? 's' : ''} to flee)`, '#ef4444');
      }
      this.callbacks.onSharkDataChange?.({ ...this.shark });
    }
  }

  private flashSharkDamage() {
    this.sharkMesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.name !== 'sharkHealthFill' && child.name !== 'sharkHealthBar') {
        const mat = child.material;
        if (mat && (mat as any).color) {
          const original = (mat as any).color.getHex();
          (mat as any).color.setHex(0xff0000);
          setTimeout(() => {
            if (mat && (mat as any).color) (mat as any).color.setHex(original);
          }, 180);
        }
      }
    });
  }

  spawnSharkMeat(x: number, z: number) {
    const mesh = createSharkMeatMesh();
    mesh.position.set(x, 0.05, z);
    this.scene.add(mesh);
    this.floatingMeatList.push({
      id: this.nextMeatId++,
      mesh,
      pos: new THREE.Vector3(x, 0.05, z),
      caught: false,
      bobPhase: Math.random() * Math.PI * 2,
    });
    soundManager.playWaterSplash(0.7);
  }

  updateMeat(dt: number, elapsed: number, effectiveDrift: number) {
    for (let i = this.floatingMeatList.length - 1; i >= 0; i--) {
      const meat = this.floatingMeatList[i];
      if (meat.caught) continue;

      meat.pos.z += effectiveDrift * dt * 0.7;
      meat.pos.y = 0.08 + Math.sin(elapsed * 2.8 + meat.bobPhase) * 0.05;
      meat.mesh.position.copy(meat.pos);
      meat.mesh.rotation.y += 0.5 * dt;

      // Proximity pickup
      const dist = this.player.pos.distanceTo(meat.pos);
      if (dist < 2.5) {
        this.addItemToInventory('shark_meat', 1);
        this.callbacks.onToast('🥩 Collected Prime Shark Meat slab! (+1 Shark Meat)', '#22c55e');
        soundManager.playItemCollect();
        this.scene.remove(meat.mesh);
        this.floatingMeatList.splice(i, 1);
        continue;
      }

      // Hook snag
      if (
        (this.ctx.getHookState() === 'FLOATING' || this.ctx.getHookState() === 'RETRACTING' || this.ctx.getHookState() === 'THROWN') &&
        this.ctx.getHookPos().distanceTo(meat.pos) < 1.8
      ) {
        meat.caught = true;
        this.addItemToInventory('shark_meat', 1);
        this.callbacks.onToast('🥩 Hooked Prime Shark Meat slab from the deep!', '#22c55e');
        soundManager.playItemCollect();
        this.scene.remove(meat.mesh);
        this.floatingMeatList.splice(i, 1);
        continue;
      }

      if (meat.pos.z > 80) {
        this.scene.remove(meat.mesh);
        this.floatingMeatList.splice(i, 1);
      }
    }
  }
}

// ==================== Factory（依赖接线集中于此，GameWorld 一行调用） ====================

export function createSharkSystem(w: WorldView): SharkSystem {
  return new SharkSystem({
    scene: w.scene,
    camera: w.camera,
    player: w.player().player,
    structures: w.build().structures,
    raftGroup: w.build().raftGroup,
    callbacks: {
      onToast: w.toast,
      onSharkAlert: (alerting) => w.ui.onSharkAlert(alerting),
      onSharkDataChange: (shark) => w.ui.onSharkDataChange?.(shark),
      onStatsChange: (stats) => w.ui.onStatsChange(stats),
    },
    addItemToInventory: (itemId, count) => w.inventory().addItemToInventory(itemId, count),
    saveWorld: (notify) => w.saveWorld(notify),
    getHookState: () => w.hook().hookState,
    getHookPos: () => w.hook().hookPos,
  });
}
