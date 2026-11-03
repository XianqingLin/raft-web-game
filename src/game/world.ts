import { DebrisObject } from '../types/game';

/**
 * 跨系统共享的可变世界状态（纯数据）。
 *
 * 设计约束：
 * - 只放跨系统共享的可变状态，不放服务/回调（引用走各系统 context），
 *   避免它变成新的 god object。
 * - 数据与行为分离：它是未来网络同步/存档扩展的天然快照边界
 *   （多人友好设计约束之一，见 docs/FEATURES_OFF.md §3）。
 */
export interface WorldState {
  /** 一天中的时间 0..1（0.25 = 正午，0.5 = 日落，0.75 = 午夜） */
  dayTime: number;
  /** 存活天数 */
  dayCount: number;
  /** 漂浮物列表（由 DebrisSystem 维护；hook/stations 通过它捕捞） */
  debris: DebrisObject[];
  /** 漂浮物自增 id（DebrisSystem 生成时使用） */
  nextDebrisId: number;
}

export function createWorldState(): WorldState {
  return {
    dayTime: 0.25,
    dayCount: 1,
    debris: [],
    nextDebrisId: 1,
  };
}
