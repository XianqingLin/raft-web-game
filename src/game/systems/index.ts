import type { WorldView } from '../worldView';
import type { RaftGameDefinition } from '../../data/gameDefinition';
import { SystemRegistry } from '../lifecycle';
import { events } from '../../core/events';
import { createSkyEnvironment } from './environment/sky';
import { createOceanEnvironment } from './environment/ocean';
import { createWeather } from './environment/weather';
import { createWindSystem } from './environment/wind';
import { TimeSystem, createTimeSystem } from './time';
import { PlayerSystem, createPlayerSystem } from './player';
import { InventorySystem, createInventorySystem } from './inventory';
import { HookSystem, createHookSystem } from './hook';
import { BuildSystem, createBuildSystem } from './build';
import { DebrisSystem, createDebrisSystem } from './debris';
import { StationSystem, createStationSystem } from './stations';
import { SharkSystem, createSharkSystem } from './shark';
import { InteractionSystem, createInteractionSystem } from './interact';
import { SaveSystem, createSaveSystem } from './save';

/** 系统名称的集中出处。 */
export const SYS = {
  time: 'time',
  player: 'player',
  inventory: 'inventory',
  sky: 'sky',
  ocean: 'ocean',
  weather: 'weather',
  wind: 'wind',
  hook: 'hook',
  build: 'build',
  debris: 'debris',
  stations: 'stations',
  shark: 'shark',
  interaction: 'interaction',
  save: 'save',
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
  r.add(SYS.time, createTimeSystem());

  r.add(SYS.player, createPlayerSystem(w));
  r.add(SYS.inventory, createInventorySystem(w));

  // Sky 在 ocean/weather 之前：weather 的灯光由 sky 创建（创建期依赖），
  // ocean 的水色派生每帧读天空色；sky 的 tick（昼夜过渡）也略先于 weather——
  // 三者都是每帧小步 lerp，顺序与拆分前一致，叠加效果不变。
  const sky = r.add(SYS.sky, createSkyEnvironment(w));
  const ocean = r.add(SYS.ocean, createOceanEnvironment(w));
  r.add(SYS.weather, createWeather(w, sky));
  // wind 在 weather 之后：tick 读天气目标风速（惰性 getter，创建顺序无环）；
  // ocean/weather 的 tick 略先于 wind，消费上一帧的滚动量——一帧滞后不可感知。
  r.add(SYS.wind, createWindSystem(w));

  r.add(SYS.hook, createHookSystem(w));
  r.add(SYS.build, createBuildSystem(w));
  r.add(SYS.debris, createDebrisSystem(w));
  r.add(SYS.stations, createStationSystem(w));
  r.add(SYS.shark, createSharkSystem(w));
  r.add(SYS.interaction, createInteractionSystem(w));
  r.add(SYS.save, createSaveSystem(w));

  return r;
}

/** 只在新游戏或世界重置时创建默认动态实体与初始内容。 */
function initializeNewGame(systems: SystemRegistry, definition: RaftGameDefinition): void {
  const { newGame } = definition;
  systems.get<TimeSystem>(SYS.time).resetTo(newGame.start);

  const player = systems.get<PlayerSystem>(SYS.player);
  player.clear();
  for (const def of newGame.players) player.spawn(def);

  // 新游戏/世界重置：物品栏恢复默认热栏与背包（读档以存档为权威，不走这里）
  systems.get<InventorySystem>(SYS.inventory).resetToDefaults();

  const shark = systems.get<SharkSystem>(SYS.shark);
  shark.clear();
  shark.setDefeated(false);
  for (const def of newGame.sharks) shark.spawn(def);

  systems.get<BuildSystem>(SYS.build).createInitialRaft();

  for (let i = 0; i < newGame.initialDebris.count; i++) {
    systems.get<DebrisSystem>(SYS.debris).spawn(true);
  }
}

/**
 * 世界引导：固定场景已由系统工厂构建；这里只选择动态状态的来源。
 * 新游戏读取 newGame，读档则以存档为权威重建动态实体，不再先创建默认世界。
 */
export function bootstrapWorld(
  w: WorldView,
  systems: SystemRegistry,
  definition: RaftGameDefinition,
): void {
  const save = systems.get<SaveSystem>(SYS.save);
  const inventory = systems.get<InventorySystem>(SYS.inventory);
  const savedWorld = save.loadLatest();

  if (savedWorld) {
    // v1 存档没有逐鲨鱼数据，且 player 曾可选；仅为这些旧档回退到初始定义。
    if (!savedWorld.player) {
      for (const def of definition.newGame.players) {
        systems.get<PlayerSystem>(SYS.player).spawn(def);
      }
    }
    if (!Array.isArray(savedWorld.sharks)) {
      for (const def of definition.newGame.sharks) {
        systems.get<SharkSystem>(SYS.shark).spawn(def);
      }
    }
    save.load(savedWorld);
    events.emit('toast', {
      text: `📂 World restored from previous save! (Day ${savedWorld.dayCount || 1})`,
      color: '#38bdf8',
    });
  } else {
    initializeNewGame(systems, definition);
  }

  systems.get<HookSystem>(SYS.hook).updateEquippedTool(
    inventory.hotbar[inventory.activeHotbarIdx]?.itemId ?? null
  );

  events.emit('statsChanged', { ...systems.get<PlayerSystem>(SYS.player).localPlayer.stats });
  events.emit('hotbarChanged', { hotbar: [...inventory.hotbar], activeIdx: inventory.activeHotbarIdx });
  events.emit('inventoryChanged', [...inventory.inventory]);
}

/** Raft 专用重置编排；通用 GameEngine 不认识这些系统或游戏定义。 */
export function resetRaftWorld(
  systems: SystemRegistry,
  definition: RaftGameDefinition,
): void {
  systems.get<SaveSystem>(SYS.save).clear();
  systems.get<BuildSystem>(SYS.build).clearAll();
  systems.get<DebrisSystem>(SYS.debris).dispose();
  initializeNewGame(systems, definition);
  events.emit('statsChanged', { ...systems.get<PlayerSystem>(SYS.player).localPlayer.stats });
  events.emit('toast', { text: '🔄 World reset to initial 2x2 starter raft!', color: '#38bdf8' });
}
