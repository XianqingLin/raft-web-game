/**
 * 鲨鱼实体（entity-manager 模式中的 Entity）——纯数据，无行为。
 *
 * 由 SharkSystem 持有集合（新游戏由定义创建，读档由存档恢复），
 * 网格绑定（SharkInstance）归 SharkSystem 内部，不进实体数据。
 * SharkData 同时被推送到 UI（onSharkDataChange），因此保持可序列化的纯数据。
 */
export type SharkState =
  | 'CIRCLING'
  | 'STALKING_PLAYER'
  | 'ATTACKING_RAFT'
  | 'ATTACKING_PLAYER'
  | 'FLEEING';

export interface SharkData {
  health: number;
  maxHealth: number;
  state: SharkState;
  pos: { x: number; y: number; z: number };
  targetPos: { x: number; y: number; z: number };
  angle: number;
  circleRadius: number;
  speed: number;
  targetPlankKey: string | null;
  biteTimer: number;
  fleeTimer: number;
  inWaterAttackTimer: number;
}
