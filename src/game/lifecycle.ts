/**
 * 系统生命周期契约（entity-manager 模式的第一层）。
 *
 * 两层生命周期，不要混为一谈：
 *
 * 1. System 生命周期 —— 本文件的 Tickable：每个有每帧行为的系统实现它，
 *    GameWorld（组合根）在创建处紧跟一行 register()，**创建顺序即 tick
 *    顺序**——加一个系统 = 一个 create + 一行 register，不需要第二份清单。
 *    顺序即数据流：后 tick 的可以读先 tick 的产出（time 推进 dayTime →
 *    ocean/weather 消费它）。
 *
 * 2. Entity 生命周期 —— spawn / tick / despawn，归各管理器系统内部所有
 *    （DebrisSystem 的漂浮物、SharkSystem 的鲨鱼……），不进全局 tick 表；
 *    各系统的 update 内部自行遍历自己的实体集合。实体的基数由
 *    WorldDefinition（data 层）决定，代码不断言"恰好有一个"。
 *
 * 为什么是接口不是基类：TS 结构类型下 implements Tickable 已经提供编译期
 * 强制（少参数的签名也兼容本接口）；基类只会带来空实现默认值，并把互不
 * 相关的系统绑进一条继承链。没有每帧行为的参与者（merchant、save）不实现
 * 本接口——"不是所有系统都 tick"是事实，不该被基类掩盖。
 *
 * 命名说明：这是 entity-manager 模式（ECS-lite），不是完整 ECS——
 * 实体是各类型自定义的纯数据结构（无组件组合），系统是持有集合的
 * 管理器（无 archetype 查询）。不要按 Unity DOTS / bevy 的预期找组件表。
 */
export interface Tickable {
  /** 每帧调用；dt 为秒（已钳制上限），elapsed 为世界启动以来的秒数 */
  update(dt: number, elapsed: number): void;
}
