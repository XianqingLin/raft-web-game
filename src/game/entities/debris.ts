import type * as THREE from 'three';
import type { ResourceId } from '../../types/game';

/**
 * 漂浮物实体（entity-manager 模式中的 Entity）——纯数据，无行为。
 *
 * 由 DebrisSystem 持有集合（生成节奏在系统内，基数受上限约束）；
 * hook/stations 通过 DebrisSystem.items 直接读写（标记 caught、splice 移除）。
 */
export interface DebrisObject {
  id: number;
  mesh: THREE.Group;
  type: 'wood' | 'plastic' | 'leaf' | 'barrel' | 'crate' | 'stone' | 'scrap';
  caught: boolean;
  pos: { x: number; y: number; z: number };
  bobPhase: number;
  rotSpeed: number;
  yields: Partial<Record<ResourceId, number>>;
}
