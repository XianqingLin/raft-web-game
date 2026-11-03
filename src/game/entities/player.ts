import type * as THREE from 'three';
import type { PlayerStats } from '../../types/game';

/**
 * 玩家实体（entity-manager 模式中的 Entity）——纯数据，无行为。
 *
 * 由 PlayerSystem 持有集合（WorldDefinition.players 决定基数），
 * 各子系统依赖本接口而非 PlayerSystem 类，保持依赖图无环。
 * 约定：entities/ 目录只放实体纯数据，不放行为、不放系统引用。
 */
export interface PlayerState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  speed: number;
  onGround: boolean;
  inWater: boolean;
  /** 在水中持续时长（SharkSystem 用于水中袭击判定） */
  waterTime: number;
  stats: PlayerStats;
}
