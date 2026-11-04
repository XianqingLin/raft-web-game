/** 每帧更新的系统；dt 为秒，elapsed 为启动以来的秒数。 */
export interface Tickable {
  update(dt: number, elapsed: number): void;
}

/** 持有需要释放资源的系统。 */
export interface Disposable {
  dispose(): void;
}

/**
 * 有序系统注册表。注册顺序即 tick/dispose 顺序，字符串是唯一键。
 * 系统内部的实体由各系统自行管理，不进入此注册表。
 */
export class SystemRegistry {
  private systems = new Map<string, unknown>();
  private tickCache: Tickable[] | null = null;

  /** 注册并原样返回实例，便于组合根保留局部依赖。 */
  public add<T>(name: string, instance: T): T {
    if (this.systems.has(name)) {
      throw new Error(`SystemRegistry: "${name}" 重复注册`);
    }
    this.systems.set(name, instance);
    this.tickCache = null;
    return instance;
  }

  /** 按名称查找；调用方声明期望类型，未注册时立即抛错。 */
  public get<T>(name: string): T {
    if (!this.systems.has(name)) {
      throw new Error(`SystemRegistry: "${name}" 未注册（检查 systems/index.ts 名单）`);
    }
    return this.systems.get(name) as T;
  }

  /** 按注册顺序返回有 update 方法的系统。 */
  public tickables(): Tickable[] {
    if (!this.tickCache) {
      this.tickCache = Array.from(this.systems.values())
        .filter((s): s is Tickable => typeof (s as Partial<Tickable>).update === 'function');
    }
    return this.tickCache;
  }

  /** 按注册顺序返回有 dispose 方法的系统。 */
  public disposables(): Disposable[] {
    return Array.from(this.systems.values())
      .filter((s): s is Disposable => typeof (s as Partial<Disposable>).dispose === 'function');
  }
}
