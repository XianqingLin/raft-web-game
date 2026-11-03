import * as THREE from 'three';
import { PlayerStats } from '../types/game';

/**
 * 玩家实体数据（entity-manager 模式中的 Entity）——纯数据，无行为。
 * 由 PlayerSystem 持有集合（WorldDefinition.players 决定基数），
 * 各子系统依赖本接口而非 PlayerSystem 类，保持依赖图无环。
 */
export interface PlayerState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  speed: number;
  onGround: boolean;
  inWater: boolean;
  waterTime: number;
  stats: PlayerStats;
}
