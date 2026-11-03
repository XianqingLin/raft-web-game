/**
 * 系统生命周期约定（entity-manager 模式的第一层）。
 *
 * 两层生命周期，不要混为一谈：
 *
 * 1. System 生命周期 —— 本文件的 Tickable：GameWorld（组合根）按声明顺序
 *    注册进 tick 注册表，每帧按序执行。顺序即数据流：后 tick 的可以读
 *    先 tick 的产出（time 推进 dayTime → ocean/weather 消费它）。
 *
 * 2. Entity 生命周期 —— spawn / tick / despawn，归各管理器系统内部所有
 *    （DebrisSystem 的漂浮物、SharkSystem 的鲨鱼……），不进全局 tick 表；
 *    各系统的 tick 内部自行遍历自己的实体集合。实体的基数由
 *    WorldDefinition（data 层）决定，代码不断言"恰好有一个"。
 *
 * 命名说明：这是 entity-manager 模式（ECS-lite），不是完整 ECS——
 * 实体是各类型自定义的纯数据结构（无组件组合），系统是持有集合的
 * 管理器（无 archetype 查询）。不要按 Unity DOTS / bevy 的预期找组件表。
 */
export interface Tickable {
  /** 注册表内的名字（调试与顺序可读性用） */
  readonly name: string;
  /** 每帧调用；dt 为秒（已钳制上限），elapsed 为世界启动以来的秒数 */
  tick(dt: number, elapsed: number): void;
}
