/**
 * BuildGhostPreview —— 建造全息预览（拆分自 build.ts）。
 *
 * 职责：幽灵网格的生命周期（创建/着色/销毁）与每帧落位预览，
 * 输出 ghostSnapCoord 供 BuildSystem.tryPlace 消费。
 *
 * 与 BuildSystem 的依赖走 GhostPreviewHost 窄接口（结构查询 + 选中态），
 * 不持有结构所有权，也不做放置决策。
 */

import * as THREE from 'three';
import type { BuildingType, PlacedStructure } from '../../../types/game';
import { BUILDING_DEFINITIONS } from '../../../data/buildings';
import { BLOCK_SIZE, BLOCK_HEIGHT, WALL_HEIGHT } from '../../visuals/shared';
import { InventorySystem } from '../inventory';

export interface GhostSnapCoord {
  gx: number;
  gy: number;
  gz: number;
  /** 特殊落位（墙体边缘 / 二层）时的精确位置与朝向 */
  posX?: number;
  posY?: number;
  posZ?: number;
  rot?: number;
  valid: boolean;
  error?: string;
}

/** 幽灵预览需要的宿主能力（BuildSystem 结构化满足即可） */
export interface GhostPreviewHost {
  readonly structures: Map<string, PlacedStructure>;
  readonly selectedBuildingType: BuildingType;
  readonly isDemolishMode: boolean;
  readonly buildRotation: number;
  readonly raftGroup: THREE.Group;
  hasFoundationAt(gx: number, gz: number): boolean;
  hasFloorAt(gx: number, gz: number): boolean;
  isAdjacentToRaft(gx: number, gz: number): boolean;
  isSupportedForUpperDeck(gx: number, gz: number, radius: number): boolean;
  getStructureAt(type: BuildingType, gx: number, gz: number): PlacedStructure | undefined;
  getStructuresAtCoord(gx: number, gz: number): PlacedStructure[];
  createMeshFor(type: BuildingType): THREE.Group;
}

export interface GhostPreviewContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 只读使用：落位意图判定需要玩家位置/视线高度 */
  player: () => { pos: THREE.Vector3 };
  /** 只读使用：素材是否足够决定幽灵颜色 */
  inventory: InventorySystem;
}

export class BuildGhostPreview {
  public ghostMesh: THREE.Group | null = null;
  /** 每帧预览输出：tryPlace 按此落位/拆除 */
  public ghostSnapCoord: GhostSnapCoord | null = null;

  private raycaster = new THREE.Raycaster();

  constructor(
    private host: GhostPreviewHost,
    private ctx: GhostPreviewContext
  ) {}

  /** 每帧：木筏浮力 + 建造全息预览（Tickable 统一入口） */
  public update() {
    if (!this.ghostMesh) {
      this.createGhostMesh();
    }

    // 幽灵预览加在 scene 上（世界坐标），木筏起伏时 y 需要补偿筏体实时高度
    const raftY = this.host.raftGroup.position.y;

    // Raycast forward from camera
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.ctx.camera);
    const buildPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPt = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(buildPlane, hitPt);

    if (hit && hitPt.distanceTo(this.ctx.player().pos) < 14) {
      const gx = Math.round(hitPt.x / BLOCK_SIZE);
      const gz = Math.round(hitPt.z / BLOCK_SIZE);
      const def = BUILDING_DEFINITIONS[this.host.selectedBuildingType];
      const canAfford = this.ctx.inventory.canAfford(def.cost);

      const isPlankType = this.host.selectedBuildingType === 'foundation' || this.host.selectedBuildingType === 'floor';
      const isTriOrNet = this.host.selectedBuildingType === 'tri_foundation' || this.host.selectedBuildingType === 'collection_net';

      const hasFoundationHere = this.host.hasFoundationAt(gx, gz);
      const hasFloorHere = this.host.hasFloorAt(gx, gz);

      if (this.host.isDemolishMode) {
        const items = this.host.getStructuresAtCoord(gx, gz);
        if (items.length > 0) {
          this.ghostSnapCoord = { gx, gy: 0, gz, valid: true };
          this.ghostMesh!.position.set(gx * BLOCK_SIZE, raftY, gz * BLOCK_SIZE);
          this.ghostMesh!.visible = true;
          this.setGhostColor(0xef4444); // Red for demolish
          return;
        }
      } else if (isPlankType) {
        // Wooden Planks: acts as BOTH Upper Deck and Lower Deck!
        // If player is on upper deck or aiming upward / on top of beams/walls:
        const isUpperDeckIntent =
          this.ctx.player().pos.y - raftY > 2.0 ||
          (hasFoundationHere && !hasFloorHere && (this.ctx.camera.rotation.x > -0.25 || this.host.isSupportedForUpperDeck(gx, gz, 2)));

        if (isUpperDeckIntent) {
          // Upper Deck Floor placement atop Beams, Walls, or Window Walls
          const targetY = BLOCK_HEIGHT / 2 + WALL_HEIGHT;
          const isSupported = this.host.isSupportedForUpperDeck(gx, gz, 2);
          const alreadyFloor = hasFloorHere;

          if (!alreadyFloor) {
            this.ghostMesh!.position.set(gx * BLOCK_SIZE, raftY + targetY, gz * BLOCK_SIZE);
            this.ghostMesh!.rotation.y = (this.host.buildRotation * Math.PI) / 2;
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
                rot: this.host.buildRotation,
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
                rot: this.host.buildRotation,
                valid: canAfford,
              };
            }
            return;
          }
        }

        // Lower Deck Foundation placement on water plane
        if (!hasFoundationHere && this.host.isAdjacentToRaft(gx, gz)) {
          this.ghostSnapCoord = {
            gx,
            gy: 0,
            gz,
            posX: gx * BLOCK_SIZE,
            posY: 0,
            posZ: gz * BLOCK_SIZE,
            rot: this.host.buildRotation,
            valid: canAfford,
          };
          this.ghostMesh!.position.set(gx * BLOCK_SIZE, raftY, gz * BLOCK_SIZE);
          this.ghostMesh!.rotation.y = (this.host.buildRotation * Math.PI) / 2;
          this.ghostMesh!.visible = true;
          this.setGhostColor(canAfford ? 0x22c55e : 0xf87171);
          return;
        }
      } else if (isTriOrNet) {
        // Corner triangle and collection nets on water
        if (!hasFoundationHere && this.host.isAdjacentToRaft(gx, gz)) {
          this.ghostSnapCoord = {
            gx,
            gy: 0,
            gz,
            posX: gx * BLOCK_SIZE,
            posY: 0,
            posZ: gz * BLOCK_SIZE,
            rot: this.host.buildRotation,
            valid: canAfford,
          };
          this.ghostMesh!.position.set(gx * BLOCK_SIZE, raftY, gz * BLOCK_SIZE);
          this.ghostMesh!.rotation.y = (this.host.buildRotation * Math.PI) / 2;
          this.ghostMesh!.visible = true;
          this.setGhostColor(canAfford ? 0x22c55e : 0xf87171);
          return;
        }
      } else if (
        this.host.selectedBuildingType === 'wall' ||
        this.host.selectedBuildingType === 'window_wall' ||
        this.host.selectedBuildingType === 'fence'
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

          const targetY = hasFloorHere && this.ctx.player().pos.y - raftY > 2.0 ? BLOCK_HEIGHT / 2 + WALL_HEIGHT : BLOCK_HEIGHT / 2;
          const edgeKey = `${this.host.selectedBuildingType}_${edgeX.toFixed(1)}_${targetY.toFixed(1)}_${edgeZ.toFixed(1)}`;
          const alreadyPlaced = this.host.structures.has(edgeKey);

          this.ghostMesh!.position.set(edgeX, raftY + targetY, edgeZ);
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
        const canPlace = hasFoundationHere || (hasFloorHere && this.host.selectedBuildingType !== 'stairs');
        const alreadyHasThis = !!this.host.getStructureAt(this.host.selectedBuildingType, gx, gz);

        if (canPlace && !alreadyHasThis) {
          const targetY =
            hasFloorHere && this.ctx.player().pos.y - raftY > 2.0 && this.host.selectedBuildingType !== 'pillar'
              ? BLOCK_HEIGHT / 2 + WALL_HEIGHT
              : BLOCK_HEIGHT / 2;

          this.ghostMesh!.position.set(gx * BLOCK_SIZE, raftY + targetY, gz * BLOCK_SIZE);
          this.ghostMesh!.rotation.y = (this.host.buildRotation * Math.PI) / 2;
          this.ghostMesh!.visible = true;
          this.setGhostColor(canAfford ? 0x22c55e : 0xf87171);

          this.ghostSnapCoord = {
            gx,
            gy: targetY > 1 ? 1 : 0,
            gz,
            posX: gx * BLOCK_SIZE,
            posY: targetY,
            posZ: gz * BLOCK_SIZE,
            rot: this.host.buildRotation,
            valid: canAfford,
          };
          return;
        }
      }
    }

    if (this.ghostMesh) this.ghostMesh.visible = false;
    this.ghostSnapCoord = null;
  }

  public createGhostMesh() {
    const sourceMesh = this.host.createMeshFor(this.host.selectedBuildingType);

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

    this.ghostMesh.rotation.y = (this.host.buildRotation * Math.PI) / 2;
    this.ctx.scene.add(this.ghostMesh);
  }

  public setGhostColor(hex: number) {
    if (!this.ghostMesh) return;
    this.ghostMesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        (child.material as THREE.MeshBasicMaterial).color.setHex(hex);
      }
    });
  }

  public destroyGhostMesh() {
    if (this.ghostMesh) {
      this.ctx.scene.remove(this.ghostMesh);
      this.ghostMesh = null;
    }
  }
}
