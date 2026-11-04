/**
 * HookSystem —— 抓钩系统（拆分自 engine.ts，split step 5）。
 *
 * 职责：钩索状态机（蓄力/抛出/漂浮/回收）、世界投影钩网格与绳线、
 * 第一人称手持工具模型（挂载在相机上的 fpsToolContainer）、
 * 钩住漂浮物的碰撞与回收结算。
 *
 * 通信约定：战利品提示走事件总线 core/events.ts。
 */

import type { WorldView } from '../worldView';
import * as THREE from 'three';
import { ItemId, ResourceId, ToolActionKind } from '../../types/game';
import { DebrisObject } from '../entities/debris';
import { ITEM_DEFINITIONS } from '../../data/items';
import { soundManager } from '../../audio/soundManager';
import { createGrapplingHookMesh, createFPSTool } from '../visuals/tools';
import { events } from '../../core/events';
import { Tickable } from '../lifecycle';

export type HookState = 'IDLE' | 'CHARGING' | 'THROWN' | 'FLOATING' | 'RETRACTING';

export interface HookSystemContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 世界相对木筏流速（FLOATING 态随水漂流，与 debris/shark 同源 WindSystem） */
  getFlow: () => { x: number; z: number };
  /** 本地玩家位置（脱钩判定/收线目标） */
  getPlayerPos: () => THREE.Vector3;
  /** 当前手持物品的主动作（throw_hook 时显示蓄力/待机动画，物品映射在 data 层） */
  getActiveToolAction: () => ToolActionKind | null;
  /** 当前手持物品 id（船桨划水动画用） */
  getActiveItemId: () => ItemId | null;
  /** 是否正在划桨（WindSystem 判定：手持船桨按住左键） */
  isPaddling: () => boolean;
  /** 漂浮物活数组（钩取时原地标记 caught 并移除） */
  getDebrisList: () => DebrisObject[];
  /** 海面波形采样（钩子落水/漂浮高度与渲染同一公式） */
  getWaveHeight: (x: number, z: number) => number;
  addItemToInventory: (id: ResourceId, count: number) => void;
}

export class HookSystem implements Tickable {
  public hookState: HookState = 'IDLE';
  public hookPos = new THREE.Vector3();
  public hookVel = new THREE.Vector3();
  public hookPower = 0;
  public hookCaught: DebrisObject[] = [];
  public hookMesh: THREE.Group;
  public ropeLine: THREE.Line;
  public fpsToolContainer: THREE.Group = new THREE.Group();
  private currentToolModel: THREE.Group | null = null;

  private ctx: HookSystemContext;

  constructor(ctx: HookSystemContext) {
    this.ctx = ctx;

    // FPS Camera Tool Container (attached to the camera)
    this.ctx.camera.add(this.fpsToolContainer);
    this.ctx.scene.add(this.ctx.camera);

    // Hook Mesh & Rope (World Thrown Projectile)
    this.hookMesh = createGrapplingHookMesh(false);
    this.hookMesh.visible = false;
    this.ctx.scene.add(this.hookMesh);

    const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const ropeMat = new THREE.LineBasicMaterial({ color: 0xfef08a, linewidth: 2 });
    this.ropeLine = new THREE.Line(ropeGeo, ropeMat);
    this.ropeLine.visible = false;
    this.ctx.scene.add(this.ropeLine);
  }

  // ==================== Tool Model ====================

  /** 当前手持工具模型（shark 系统的矛刺动画需要挂载点） */
  public get toolModel(): THREE.Group | null {
    return this.currentToolModel;
  }

  /** 手持工具模型切换（快捷栏变化时调用） */
  public updateEquippedTool(itemId: ItemId | null) {
    if (this.currentToolModel) {
      this.fpsToolContainer.remove(this.currentToolModel);
      this.currentToolModel = null;
    }

    if (!itemId) return;

    this.currentToolModel = createFPSTool(itemId);
    this.fpsToolContainer.add(this.currentToolModel);
  }

  // ==================== State Machine Inputs ====================

  /** 左键按下且手持钩索：开始蓄力（或回收中的再次点击视为收回） */
  public chargeStart() {
    if (this.hookState === 'IDLE') {
      this.hookState = 'CHARGING';
      this.hookPower = 0;
    }
  }

  /** 左键按下且钩索已在空中/漂浮：收线 */
  public reelClick() {
    if (this.hookState === 'THROWN' || this.hookState === 'FLOATING') {
      this.hookState = 'RETRACTING';
      soundManager.playReelClick();
    }
  }

  /** 左键抬起：蓄力完成，按视角方向抛出 */
  public releaseThrow() {
    if (this.hookState === 'CHARGING') {
      this.hookState = 'THROWN';
      soundManager.playHookThrow();

      const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ctx.camera.quaternion).normalize();
      const speed = 15 + this.hookPower * 24;

      const startPos = new THREE.Vector3(0.35, -0.2, -0.7).applyMatrix4(this.ctx.camera.matrixWorld);
      this.hookPos.copy(startPos);
      this.hookVel.copy(lookDir).multiplyScalar(speed);
      this.hookVel.y += 3.8; // Upward arc
    }
  }

  // ==================== Per-frame Update ====================

  public update(dt: number, elapsed: number) {
    const playerPos = this.ctx.getPlayerPos();
    const activeToolAction = this.ctx.getActiveToolAction();
    const activeItemId = this.ctx.getActiveItemId();
    const debrisList = this.ctx.getDebrisList();

    if (this.hookState === 'CHARGING') {
      this.hookPower = Math.min(1.0, this.hookPower + dt * 1.25);
    }

    const rodTip = new THREE.Vector3(0.35, -0.22, -0.75).applyMatrix4(this.ctx.camera.matrixWorld);

    // Held FPS Tool dynamics: Hook charging windup, Idle breathing, or throw hide
    if (activeToolAction === 'throw_hook' && this.currentToolModel) {
      if (this.hookState === 'CHARGING') {
        // Wind-up: pull back and elevate with tension
        this.currentToolModel.position.set(
          0.32,
          -0.24 + this.hookPower * 0.08,
          -0.52 - this.hookPower * 0.16
        );
        this.currentToolModel.rotation.set(
          0.25 + this.hookPower * 0.35,
          -0.18 + this.hookPower * 0.12,
          0.08
        );
        this.currentToolModel.visible = true;
      } else if (this.hookState === 'IDLE') {
        this.currentToolModel.position.set(0.32, -0.24 + Math.sin(elapsed * 2) * 0.004, -0.52);
        this.currentToolModel.rotation.set(0.25, -0.18, 0.08);
        this.currentToolModel.visible = true;
      } else {
        // While hook projectile is out in the ocean, hide held hook so it doesn't double-render
        this.currentToolModel.visible = false;
      }
    } else if (activeItemId === 'paddle' && this.currentToolModel) {
      // 划水动画：与 WindSystem 推力脉冲同频（elapsed * 3.4），前倾入水/回桨
      if (this.ctx.isPaddling()) {
        const s = Math.sin(elapsed * 3.4);
        this.currentToolModel.position.set(0.3, -0.3 + s * 0.05, -0.42 - s * 0.06);
        this.currentToolModel.rotation.set(0.42 + s * 0.3, -0.3 + s * 0.1, 0.14);
      } else {
        this.currentToolModel.position.set(0.33, -0.3 + Math.sin(elapsed * 2) * 0.004, -0.42);
        this.currentToolModel.rotation.set(0.42, -0.3, 0.14);
      }
      this.currentToolModel.visible = true;
    } else if (this.currentToolModel) {
      this.currentToolModel.visible = true;
    }

    // World projectile hook visibility (ONLY visible in the world scene when actively thrown/floating/retracting)
    if (this.hookState === 'IDLE' || this.hookState === 'CHARGING') {
      this.hookMesh.visible = false;
      this.ropeLine.visible = false;
    } else {
      this.hookMesh.visible = true;
      this.ropeLine.visible = true;

      if (this.hookState === 'THROWN') {
        this.hookVel.y -= 14.5 * dt;
        this.hookPos.addScaledVector(this.hookVel, dt);
        this.hookMesh.lookAt(this.hookPos.clone().add(this.hookVel));

        const waterY = this.ctx.getWaveHeight(this.hookPos.x, this.hookPos.z) + 0.05;
        if (this.hookPos.y <= waterY) {
          this.hookPos.y = waterY;
          this.hookState = 'FLOATING';
          soundManager.playWaterSplash(0.8);
        }
        if (this.hookPos.distanceTo(playerPos) > 52) {
          this.hookState = 'RETRACTING';
        }
      } else if (this.hookState === 'FLOATING') {
        const flow = this.ctx.getFlow();
        this.hookPos.x += flow.x * dt;
        this.hookPos.z += flow.z * dt;
        this.hookPos.y = this.ctx.getWaveHeight(this.hookPos.x, this.hookPos.z) + 0.05;
        if (this.hookPos.distanceTo(playerPos) > 56) {
          this.hookState = 'RETRACTING';
        }
      } else if (this.hookState === 'RETRACTING') {
        const pullTarget = new THREE.Vector3(playerPos.x, playerPos.y - 0.35, playerPos.z);
        const toPlayer = pullTarget.clone().sub(this.hookPos);
        const dist = toPlayer.length();

        if (dist < 1.4) {
          // Snagged loot collected!
          if (this.hookCaught.length > 0) {
            this.hookCaught.forEach((item) => {
              Object.entries(item.yields).forEach(([res, count]) => {
                this.ctx.addItemToInventory(res as ResourceId, count || 1);
                const def = ITEM_DEFINITIONS[res as ResourceId];
                events.emit('toast', { text: `+${count} ${def?.name || res}`, color: def?.color || '#38bdf8' });
              });
              this.ctx.scene.remove(item.mesh);
              const idx = debrisList.indexOf(item);
              if (idx !== -1) debrisList.splice(idx, 1);
            });
            soundManager.playItemCollect();
            this.hookCaught = [];
          }
          this.hookState = 'IDLE';
          if (activeToolAction === 'throw_hook' && this.currentToolModel) {
            this.currentToolModel.visible = true;
          }
        } else {
          toPlayer.normalize();
          this.hookPos.addScaledVector(toPlayer, 22.0 * dt);
          if (dist > 3.0) {
            this.hookPos.y = THREE.MathUtils.lerp(this.hookPos.y, 0.15, dt * 8);
          }
          this.hookMesh.lookAt(pullTarget);
        }
      }

      // Check collision with floating debris
      if ((this.hookState === 'FLOATING' || this.hookState === 'RETRACTING' || this.hookState === 'THROWN') && this.hookCaught.length < 3) {
        for (let d of debrisList) {
          if (!d.caught && d.mesh.position.distanceTo(this.hookPos) < 1.4) {
            d.caught = true;
            this.hookCaught.push(d);
            soundManager.playWaterSplash(0.5);
            if (this.hookState === 'FLOATING') {
              this.hookState = 'RETRACTING';
            }
          }
        }
      }

      this.hookMesh.position.copy(this.hookPos);
      this.hookCaught.forEach((d, idx) => {
        d.mesh.position.copy(this.hookPos);
        d.mesh.position.y -= 0.12 * idx;
      });

      // Update rope line
      const ropePos = this.ropeLine.geometry.attributes.position.array as Float32Array;
      ropePos[0] = rodTip.x;
      ropePos[1] = rodTip.y;
      ropePos[2] = rodTip.z;
      ropePos[3] = this.hookPos.x;
      ropePos[4] = this.hookPos.y;
      ropePos[5] = this.hookPos.z;
      this.ropeLine.geometry.attributes.position.needsUpdate = true;
    }
  }
}

// ==================== Factory（由 Raft 组合根统一接线） ====================

export function createHookSystem(w: WorldView): HookSystem {
  return new HookSystem({
    scene: w.scene,
    camera: w.camera,
    getFlow: () => w.wind().getWorldFlow(),
    getPlayerPos: () => w.player().localPlayer.pos,
    getActiveToolAction: () => {
      const inv = w.inventory();
      const id = inv.hotbar[inv.activeHotbarIdx]?.itemId;
      return id ? (ITEM_DEFINITIONS[id]?.primaryAction ?? null) : null;
    },
    getActiveItemId: () => {
      const inv = w.inventory();
      return inv.hotbar[inv.activeHotbarIdx]?.itemId ?? null;
    },
    isPaddling: () => w.wind().isPaddling(),
    getDebrisList: () => w.debris().items,
    getWaveHeight: (x, z) => w.ocean().getWaveHeightAt(x, z),
    addItemToInventory: (id, count) => w.inventory().addItemToInventory(id, count),
  });
}
