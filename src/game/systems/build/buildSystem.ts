/**
 * BuildSystem —— 木筏建造系统（拆分自 build.ts，本文件是所有权宿主）。
 *
 * 职责：结构唯一所有权（structures Map + raftGroup）、放置/拆除、建造模式
 * 状态与结构序列化。三个子模块各司其职：
 *   - RaftBuoyancy（buoyancy.ts）：浮力与甲板平面高度
 *   - BuildGhostPreview（ghostPreview.ts）：幽灵网格与落位预览
 *   - playerSurface.ts：玩家支撑/碰撞纯查询
 *
 * 通信约定：对外提示一律 events.emit('toast')；建造面板选中广播
 * buildingSelected 事件（core/events.ts），不持有任何 UI 回调。
 */

import type { WorldView } from '../../worldView';
import * as THREE from 'three';
import {
  BuildingType,
  PlacedStructure,
  ResourceId,
  SerializedStructure,
} from '../../../types/game';
import { BUILDING_DEFINITIONS } from '../../../data/buildings';
import { soundManager } from '../../../audio/soundManager';
import { BLOCK_SIZE, BLOCK_HEIGHT, WALL_HEIGHT } from '../../visuals/shared';
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
  applySailOpenState,
  createBedMesh,
} from '../../visuals/buildings';
import { events } from '../../../core/events';
import { InventorySystem } from '../inventory';
import { Tickable } from '../../lifecycle';
import { RaftBuoyancy } from './buoyancy';
import { BuildGhostPreview, GhostSnapCoord } from './ghostPreview';
import { checkOnRaft, checkHorizontalCollision, calculateSurfaceHeight } from './playerSurface';

export type { GhostSnapCoord };

export interface BuildSystemContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 只读使用：幽灵网格落位意图判定需要玩家位置/视线高度 */
  player: () => { pos: THREE.Vector3 };
  inventory: InventorySystem;
  /** 放置/拆除成功后触发自动存档（engine.saveWorld(false)） */
  onSave: () => void;
  /** 海面波形采样（浮力与玩家支撑高度共用，与渲染 shader 同一公式） */
  getWaveHeight: (x: number, z: number) => number;
}

export class BuildSystem implements Tickable {
  // Structure Ownership
  public structures: Map<string, PlacedStructure> = new Map();
  public raftGroup: THREE.Group = new THREE.Group();

  // Build Mode State
  public isBuildMode = false;
  public isDemolishMode = false;
  public selectedBuildingType: BuildingType = 'foundation';
  public buildRotation = 0; // 0, 1, 2, 3

  private ctx: BuildSystemContext;
  private buoyancy: RaftBuoyancy;
  private preview: BuildGhostPreview;
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

    this.buoyancy = new RaftBuoyancy(this.raftGroup, ctx.getWaveHeight);
    this.preview = new BuildGhostPreview(
      this,
      {
        scene: ctx.scene,
        camera: ctx.camera,
        player: ctx.player,
        inventory: ctx.inventory,
      }
    );
  }

  // ==================== Ghost / Deck Proxies ====================

  /** 当前幽灵网格（预览模块所有；外部只读） */
  public get ghostMesh(): THREE.Group | null {
    return this.preview.ghostMesh;
  }

  /** 每帧幽灵预览输出：tryPlace 按此落位/拆除 */
  public get ghostSnapCoord(): GhostSnapCoord | null {
    return this.preview.ghostSnapCoord;
  }

  /**
   * 含倾斜的甲板平面高度（浮力子模块）。玩家支撑/碰撞/二层天花板
   * 都经此换算，与筏体实际渲染的倾斜面一致。
   */
  public deckYAt(px: number, pz: number): number {
    return this.buoyancy.deckYAt(px, pz);
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

    // 【临时测试】新档自带一张张开的风帆，方便验证帆推力与划桨微调；
    // 正式版移除（清单见 docs/FEATURES_OFF.md §8）。checkCost=false 不吃资源。
    if (this.placeStructure('sail', 0, 0, 0, 0, false)) {
      const sail = this.getStructureAt('sail', 0, 0);
      if (sail) {
        sail.data!.sailOpen = true;
        applySailOpenState(sail.mesh, true);
      }
    }
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
        sailOpen: false,
      },
    };

    this.structures.set(key, placed);
    if (type === 'sail') {
      applySailOpenState(mesh, false);
    }

    if (checkCost) {
      soundManager.playHammerBuild();
      events.emit('toast', { text: `Built ${def.name}!`, color: '#22c55e' });
      this.ctx.onSave();
    }

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

  /** 帆开/合（F 交互结算入口）：写结构 data、切视觉、随存档持久化 */
  public setSailOpen(structure: PlacedStructure, open: boolean) {
    if (!structure.data || structure.data.sailOpen === open) return;
    structure.data.sailOpen = open;
    applySailOpenState(structure.mesh as THREE.Group, open);
    soundManager.playReelClick();
    events.emit('toast', {
      text: open ? '⛵ Sail unfurled — riding the wind!' : '⛵ Sail furled.',
      color: '#38bdf8',
    });
    this.ctx.onSave();
  }

  /** 结构网格工厂（ghostPreview 也经 GhostPreviewHost 使用） */
  public createMeshFor(type: BuildingType): THREE.Group {
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
    this.preview.destroyGhostMesh();
  }

  /** 快捷键 B：切换建造模式 */
  public toggleBuildMode() {
    this.isBuildMode = !this.isBuildMode;
    this.preview.destroyGhostMesh();
    if (this.isBuildMode) this.preview.createGhostMesh();
    events.emit('toast', { text: this.isBuildMode ? 'Build Mode Enabled' : 'Build Mode Disabled', color: '#38bdf8' });
  }

  /** 快捷键 R：旋转建造件 */
  public rotatePiece() {
    this.buildRotation = (this.buildRotation + 1) % 4;
    if (this.preview.ghostMesh) {
      this.preview.ghostMesh.rotation.y = (this.buildRotation * Math.PI) / 2;
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
    this.preview.destroyGhostMesh();
    this.preview.createGhostMesh();
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
    const snap = this.preview.ghostSnapCoord;
    if (this.isDemolishMode && snap) {
      this.demolishAt(snap.gx, snap.gz);
    } else if (snap) {
      if (snap.valid === false) {
        if (snap.error) {
          events.emit('toast', { text: snap.error, color: '#ef4444' });
        }
        return;
      }

      const rotToUse = snap.rot !== undefined ? snap.rot : this.buildRotation;
      const customPos =
        snap.posX !== undefined && snap.posZ !== undefined
          ? { x: snap.posX, y: snap.posY || 0, z: snap.posZ }
          : undefined;

      let typeToPlace = this.selectedBuildingType;
      if (this.selectedBuildingType === 'foundation' || this.selectedBuildingType === 'floor') {
        typeToPlace = snap.gy === 1 ? 'floor' : 'foundation';
      }

      this.placeStructure(typeToPlace, snap.gx, snap.gy, snap.gz, rotToUse, true, customPos);
    }
  }

  // Raycast helper to find the structure actually aimed at within interaction reach.
  public getStructureUnderCrosshair(maxDistance = 2.4): PlacedStructure | null {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.ctx.camera);
    const hits = this.raycaster.intersectObjects(this.raftGroup.children, true);
    for (const hit of hits) {
      if (hit.distance > maxDistance) break;
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

  /** 每帧：木筏浮力 + 建造全息预览（Tickable 统一入口） */
  public update(dt: number, _elapsed: number) {
    this.buoyancy.update(dt);

    if (!this.isBuildMode) {
      this.preview.destroyGhostMesh();
      this.preview.ghostSnapCoord = null;
      return;
    }

    this.preview.update();
  }

  // ==================== Adjacency ====================

  /** 目标格是否与已有基础甲板相邻（扩建前置条件，幽灵预览使用） */
  public isAdjacentToRaft(gx: number, gz: number): boolean {
    const neighbors = [
      [gx + 1, gz],
      [gx - 1, gz],
      [gx, gz + 1],
      [gx, gz - 1],
    ];
    return neighbors.some(([nx, nz]) => this.hasFoundationAt(nx, nz));
  }

  // ==================== Player Collision & Surface ====================

  // Raft Floor Collision Check
  public checkOnRaft(x: number, z: number): boolean {
    return checkOnRaft(this, x, z);
  }

  /**
   * Horizontal obstacle collision detection (Walls, Window Walls, Fences, Pillars, Stairs underside).
   * Prevents walking through walls and solid architecture.
   */
  public checkHorizontalCollision(newX: number, newZ: number, playerY: number, radius = 0.28): boolean {
    return checkHorizontalCollision(this, newX, newZ, playerY, radius);
  }

  /**
   * Exact surface height calculator for Player feet.
   * Seamlessly calculates height across base raft foundations, stairs incline, and second-story upper deck floor.
   */
  public calculateSurfaceHeight(px: number, py: number, pz: number, _elapsed?: number): number {
    return calculateSurfaceHeight(this, px, py, pz);
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
        if (placed.type === 'sail') {
          applySailOpenState(placed.mesh as THREE.Group, !!placed.data.sailOpen);
        }
      }
    });
  }

  /** 清空所有结构（世界重置用；随后一般接 createInitialRaft） */
  public clearAll() {
    this.structures.forEach((s) => {
      this.raftGroup.remove(s.mesh);
    });
    this.structures.clear();
  }

  public dispose() {
    this.preview.destroyGhostMesh();
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
    getWaveHeight: (x, z) => w.ocean().getWaveHeightAt(x, z),
  });
}
