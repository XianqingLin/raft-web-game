/**
 * Raft 游戏定义 —— 启动配置与新游戏初始状态的数据化。
 *
 * newGame 用于新游戏、世界重置及旧存档字段回退。
 * 可变实体的后续状态由对应系统持有，需要跨会话保留的部分进入 WorldSaveData。
 *
 * 纪律：数据只描述"有什么"，不描述"怎么做"——行为（如初始木筏的搭建）
 * 归各系统，定义不内联逻辑。
 */

/** 生物实体生成定义：鲨鱼 */
export interface SharkSpawnDef {
  /** 初始位置 [x,y,z]（默认 [20, -0.4, 0]） */
  position?: [number, number, number];
  /** 绕筏盘旋半径（默认 18） */
  circleRadius?: number;
  /** 巡游速度（默认 3.5） */
  speed?: number;
  /** 初始盘旋角（默认 0） */
  angle?: number;
}

/** 生物实体生成定义：玩家 */
export interface PlayerSpawnDef {
  /** 初始位置 [x,y,z]（默认在初始木筏上方） */
  position?: [number, number, number];
}

export interface NewGameDefinition {
  /** 新游戏的起始时间 */
  start: {
    /** 一天中的时间 0..1（0.25 = 正午） */
    dayTime: number;
    /** 起始存活天数 */
    dayCount: number;
  };
  /** 新游戏鲨鱼（数组 = 基数归数据层） */
  sharks: SharkSpawnDef[];
  /** 新游戏玩家（数组 = 基数归数据层；单人模式即长度 1） */
  players: PlayerSpawnDef[];
  /** 新游戏开局漂浮物 */
  initialDebris: {
    count: number;
    /** 生成 x 坐标区间 [min, max] */
    xRange: [number, number];
  };
}

export interface RaftGameDefinition {
  /** 存档中显示的世界名 */
  worldName: string;
  /** 自动存档间隔（毫秒） */
  autoSaveIntervalMs: number;
  /** 仅用于新游戏与世界重置的初始状态 */
  newGame: NewGameDefinition;
}

export const DEFAULT_RAFT_GAME: RaftGameDefinition = {
  worldName: 'Oceanic Raft',
  autoSaveIntervalMs: 12000,
  newGame: {
    start: { dayTime: 0.25, dayCount: 1 },
    sharks: [{ position: [20, -0.4, 0], circleRadius: 18, speed: 3.5 }],
    players: [{}],
    initialDebris: { count: 6, xRange: [-55, 30] },
  },
};
