import type * as THREE from 'three';
import type { GameCallbacks } from './gameWorld';
import type { WorldDefinition } from '../data/worldDefinition';
import type { OceanEnvironment } from './environment/ocean';
import type { IslandManager } from './environment/islands';
import type { DebrisSystem } from './systems/debris';
import type { PlayerSystem } from './systems/player';
import type { InventorySystem } from './systems/inventory';
import type { BuildSystem } from './systems/build';
import type { HookSystem } from './systems/hook';
import type { FishingSystem } from './systems/fishing';
import type { StationSystem } from './systems/stations';
import type { SharkSystem } from './systems/shark';
import type { TimeSystem } from './systems/time';
import type { MerchantSystem } from './systems/merchant';

/**
 * WorldView —— 系统工厂拉取依赖的唯一窗口。
 *
 * 每个系统文件底部有一个 createXxxSystem(w: WorldView) 工厂，知道自己
 * 需要什么、怎么接线；GameWorld 只按顺序调用工厂并把系统登记进来。
 * 加一个系统的成本 = 新文件 + GameWorld 里的一行 create + 一行 tick。
 *
 * 约束：
 * - 系统引用全部是惰性 getter：既解循环依赖，也把"只能引用已构造系统"
 *   的约束交给构造顺序（工厂调用顺序）保证。
 * - 本文件只含类型（import type），不产生运行时依赖环。
 */
export interface WorldView {
  // 引擎基础设施
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  keys: Record<string, boolean>;
  isPointerLocked: () => boolean;

  // 世界定义（场景内容数据化；时间与实体集合归各自系统所有）
  definition: WorldDefinition;

  // 系统（惰性：按 GameWorld 的工厂调用顺序由先到后可用）
  player: () => PlayerSystem;
  inventory: () => InventorySystem;
  debris: () => DebrisSystem;
  build: () => BuildSystem;
  hook: () => HookSystem;
  fishing: () => FishingSystem;
  stations: () => StationSystem;
  shark: () => SharkSystem;
  time: () => TimeSystem;
  islands: () => IslandManager;
  ocean: () => OceanEnvironment;
  merchant: () => MerchantSystem;

  // 世界级服务
  /** 存档（BuildSystem 放置后自动存档、SharkSystem 击杀后存档走这里） */
  saveWorld: (notify?: boolean) => void;

  // UI 回调（toast 已统一走事件总线）
  toast: (text: string, color?: string) => void;
  ui: GameCallbacks;
}
