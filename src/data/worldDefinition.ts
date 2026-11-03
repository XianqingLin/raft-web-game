/**
 * 世界定义 —— 场景内容的数据化。
 *
 * GameWorld 是组合根，只消费本定义来搭建场景，不硬编码具体内容：
 * 商人筏位置、开局漂浮物、起始时间、自动存档节律等都在这里。
 * 换一个世界（教程关、测试场景）= 传入另一份 WorldDefinition。
 *
 * 纪律：数据只描述"有什么"，不描述"怎么做"——行为（如初始木筏的搭建）
 * 归各系统，定义不内联逻辑。
 */
/** 场景实体生成定义：漂流商人筏 */
export interface MerchantSpawnDef {
  position: [number, number, number];
}

export interface WorldDefinition {
  /** 存档中显示的世界名 */
  worldName: string;
  /** 新世界的起始时间 */
  start: {
    /** 一天中的时间 0..1（0.25 = 正午） */
    dayTime: number;
    /** 起始存活天数 */
    dayCount: number;
  };
  /** 场景实体：漂流商人筏（数组 = 基数归数据层，代码不断言数量） */
  merchants: MerchantSpawnDef[];
  /** 开局漂浮物 */
  initialDebris: {
    count: number;
    /** 生成 x 坐标区间 [min, max] */
    xRange: [number, number];
  };
  /** 自动存档间隔（毫秒） */
  autoSaveIntervalMs: number;
}

export const DEFAULT_WORLD: WorldDefinition = {
  worldName: 'Oceanic Raft',
  start: { dayTime: 0.25, dayCount: 1 },
  merchants: [{ position: [-26, 0, -22] }],
  initialDebris: { count: 6, xRange: [-55, 30] },
  autoSaveIntervalMs: 12000,
};
