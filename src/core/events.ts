/**
 * 类型化事件总线 —— 系统间解耦的通信主干。
 *
 * 规则：
 * - emit 方不知道谁在听；订阅方通过 on 返回的退订函数自行清理。
 * - 事件清单（GameEvents）只增不改：新系统加入时在这里登记自己的事件，
 *   每个事件带一行注释说明 payload 语义。
 * - 同步派发。
 * - UI 消费约定：纯数据快照事件在 ui/uiStore.ts 底部桥接进 store；
 *   带副作用（指针锁等）的请求事件由 App 直接订阅。
 */

import type {
  BuildingType,
  PlacedStructure,
  PlayerStats,
  HotbarSlot,
  InventorySlot,
  WeatherType,
} from '../types/game';
import type { SharkData } from '../game/entities/shark';

export interface GameEvents {
  /** UI 提示。payload: 提示文本与左侧色条颜色 */
  toast: { text: string; color?: string };
  /** 玩家选中了一个建筑类型（建造面板 / 滚轮切换）。payload: 建筑类型 */
  buildingSelected: { type: BuildingType };
  /** 玩家生存数值快照（系统修改 stats 后推送） */
  statsChanged: PlayerStats;
  /** 快捷栏变化。payload: 槽位数组副本与当前选中索引 */
  hotbarChanged: { hotbar: HotbarSlot[]; activeIdx: number };
  /** 背包变化。payload: 背包槽位数组副本 */
  inventoryChanged: InventorySlot[];
  /** 准星交互提示变化。payload: 提示文案（null 表示无提示） */
  interactPromptChanged: string | null;
  /** 鲨鱼警戒横幅开关 */
  sharkAlertChanged: boolean;
  /** 主鲨鱼数据快照（4x/s 节流推送） */
  sharkDataChanged: SharkData;
  /** 昼夜时间变化（时钟字符串变化时推送）。payload: 天数 / 时钟文本 / 一天进度 */
  timeChanged: { day: number; timeStr: string; progress: number };
  /** 天气切换。payload: 新天气类型 */
  weatherChanged: WeatherType;
  /** 请求 UI 打开/关闭箱子弹窗。payload: 箱子结构（null 表示关闭） */
  openChestRequested: PlacedStructure | null;
  /** 请求 UI 切换背包弹窗（指针锁副作用由 App 处理） */
  toggleInventoryRequested: void;
  /** 请求 UI 开关海面调参面板（指针锁副作用由 App 处理） */
  toggleOceanDebugRequested: void;
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  /** 订阅事件，返回退订函数（React useEffect 清理用） */
  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler as Handler<never>);
    return () => {
      set.delete(handler as Handler<never>);
    };
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    this.handlers.get(type)?.forEach((h) => (h as Handler<E[K]>)(payload));
  }
}

export const events = new EventBus<GameEvents>();
