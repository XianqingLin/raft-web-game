import type { WorldView } from '../worldView';
import type { GameCallbacks } from '../ui';
import type { WorldDefinition } from '../../data/worldDefinition';
import { SystemRegistry, systemKey } from '../lifecycle';
import { OceanEnvironment, createOceanEnvironment } from '../environment/ocean';
import { WeatherSystem, createWeather } from '../environment/weather';
import { IslandManager, createIslandManager } from '../environment/islands';
import { TimeSystem, createTimeSystem } from './time';
import { PlayerSystem, createPlayerSystem } from './player';
import { InventorySystem, createInventorySystem } from './inventory';
import { MerchantSystem, createMerchantSystem } from './merchant';
import { FishingSystem, createFishingSystem } from './fishing';
import { HookSystem, createHookSystem } from './hook';
import { BuildSystem, createBuildSystem } from './build';
import { DebrisSystem, createDebrisSystem } from './debris';
import { StationSystem, createStationSystem } from './stations';
import { SharkSystem, createSharkSystem } from './shark';
import { InteractionSystem, createInteractionSystem } from './interact';
import { SaveSystem, createSaveSystem } from './save';

/**
 * 系统键 —— 全部系统的类型化查找入口。
 * 消费方：WorldView 的惰性 getter（createRaftGame 接线）与 RaftGame 门面。
 *
 * class 系统直接用类当 key（sys(BuildSystem)，类既是类型又是令牌）；只有
 * 工厂返回对象字面量的环境三件套没有类，才用 systemKey() 造假名令牌。
 */
export const SYS = {
  time: TimeSystem,
  player: PlayerSystem,
  inventory: InventorySystem,
  ocean: systemKey<OceanEnvironment>('OceanEnvironment'),
  weather: systemKey<WeatherSystem>('WeatherSystem'),
  islands: systemKey<IslandManager>('IslandManager'),
  merchant: MerchantSystem,
  fishing: FishingSystem,
  hook: HookSystem,
  build: BuildSystem,
  debris: DebrisSystem,
  stations: StationSystem,
  shark: SharkSystem,
  interaction: InteractionSystem,
  save: SaveSystem,
} as const;

/**
 * 唯一的系统名单 —— 加新系统只改本文件：一行 key + 一行 add。
 *
 * 创建顺序即依赖顺序即 tick 顺序（time 推进 dayTime → ocean/weather 消费它；
 * interaction 最后创建，读几乎所有系统的 aim 判定）。有 update 方法的系统
 * 自动进 GameEngine 的每帧 tick，有 dispose 方法的自动进 dispose——名单里
 * 不需要再登记第二份 tick/dispose 清单。
 */
export function createSystems(w: WorldView, r: SystemRegistry): SystemRegistry {
  // Time 最先：后续系统的 tick 都读 time.dayTime。
  r.add(SYS.time, createTimeSystem(w));

  r.add(SYS.player, createPlayerSystem(w));
  r.add(SYS.inventory, createInventorySystem(w));

  // Ocean 在 weather 之前：weather 的灯光由 ocean 创建（创建期依赖），
  // 因此 ocean 的 tick 也略先于 weather——波形参数消费上一帧的天气值；
  // 这些参数本身以秒级速度插值，一帧滞后不可感知。
  const ocean = r.add(SYS.ocean, createOceanEnvironment(w));
  r.add(SYS.weather, createWeather(w, ocean));

  r.add(SYS.islands, createIslandManager(w.scene));

  // Drifting Merchant Outpost Barge (Scavenger Economy) — count/position from definition。
  // 静态场景实体，无每帧行为，仅注册供查找。
  r.add(SYS.merchant, createMerchantSystem(w));

  r.add(SYS.fishing, createFishingSystem(w));
  r.add(SYS.hook, createHookSystem(w));
  r.add(SYS.build, createBuildSystem(w));
  r.add(SYS.debris, createDebrisSystem(w));
  r.add(SYS.stations, createStationSystem(w));
  r.add(SYS.shark, createSharkSystem(w));
  r.add(SYS.interaction, createInteractionSystem(w));
  r.add(SYS.save, createSaveSystem(w));

  return r;
}

/**
 * 世界引导 —— 实体编排：决定世界初始有哪些实体（读档恢复，或初始木筏 +
 * 开局漂浮物），并把初始状态推给 UI。与 createSystems 同文件：二者都是
 * 组合知识，GameEngine 不该认识任何具体系统。
 */
export function bootstrapWorld(
  w: WorldView,
  systems: SystemRegistry,
  definition: WorldDefinition,
  ui: Pick<
    GameCallbacks,
    'onToast' | 'onStatsChange' | 'onHotbarChange' | 'onInventoryChange'
  >,
): void {
  const save = systems.get(SYS.save);
  const build = systems.get(SYS.build);
  const inventory = systems.get(SYS.inventory);

  // Load Saved World or Create Starter Raft
  const savedWorld = save.loadLatest();
  if (savedWorld) {
    save.load(savedWorld);
    ui.onToast?.(`📂 World restored from previous save! (Day ${savedWorld.dayCount || 1})`, '#38bdf8');
  } else {
    build.createInitialRaft();
  }

  // Populate Initial Floating Debris
  const [debrisMinX, debrisMaxX] = definition.initialDebris.xRange;
  for (let i = 0; i < definition.initialDebris.count; i++) {
    systems.get(SYS.debris).spawn(debrisMinX + Math.random() * (debrisMaxX - debrisMinX));
  }

  // Update active equipped tool
  systems.get(SYS.hook).updateEquippedTool(
    inventory.hotbar[inventory.activeHotbarIdx]?.itemId ?? null
  );

  // Notify initial state to React
  ui.onStatsChange({ ...systems.get(SYS.player).localPlayer.stats });
  ui.onHotbarChange([...inventory.hotbar], inventory.activeHotbarIdx);
  ui.onInventoryChange([...inventory.inventory]);
}

/** Raft 专用重置编排；通用 GameEngine 不认识这些系统或世界定义。 */
export function resetRaftWorld(
  systems: SystemRegistry,
  definition: WorldDefinition,
  ui: Pick<GameCallbacks, 'onToast'>,
): void {
  systems.get(SYS.save).clear();
  systems.get(SYS.build).clearAll();
  systems.get(SYS.shark).reset();
  systems.get(SYS.time).resetTo(definition.start);
  systems.get(SYS.build).createInitialRaft();
  systems.get(SYS.player).respawnPlayer();
  ui.onToast?.('🔄 World reset to initial 2x2 starter raft!', '#38bdf8');
}
