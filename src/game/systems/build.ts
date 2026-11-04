/**
 * BuildSystem —— 木筏建造系统（拆分自 engine.ts，见 commit "split step 3"）。
 *
 * 职责：结构唯一所有权（structures Map + raftGroup）、放置/拆除、建造模式
 * 状态与幽灵网格、结构支撑/碰撞/脚下高度查询、结构序列化。
 *
 * 通信约定：对外提示一律 events.emit('toast')；建造面板选中广播
 * buildingSelected 事件（core/events.ts），不持有任何 UI 回调。
 */

import type { WorldView } from '../worldView';
import * as THREE from 'three';
import {
  BuildingType,
  PlacedStructure,
  ResourceId,
  SerializedStructure,
} from '../../types/game';
import { BUILDING_DEFINITIONS } from '../../data/buildings';
import { soundManager } from '../../audio/soundManager';
import { BLOCK_SIZE, BLOCK_HEIGHT, WALL_HEIGHT } from '../visuals/shared';
import {
  createFoundationMesh,
  createCollectionNetMesh,
  createTriFoundationMesh,
  createPillarMesh,
  createFloorMesh,
  createStairsMesh,
  createWallMesh,
  createFenceMesh,
  createPurifierMesh,
  createGrillMesh,
  createCropPlotMesh,
  createChestMesh,
  createSailMesh,
  createBedMesh,
} from '../visuals/buildings';
import { events } from '../../core/events';
import { InventorySystem } from './inventory';

export interface GhostSnapCoord {
  gx: number;
  gy: number;
  gz: number;
  posX?: number;
  posY?: number;
  posZ?: number;
  rot?: number;
  valid?: boolean;
  error?: string;
}

export interface BuildSystemContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 只读使用：幽灵网格落位意图判定需要玩家位置/视线高度 */
  player: () => { pos: THREE.Vector3 };
  inventory: InventorySystem;
  /** 放置/拆除成功后触发自动存档（engine.saveWorld(false)） */
  onSave: () => void;
}

import { Tickable } from '../lifecycle';

export class BuildSystem implements Tickable {
  // Structure Ownership
  public structures: Map<string, PlacedStructure> = new Map();
  public raftGroup: THREE.Group = new THREE.Group();

  // Build Mode State
  public isBuildMode = false;
  public isDemolishMode = false;
  public selectedBuildingType: BuildingType = 'foundation';
  public buildRotation = 0; // 0, 1, 2, 3
  public ghostMesh: THREE.Group | null = null;
  public ghostSnapCoord: GhostSnapCoord | null = null;

  /** 帆数量带来的漂流速度加成（engine 每帧读取） */
  public driftSpeedMultiplier = 1.0;

  private ctx: BuildSystemContext;
  private raycaster = new THREE.Raycaster();

  public readonly BUILDING_TYPES: BuildingType[] = [
    'foundation',
    'tri_foundation',
    'collection_net',
    'pillar',
    'floor',
    'stairs',
    'wall',
    'window_wall',
    'fence',
    'purifier',
    'grill',
    'crop_plot',
    'chest',
    'sail',
    'bed',
  ];

  constructor(ctx: BuildSystemContext) {
    this.ctx = ctx;
    ctx.scene.add(this.raftGroup);
  }

  // ==================== Initial Raft ====================

  public createInitialRaft() {
    // 2x2 wooden foundation core
    const coords = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    coords.forEach(([gx, gz]) => {
      this.placeStructure('foundation', gx, 0, gz, 0, false);
    });
  }

  // ==================== Structure Queries ====================

  public getFoundationAt(gx: number, gz: number): PlacedStructure | undefined {
    return Array.from(this.structures.values()).find(
      (s) =>
        (s.type === 'foundation' || s.type === 'tri_foundation' || s.type === 'collection_net') &&
        s.gx === gx &&
        s.gz === gz
    );
  }

  public hasFoundationAt(gx: number, gz: number): boolean {
    return !!this.getFoundationAt(gx, gz);
  }

  public hasFloorAt(gx: number, gz: number): boolean {
    return Array.from(this.structures.values()).some((s) => s.type === 'floor' && s.gx === gx && s.gz === gz);
  }

  public hasPillarAt(gx: number, gz: number): boolean {
    return Array.from(this.structures.values()).some((s) => s.type === 'pillar' && s.gx === gx && s.gz === gz);
  }

  /**
   * Support rule for Upper Deck Floor Planks:
   * Supported if within 2 planks radius of a Support Pillar (Beam), Wooden Wall, Window Wall,
   * or connected adjacent Upper Deck Floor!
   */
  public isSupportedForUpperDeck(gx: number, gz: number, radius: number = 2): boolean {
    for (const s of this.structures.values()) {
      if (s.type === 'pillar') {
        const dx = Math.abs(gx - s.gx);
        const dz = Math.abs(gz - s.gz);
        if (dx <= radius && dz <= radius) return true;
      } else if (s.type === 'wall' || s.type === 'window_wall') {
        // Walls and Window Walls are the same height as beams and support planks on top!
        const wx = Math.round(s.mesh.position.x / BLOCK_SIZE);
        const wz = Math.round(s.mesh.position.z / BLOCK_SIZE);
        const dx = Math.abs(gx - wx);
        const dz = Math.abs(gz - wz);
        if (dx <= radius && dz <= radius) return true;
      } else if (s.type === 'floor') {
        // Connected upper deck floor within 1 tile
        const dx = Math.abs(gx - s.gx);
        const dz = Math.abs(gz - s.gz);
        if (dx <= 1 && dz <= 1 && (dx + dz <= 1)) return true;
      }
    }
    return false;
  }

  public isSupportedByPillar(gx: number, gz: number, radius: number = 2): boolean {
    return this.isSupportedForUpperDeck(gx, gz, radius);
  }

  public getStructureAt(type: BuildingType, gx: number, gz: number): PlacedStructure | undefined {
    return Array.from(this.structures.values()).find((s) => s.type === type && s.gx === gx && s.gz === gz);
  }

  public getStructuresAtCoord(gx: number, gz: number): PlacedStructure[] {
    return Array.from(this.structures.values()).filter((s) => s.gx === gx && s.gz === gz);
  }

  // ==================== Place / Demolish ====================

  public placeStructure(
    type: BuildingType,
    gx: number,
    gy: number,
    gz: number,
    rot: number = 0,
    checkCost: boolean = true,
    customPos?: { x: number; y: number; z: number },
    customId?: string
  ): boolean {
    const isFoundationType =
      type === 'foundation' ||
      type === 'tri_foundation' ||
      type === 'collection_net';

    let posX = gx * BLOCK_SIZE;
    let posY = BLOCK_HEIGHT / 2;
    let posZ = gz * BLOCK_SIZE;

    if (isFoundationType) {
      posY = 0;
    } else if (type === 'floor') {
      // Sits directly on top of the support beam, wall, or window wall!
      posY = BLOCK_HEIGHT / 2 + WALL_HEIGHT;
      if (checkCost && !this.isSupportedForUpperDeck(gx, gz, 2)) {
        events.emit('toast', { text: 'Requires a Support Beam, Wall, or Window Wall within 2 planks radius!', color: '#ef4444' });
        return false;
      }
    } else if (customPos) {
      posX = customPos.x;
      posY = customPos.y;
      posZ = customPos.z;
    }

    const key =
      customId ||
      (isFoundationType
        ? `${type}_${gx}_${gz}`
        : type === 'wall' || type === 'window_wall' || type === 'fence'
          ? `${type}_${posX.toFixed(1)}_${posY.toFixed(1)}_${posZ.toFixed(1)}`
          : `${type}_${gx}_${gy}_${gz}`);

    if (this.structures.has(key)) {
      if (checkCost) {
        events.emit('toast', { text: 'A structure of this type already exists here!', color: '#f59e0b' });
      }
      return false;
    }

    const def = BUILDING_DEFINITIONS[type];
    if (checkCost && def) {
      if (!this.ctx.inventory.canAfford(def.cost)) {
        events.emit('toast', { text: 'Not enough resources to build!', color: '#ef4444' });
        return false;
      }
      this.ctx.inventory.deductCost(def.cost);
    }

    const mesh = this.createMeshFor(type);

    mesh.position.set(posX, posY, posZ);
    mesh.rotation.y = (rot * Math.PI) / 2;

    this.raftGroup.add(mesh);

    const placed: PlacedStructure = {
      id: key,
      type,
      gx,
      gy,
      gz,
      rotation: rot,
      health: 100,
      maxHealth: 100,
      mesh,
      data: {
        purifierSaltWater: false,
        purifierFreshWater: false,
        purifierBoilProgress: 0,
        grillItem: null,
        grillProgress: 0,
        grillDone: false,
        cropPlanted: false,
        cropGrowProgress: 0,
        trappedItems: [],
        chestItems: Array.from({ length: 12 }, () => ({ itemId: null, count: 0 })),
      },
    };

    this.structures.set(key, placed);

    if (checkCost) {
      soundManager.playHammerBuild();
      events.emit('toast', { text: `Built ${def.name}!`, color: '#22c55e' });
      this.ctx.onSave();
    }

    // Update sail bonus
    this.updateSailSpeed();
    return true;
  }

  public demolishAt(gx: number, gz: number) {
    const items = this.getStructuresAtCoord(gx, gz);
    if (items.length === 0) return;

    // Prioritize non-foundation item on top (e.g. purifier, pillar, wall, etc.)
    let target = items.find(
      (s) => s.type !== 'foundation' && s.type !== 'tri_foundation' && s.type !== 'collection_net'
    );
    if (!target) target = items[0];

    if (
      (target.type === 'foundation' || target.type === 'tri_foundation' || target.type === 'collection_net') &&
      this.countFoundations() <= 1
    ) {
      events.emit('toast', { text: 'Cannot demolish your last foundation plank!', color: '#ef4444' });
      return;
    }

    // Refund 50%
    const def = BUILDING_DEFINITIONS[target.type];
    if (def) {
      Object.entries(def.cost).forEach(([res, count]) => {
        const refundCount = Math.max(1, Math.floor((count || 1) / 2));
        this.ctx.inventory.addItemToInventory(res as ResourceId, refundCount);
      });
    }

    this.raftGroup.remove(target.mesh);
    this.structures.delete(target.id);
    soundManager.playHammerBuild();
    events.emit('toast', { text: `Demolished ${def?.name || 'Structure'} (+Refund)`, color: '#f59e0b' });

    this.ctx.onSave();

    this.updateSailSpeed();
  }

  /**
   * 直接移除一个结构（多人同步拆除、鲨鱼咬板等不走正常拆除流程的场景）。
   * 与原 engine 的远端拆除处理一致：不退款、不触发存档与帆速度重算。
   */
  public removeStructure(id: string) {
    const s = this.structures.get(id);
    if (s) {
      this.raftGroup.remove(s.mesh);
      this.structures.delete(id);
    }
  }

  private countFoundations(): number {
    let count = 0;
    this.structures.forEach((s) => {
      if (s.type === 'foundation' || s.type === 'collection_net' || s.type === 'tri_foundation') {
        count++;
      }
    });
    return count;
  }

  private updateSailSpeed() {
    let sailCount = 0;
    this.structures.forEach((s) => {
      if (s.type === 'sail') sailCount++;
    });
    this.driftSpeedMultiplier = 1.0 + Math.min(2.5, sailCount * 0.5);
  }

  private createMeshFor(type: BuildingType): THREE.Group {
    switch (type) {
      case 'foundation':
        return createFoundationMesh();
      case 'collection_net':
        return createCollectionNetMesh();
      case 'tri_foundation':
        return createTriFoundationMesh();
      case 'pillar':
        return createPillarMesh();
      case 'floor':
        return createFloorMesh();
      case 'stairs':
        return createStairsMesh();
      case 'wall':
        return createWallMesh(false);
      case 'window_wall':
        return createWallMesh(true);
      case 'fence':
        return createFenceMesh();
      case 'purifier':
        return createPurifierMesh();
      case 'grill':
        return createGrillMesh();
      case 'crop_plot':
        return createCropPlotMesh();
      case 'chest':
        return createChestMesh();
      case 'sail':
        return createSailMesh();
      case 'bed':
        return createBedMesh();
      default:
        return createFoundationMesh();
    }
  }

  // ==================== Build Mode ====================

  /** 进入建造模式（ Hammer 选中 / 合成解锁 / App 面板选择） */
  public enterBuildMode(type?: BuildingType) {
    if (type) this.selectedBuildingType = type;
    this.isBuildMode = true;
  }

  /** 退出建造模式（右键 / 切换工具） */
  public exitBuildMode() {
    this.isBuildMode = false;
    this.destroyGhostMesh();
  }

  /** 快捷键 B：切换建造模式 */
  public toggleBuildMode() {
    this.isBuildMode = !this.isBuildMode;
    if (!this.isBuildMode) this.destroyGhostMesh();
    else {
      this.destroyGhostMesh();
      this.createGhostMesh();
    }
    events.emit('toast', { text: this.isBuildMode ? 'Build Mode Enabled' : 'Build Mode Disabled', color: '#38bdf8' });
  }

  /** 快捷键 R：旋转建造件 */
  public rotatePiece() {
    this.buildRotation = (this.buildRotation + 1) % 4;
    if (this.ghostMesh) {
      this.ghostMesh.rotation.y = (this.buildRotation * Math.PI) / 2;
    }
  }

  /** 快捷键 X：切换拆除模式 */
  public toggleDemolishMode() {
    this.isDemolishMode = !this.isDemolishMode;
    events.emit('toast', { text: this.isDemolishMode ? 'Demolish Tool Active' : 'Build Tool Active', color: '#f59e0b' });
  }

  public cycleBuildingPiece(dir: number) {
    const idx = this.BUILDING_TYPES.indexOf(this.selectedBuildingType);
    let nextIdx = idx + dir;
    if (nextIdx < 0) nextIdx = this.BUILDING_TYPES.length - 1;
    if (nextIdx >= this.BUILDING_TYPES.length) nextIdx = 0;
    this.selectBuildingType(this.BUILDING_TYPES[nextIdx]);
  }

  public selectBuildingType(type: BuildingType) {
    this.selectedBuildingType = type;
    this.isBuildMode = true;
    this.isDemolishMode = false;
    this.destroyGhostMesh();
    this.createGhostMesh();
    soundManager.playReelClick();
    events.emit('buildingSelected', { type });
    const def = BUILDING_DEFINITIONS[type];
    if (def) {
      events.emit('toast', { text: `Selected: ${def.name}`, color: '#38bdf8' });
    }
  }

  /** 建造模式下的左键点击：拆除或按幽灵网格落位（原 engine.handleLeftClickDown 建造分支） */
  public tryPlace() {
    if (!this.isBuildMode) return;
    if (this.isDemolishMode && this.ghostSnapCoord) {
      this.demolishAt(this.ghostSnapCoord.gx, this.ghostSnapCoord.gz);
    } else if (this.ghostSnapCoord) {
      if (this.ghostSnapCoord.valid === false) {
        if (this.ghostSnapCoord.error) {
          events.emit('toast', { text: this.ghostSnapCoord.error, color: '#ef4444' });
        }
        return;
      }

      const rotToUse = this.ghostSnapCoord.rot !== undefined ? this.ghostSnapCoord.rot : this.buildRotation;
      const customPos =
        this.ghostSnapCoord.posX !== undefined && this.ghostSnapCoord.posZ !== undefined
          ? { x: this.ghostSnapCoord.posX, y: this.ghostSnapCoord.posY || 0, z: this.ghostSnapCoord.posZ }
          : undefined;

      let typeToPlace = this.selectedBuildingType;
      if (this.selectedBuildingType === 'foundation' || this.selectedBuildingType === 'floor') {
        typeToPlace = this.ghostSnapCoord.gy === 1 ? 'floor' : 'foundation';
      }

      this.placeStructure(
        typeToPlace,
        this.ghostSnapCoord.gx,
        this.ghostSnapCoord.gy,
        this.ghostSnapCoord.gz,
        rotToUse,
        true,
        customPos
      );
    }
  }

  // Raycast helper to find structure directly aimed at under crosshair
  public getStructureUnderCrosshair(): PlacedStructure | null {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.ctx.camera);
    const hits = this.raycaster.intersectObjects(this.raftGroup.children, true);
    for (const hit of hits) {
      if (hit.distance > 3.6) continue;
      let curr: THREE.Object3D | null = hit.object;
      while (curr && curr !== this.raftGroup) {
        for (const [_, s] of this.structures) {
          if (s.mesh === curr) {
            return s;
          }
        }
        curr = curr.parent;
      }
    }
    return null;
  }

  // ==================== Build Mode Hologram Preview ====================

  /** 每帧：建造全息预览（Tickable 统一入口） */
  public update(_dt: number, _elapsed: number) {
    if (!this.isBuildMode) {
      this.destroyGhostMesh();
      this.ghostSnapCoord = null;
      return;
    }

    if (!this.ghostMesh) {
      this.createGhostMesh();
    }

    // Raycast forward from camera
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.ctx.camera);
    const buildPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPt = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(buildPlane, hitPt);

    if (hit && hitPt.distanceTo(this.ctx.player().pos) < 14) {
      const gx = Math.round(hitPt.x / BLOCK_SIZE);
      const gz = Math.round(hitPt.z / BLOCK_SIZE);
      const def = BUILDING_DEFINITIONS[this.selectedBuildingType];
      const canAfford = this.ctx.inventory.canAfford(def.cost);

      const isPlankType = this.selectedBuildingType === 'foundation' || this.selectedBuildingType === 'floor';
      const isTriOrNet = this.selectedBuildingType === 'tri_foundation' || this.selectedBuildingType === 'collection_net';

      const hasFoundationHere = this.hasFoundationAt(gx, gz);
      const hasFloorHere = this.hasFloorAt(gx, gz);

      if (this.isDemolishMode) {
        const items = this.getStructuresAtCoord(gx, gz);
        if (items.length > 0) {
          this.ghostSnapCoord = { gx, gy: 0, gz, valid: true };
          this.ghostMesh!.position.set(gx * BLOCK_SIZE, 0, gz * BLOCK_SIZE);
          this.ghostMesh!.visible = true;
          this.setGhostColor(0xef4444); // Red for demolish
          return;
        }
      } else if (isPlankType) {
        // Wooden Planks: acts as BOTH Upper Deck and Lower Deck!
        // If player is on upper deck or aiming upward / on top of beams/walls:
        const isUpperDeckIntent =
          this.ctx.player().pos.y > 2.0 ||
          (hasFoundationHere && !hasFloorHere && (this.ctx.camera.rotation.x > -0.25 || this.isSupportedForUpperDeck(gx, gz, 2)));

        if (isUpperDeckIntent) {
          // Upper Deck Floor placement atop Beams, Walls, or Window Walls
          const targetY = BLOCK_HEIGHT / 2 + WALL_HEIGHT;
          const isSupported = this.isSupportedForUpperDeck(gx, gz, 2);
          const alreadyFloor = hasFloorHere;

          if (!alreadyFloor) {
            this.ghostMesh!.position.set(gx * BLOCK_SIZE, targetY, gz * BLOCK_SIZE);
            this.ghostMesh!.rotation.y = (this.buildRotation * Math.PI) / 2;
            this.ghostMesh!.visible = true;

            if (!isSupported) {
              this.setGhostColor(0xef4444);
              this.ghostSnapCoord = {
                gx,
                gy: 1,
                gz,
                posX: gx * BLOCK_SIZE,
                posY: targetY,
                posZ: gz * BLOCK_SIZE,
                rot: this.buildRotation,
                valid: false,
                error: 'Requires a Beam, Wall, or Window Wall support within 2 planks radius!',
              };
            } else {
              this.setGhostColor(canAfford ? 0x22c55e : 0xf87171);
              this.ghostSnapCoord = {
                gx,
                gy: 1,
                gz,
                posX: gx * BLOCK_SIZE,
                posY: targetY,
                posZ: gz * BLOCK_SIZE,
                rot: this.buildRotation,
                valid: canAfford,
              };
            }
            return;
          }
        }

        // Lower Deck Foundation placement on water plane
        if (!hasFoundationHere && this.isAdjacentToRaft(gx, gz)) {
          this.ghostSnapCoord = {
            gx,
            gy: 0,
            gz,
            posX: gx * BLOCK_SIZE,
            posY: 0,
            posZ: gz * BLOCK_SIZE,
            rot: this.buildRotation,
            valid: canAfford,
          };
          this.ghostMesh!.position.set(gx * BLOCK_SIZE, 0, gz * BLOCK_SIZE);
          this.ghostMesh!.rotation.y = (this.buildRotation * Math.PI) / 2;
          this.ghostMesh!.visible = true;
          this.setGhostColor(canAfford ? 0x22c55e : 0xf87171);
          return;
        }
      } else if (isTriOrNet) {
        // Corner triangle and collection nets on water
        if (!hasFoundationHere && this.isAdjacentToRaft(gx, gz)) {
          this.ghostSnapCoord = {
            gx,
            gy: 0,
            gz,
            posX: gx * BLOCK_SIZE,
            posY: 0,
            posZ: gz * BLOCK_SIZE,
            rot: this.buildRotation,
            valid: canAfford,
          };
          this.ghostMesh!.position.set(gx * BLOCK_SIZE, 0, gz * BLOCK_SIZE);
          this.ghostMesh!.rotation.y = (this.buildRotation * Math.PI) / 2;
          this.ghostMesh!.visible = true;
          this.setGhostColor(canAfford ? 0x22c55e : 0xf87171);
          return;
        }
      } else if (
        this.selectedBuildingType === 'wall' ||
        this.selectedBuildingType === 'window_wall' ||
        this.selectedBuildingType === 'fence'
      ) {
        // Edge placement on foundation or upper floor!
        if (hasFoundationHere || hasFloorHere) {
          const cellCenterX = gx * BLOCK_SIZE;
          const cellCenterZ = gz * BLOCK_SIZE;
          const lx = hitPt.x - cellCenterX;
          const lz = hitPt.z - cellCenterZ;

          let edgeX = cellCenterX;
          let edgeZ = cellCenterZ;
          let edgeRot = 0;

          if (Math.abs(lz) >= Math.abs(lx)) {
            if (lz < 0) {
              // North edge
              edgeZ = cellCenterZ - BLOCK_SIZE / 2;
              edgeRot = 0;
            } else {
              // South edge
              edgeZ = cellCenterZ + BLOCK_SIZE / 2;
              edgeRot = 2;
            }
          } else {
            if (lx >= 0) {
              // East edge
              edgeX = cellCenterX + BLOCK_SIZE / 2;
              edgeRot = 1;
            } else {
              // West edge
              edgeX = cellCenterX - BLOCK_SIZE / 2;
              edgeRot = 3;
            }
          }

          const targetY = hasFloorHere && this.ctx.player().pos.y > 2.0 ? BLOCK_HEIGHT / 2 + WALL_HEIGHT : BLOCK_HEIGHT / 2;
          const edgeKey = `${this.selectedBuildingType}_${edgeX.toFixed(1)}_${targetY.toFixed(1)}_${edgeZ.toFixed(1)}`;
          const alreadyPlaced = this.structures.has(edgeKey);

          this.ghostMesh!.position.set(edgeX, targetY, edgeZ);
          this.ghostMesh!.rotation.y = (edgeRot * Math.PI) / 2;
          this.ghostMesh!.visible = true;

          if (alreadyPlaced) {
            this.setGhostColor(0xef4444);
            this.ghostSnapCoord = {
              gx,
              gy: targetY > 1 ? 1 : 0,
              gz,
              posX: edgeX,
              posY: targetY,
              posZ: edgeZ,
              rot: edgeRot,
              valid: false,
              error: 'A wall already exists on this edge!',
            };
          } else {
            this.setGhostColor(canAfford ? 0x22c55e : 0xf87171);
            this.ghostSnapCoord = {
              gx,
              gy: targetY > 1 ? 1 : 0,
              gz,
              posX: edgeX,
              posY: targetY,
              posZ: edgeZ,
              rot: edgeRot,
              valid: canAfford,
            };
          }
          return;
        }
      } else {
        // Deployables, pillars, stairs: snap to center of supported tile
        const canPlace = hasFoundationHere || (hasFloorHere && this.selectedBuildingType !== 'stairs');
        const alreadyHasThis = !!this.getStructureAt(this.selectedBuildingType, gx, gz);

        if (canPlace && !alreadyHasThis) {
          const targetY =
            hasFloorHere && this.ctx.player().pos.y > 2.0 && this.selectedBuildingType !== 'pillar'
              ? BLOCK_HEIGHT / 2 + WALL_HEIGHT
              : BLOCK_HEIGHT / 2;

          this.ghostMesh!.position.set(gx * BLOCK_SIZE, targetY, gz * BLOCK_SIZE);
          this.ghostMesh!.rotation.y = (this.buildRotation * Math.PI) / 2;
          this.ghostMesh!.visible = true;
          this.setGhostColor(canAfford ? 0x22c55e : 0xf87171);

          this.ghostSnapCoord = {
            gx,
            gy: targetY > 1 ? 1 : 0,
            gz,
            posX: gx * BLOCK_SIZE,
            posY: targetY,
            posZ: gz * BLOCK_SIZE,
            rot: this.buildRotation,
            valid: canAfford,
          };
          return;
        }
      }
    }

    if (this.ghostMesh) this.ghostMesh.visible = false;
    this.ghostSnapCoord = null;
  }

  private isAdjacentToRaft(gx: number, gz: number): boolean {
    const neighbors = [
      [gx + 1, gz],
      [gx - 1, gz],
      [gx, gz + 1],
      [gx, gz - 1],
    ];
    return neighbors.some(([nx, nz]) => this.hasFoundationAt(nx, nz));
  }

  private createGhostMesh() {
    const sourceMesh = this.createMeshFor(this.selectedBuildingType);

    this.ghostMesh = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.45,
    });

    sourceMesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const ghostPart = new THREE.Mesh(child.geometry, ghostMat.clone());
        ghostPart.position.copy(child.position);
        ghostPart.rotation.copy(child.rotation);
        ghostPart.scale.copy(child.scale);
        this.ghostMesh!.add(ghostPart);
      }
    });

    this.ghostMesh.rotation.y = (this.buildRotation * Math.PI) / 2;
    this.ctx.scene.add(this.ghostMesh);
  }

  private setGhostColor(hex: number) {
    if (!this.ghostMesh) return;
    this.ghostMesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        (child.material as THREE.MeshBasicMaterial).color.setHex(hex);
      }
    });
  }

  private destroyGhostMesh() {
    if (this.ghostMesh) {
      this.ctx.scene.remove(this.ghostMesh);
      this.ghostMesh = null;
    }
  }

  // ==================== Player Collision & Surface ====================

  // Raft Floor Collision Check
  public checkOnRaft(x: number, z: number): boolean {
    const gx = Math.round(x / BLOCK_SIZE);
    const gz = Math.round(z / BLOCK_SIZE);
    if (this.hasFoundationAt(gx, gz)) return true;

    // Buffer margin
    const m = 0.4;
    const checks = [
      [x + m, z],
      [x - m, z],
      [x, z + m],
      [x, z - m],
    ];
    return checks.some(([cx, cz]) => {
      const cgx = Math.round(cx / BLOCK_SIZE);
      const cgz = Math.round(cz / BLOCK_SIZE);
      return this.hasFoundationAt(cgx, cgz);
    });
  }

  /**
   * Horizontal obstacle collision detection (Walls, Window Walls, Fences, Pillars, Stairs underside).
   * Prevents walking through walls and solid architecture.
   */
  public checkHorizontalCollision(newX: number, newZ: number, playerY: number, radius = 0.28): boolean {
    const feetY = playerY - 1.7;
    const headY = playerY + 0.1;

    for (const s of this.structures.values()) {
      if (s.type === 'wall' || s.type === 'window_wall' || s.type === 'fence') {
        const obsH = s.type === 'fence' ? 0.95 : WALL_HEIGHT;
        const obsBottom = s.mesh.position.y;
        const obsTop = obsBottom + obsH;

        if (headY > obsBottom && feetY < obsTop) {
          const wx = s.mesh.position.x;
          const wz = s.mesh.position.z;
          const rot = s.rotation % 2; // 0 = horizontal (along X), 1 = vertical (along Z)

          if (rot === 0) {
            const halfW = BLOCK_SIZE / 2;
            const halfT = 0.16;
            if (
              newX >= wx - halfW - radius &&
              newX <= wx + halfW + radius &&
              newZ >= wz - halfT - radius &&
              newZ <= wz + halfT + radius
            ) {
              return true;
            }
          } else {
            const halfW = BLOCK_SIZE / 2;
            const halfT = 0.16;
            if (
              newX >= wx - halfT - radius &&
              newX <= wx + halfT + radius &&
              newZ >= wz - halfW - radius &&
              newZ <= wz + halfW + radius
            ) {
              return true;
            }
          }
        }
      } else if (s.type === 'pillar') {
        const obsBottom = s.mesh.position.y;
        const obsTop = obsBottom + WALL_HEIGHT;
        if (headY > obsBottom && feetY < obsTop) {
          const dx = Math.abs(newX - s.mesh.position.x);
          const dz = Math.abs(newZ - s.mesh.position.z);
          if (dx < 0.14 + radius && dz < 0.14 + radius) {
            return true;
          }
        }
      } else if (s.type === 'stairs') {
        const sx = s.gx * BLOCK_SIZE;
        const sz = s.gz * BLOCK_SIZE;
        const dx = newX - sx;
        const dz = newZ - sz;
        const rotAngle = (s.rotation % 4) * (Math.PI / 2);
        const lx = dx * Math.cos(rotAngle) - dz * Math.sin(rotAngle);
        const lz = dx * Math.sin(rotAngle) + dz * Math.cos(rotAngle);

        // Underside wall of high steps: cannot walk through back underside of stairs
        if (lz > 0.25 && lz <= BLOCK_SIZE * 0.52 && feetY < BLOCK_HEIGHT / 2 + 0.6) {
          if (Math.abs(lx) <= BLOCK_SIZE * 0.44 + radius) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Exact surface height calculator for Player feet.
   * Seamlessly calculates height across base raft foundations, stairs incline, and second-story upper deck floor.
   */
  public calculateSurfaceHeight(px: number, py: number, pz: number, elapsed: number): number {
    let supportY = -Infinity;
    const feetY = py - 1.7;

    // 1. Check Foundation / Base Raft
    if (this.checkOnRaft(px, pz)) {
      supportY = BLOCK_HEIGHT / 2;
    }

    // 2. Check Upper Deck Floor (floor)
    for (const s of this.structures.values()) {
      if (s.type === 'floor') {
        const fx = s.gx * BLOCK_SIZE;
        const fz = s.gz * BLOCK_SIZE;
        const halfSize = BLOCK_SIZE / 2;
        if (Math.abs(px - fx) <= halfSize + 0.15 && Math.abs(pz - fz) <= halfSize + 0.15) {
          const floorTop = BLOCK_HEIGHT / 2 + WALL_HEIGHT + 0.12;
          if (feetY >= floorTop - 0.75) {
            supportY = Math.max(supportY, floorTop);
          }
        }
      }
    }

    // 3. Check Stairs Incline
    for (const s of this.structures.values()) {
      if (s.type === 'stairs') {
        const sx = s.gx * BLOCK_SIZE;
        const sz = s.gz * BLOCK_SIZE;
        const dx = px - sx;
        const dz = pz - sz;
        const rotAngle = (s.rotation % 4) * (Math.PI / 2);
        const cosA = Math.cos(rotAngle);
        const sinA = Math.sin(rotAngle);

        const lx = dx * cosA - dz * sinA;
        const lz = dx * sinA + dz * cosA;

        if (Math.abs(lx) <= BLOCK_SIZE * 0.48 && Math.abs(lz) <= BLOCK_SIZE * 0.55) {
          const progress = (lz + BLOCK_SIZE / 2) / BLOCK_SIZE;
          const t = Math.max(0, Math.min(1, progress));
          const stairSurface = BLOCK_HEIGHT / 2 + t * WALL_HEIGHT;

          if (feetY >= stairSurface - 0.65) {
            supportY = Math.max(supportY, stairSurface);
          }
        }
      }
    }

    if (supportY !== -Infinity) {
      return supportY + 1.7;
    }

    // No solid surface in open ocean water - player sinks into water and swims!
    return -Infinity;
  }

  // ==================== Serialization ====================

  public serializeStructures(): SerializedStructure[] {
    return Array.from(this.structures.values()).map((s) => ({
      id: s.id,
      type: s.type,
      gx: s.gx,
      gy: s.gy,
      gz: s.gz,
      rotation: s.rotation,
      health: s.health,
      maxHealth: s.maxHealth,
      posX: s.mesh.position.x,
      posY: s.mesh.position.y,
      posZ: s.mesh.position.z,
      data: s.data,
    }));
  }

  /** 清空并按存档重建所有结构（保留原始 id 与 data） */
  public loadFrom(structures: SerializedStructure[]) {
    this.structures.forEach((s) => {
      this.raftGroup.remove(s.mesh);
    });
    this.structures.clear();

    structures.forEach((s) => {
      this.placeStructure(
        s.type,
        s.gx,
        s.gy,
        s.gz,
        s.rotation,
        false,
        s.posX !== undefined ? { x: s.posX, y: s.posY!, z: s.posZ! } : undefined,
        s.id
      );
      const placed = this.structures.get(s.id);
      if (placed && s.data) {
        placed.data = { ...placed.data, ...s.data };
      }
    });

    this.updateSailSpeed();
  }

  /** 清空所有结构（世界重置用；随后一般接 createInitialRaft） */
  public clearAll() {
    this.structures.forEach((s) => {
      this.raftGroup.remove(s.mesh);
    });
    this.structures.clear();
  }

  public dispose() {
    this.destroyGhostMesh();
  }
}

// ==================== Factory（由 Raft 组合根统一接线） ====================

export function createBuildSystem(w: WorldView): BuildSystem {
  return new BuildSystem({
    scene: w.scene,
    camera: w.camera,
    player: () => w.player().localPlayer,
    inventory: w.inventory(),
    onSave: () => w.saveWorld(),
  });
}
