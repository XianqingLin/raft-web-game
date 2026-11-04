/**
 * 系统生命周期契约（entity-manager 模式的第一层）。
 *
 * 两层生命周期，不要混为一谈：
 *
 * 1. System 生命周期 —— 本文件的 Tickable / Disposable / SystemRegistry：
 *    系统名单在 systems/index.ts（创建顺序即依赖顺序即 tick 顺序），
 *    GameEngine（通用运行宿主）不认识具体系统——遍历注册表 tick/dispose。
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

/** 持有需要释放资源的系统实现它（入 registry 后由 GameEngine.dispose 调用） */
export interface Disposable {
  dispose(): void;
}

/**
 * 系统注册键：一个带名字的 phantom 类型令牌。
 *
 * class 系统不需要它——类自己就是最好的 key（sys(BuildSystem)，Angular 式）。
 * 只有工厂返回对象字面量的系统（OceanEnvironment / WeatherSystem /
 * IslandManager）没有类可当 key，才用 systemKey() 造一个令牌。
 */
export interface SystemKey<T> {
  readonly name: string;
  /** phantom 类型标记，仅供 get<T> 推断返回类型，运行期无值 */
  readonly _phantom?: T;
}

/** 声明一个系统键（仅对象字面量系统需要，与同组键一起定义在 SYS 里） */
export function systemKey<T>(name: string): SystemKey<T> {
  return { name };
}

/** 注册表接受的 key：类构造器（class 系统）或 SystemKey 令牌（对象系统） */
export type SystemRef<T> = SystemKey<T> | (abstract new (...args: any[]) => T);

/**
 * SystemRegistry —— 有序系统存储 + 类型化查找。
 *
 * add 的调用顺序即创建顺序即 tick 顺序（见 systems/index.ts）；
 * get 按 key 身份查找，未注册时抛错（暴露名单遗漏，宁可炸在启动期）。
 */
export class SystemRegistry {
  private entries: Array<{ key: SystemRef<unknown>; instance: unknown }> = [];
  private tickCache: Tickable[] | null = null;

  /** 登记一个系统；原样返回实例，支持 `const ocean = r.add(...)` 接住局部依赖 */
  public add<T>(key: SystemRef<T>, instance: T): T {
    this.entries.push({ key: key as SystemRef<unknown>, instance });
    this.tickCache = null;
    return instance;
  }

  /** 按键查找系统（O(n)，n 为系统数，调用频率低）；未注册抛错 */
  public get<T>(key: SystemRef<T>): T {
    const target = key as object;
    const entry = this.entries.find((e) => (e.key as object) === target);
    if (!entry) {
      const name = (key as { name: string }).name;
      throw new Error(`SystemRegistry: "${name}" 未注册（检查 systems/index.ts 名单）`);
    }
    return entry.instance as T;
  }

  /** 仅调试用：按名字查找，无类型保证、不进生产代码（生产代码用 get(SYS.x)） */
  public getByName(name: string): unknown {
    const entry = this.entries.find((e) => e.key.name === name);
    if (!entry) {
      throw new Error(`SystemRegistry: no system named "${name}"`);
    }
    return entry.instance;
  }

  /** 有每帧行为的系统（鸭子判定：有 update 方法）；顺序 = 登记顺序 */
  public tickables(): Tickable[] {
    if (!this.tickCache) {
      this.tickCache = this.entries
        .map((e) => e.instance)
        .filter((s): s is Tickable => typeof (s as Partial<Tickable>).update === 'function');
    }
    return this.tickCache;
  }

  /** 持有清理逻辑的系统（鸭子判定：有 dispose 方法）；顺序 = 登记顺序 */
  public disposables(): Disposable[] {
    return this.entries
      .map((e) => e.instance)
      .filter((s): s is Disposable => typeof (s as Partial<Disposable>).dispose === 'function');
  }
}
