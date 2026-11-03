/**
 * 类型化事件总线 —— 系统间解耦的通信主干。
 *
 * 规则：
 * - emit 方不知道谁在听；订阅方通过 on 返回的退订函数自行清理。
 * - 事件清单（GameEvents）只增不改：新系统加入时在这里登记自己的事件，
 *   每个事件带一行注释说明 payload 语义。
 * - 同步派发，与旧的回调调用语义一致。
 */

export interface GameEvents {
  /** UI 提示。payload: 提示文本与左侧色条颜色 */
  toast: { text: string; color?: string };
}

type Handler<T> = (payload: T) => void;

export function createEventBus<E extends object>() {
  const handlers = new Map<keyof E, Set<Handler<never>>>();

  return {
    on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      set.add(handler as Handler<never>);
      return () => {
        set.delete(handler as Handler<never>);
      };
    },
    emit<K extends keyof E>(type: K, payload: E[K]): void {
      handlers.get(type)?.forEach((h) => (h as Handler<E[K]>)(payload));
    },
  };
}

export const events = createEventBus<GameEvents>();
