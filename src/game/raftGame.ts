import type {
  BuildingType,
  WeatherType,
  WorldSaveData,
} from '../types/game';
import { DEFAULT_RAFT_GAME, type RaftGameDefinition } from '../data/gameDefinition';
import { GameEngine } from './engine/gameEngine';
import { engineInputBindings } from './input/bindings';
import { SystemRegistry } from './lifecycle';
import { RaftInputHandler } from './raftInput';
import {
  SYS,
  bootstrapWorld,
  createSystems,
  resetRaftWorld,
} from './systems';
import type { BuildSystem } from './systems/build';
import type { DebrisSystem } from './systems/debris';
import type { OceanEnvironment } from './systems/environment/ocean';
import type { OceanTuning } from './systems/environment/waveform';
import type { WeatherSystem } from './systems/environment/weather';
import type { WindDebugState, WindSystem } from './systems/environment/wind';
import type { HookState, HookSystem } from './systems/hook';
import type { InteractionSystem } from './systems/interact';
import type { InventorySystem } from './systems/inventory';
import type { PlayerSystem } from './systems/player';
import type { SaveSystem } from './systems/save';
import type { SharkSystem } from './systems/shark';
import type { StationSystem } from './systems/stations';
import type { TimeSystem } from './systems/time';
import type { WorldView } from './worldView';

/** React 所需的少量高频状态；轮询细节不泄漏具体系统。 */
export interface RaftHudState {
  hookState: HookState;
  hookPower: number;
  isBuildMode: boolean;
  isDemolishMode: boolean;
  selectedBuilding: BuildingType;
  sharkDefeatedOnce: boolean;
}

/** Raft 专用应用命令：UI 不接触 SystemRegistry 或具体系统。 */
export interface RaftGameCommands {
  selectHotbarSlot(index: number): void;
  consumeSlot(isInventory: boolean, index: number): boolean;
  craftRecipe(recipeId: string): boolean;
  selectBuilding(type: BuildingType): void;
  toggleBuildMode(): void;
  respawn(): void;
  saveWorld(notify?: boolean): WorldSaveData;
  resetWorld(): void;
}

/**
 * 调试命令（仅开发期调试面板消费）。
 *
 * 上线摘除调试时的清单：删除本接口与 RaftGame.debug 赋值块、
 * 删除 OceanDebugPanel.tsx、删除 App.tsx 的挂载分支。
 * 系统侧的 getDebugState/setManualWind/setAuto/getTuning 等出口保留不动。
 */
export interface RaftGameDebugCommands {
  /** 海面调参：读取副本 / 合并写入 / 恢复默认 */
  getOceanTuning(): OceanTuning;
  setOceanTuning(partial: Partial<OceanTuning>): void;
  resetOceanTuning(): void;
  /** 天气：立即切换（自调节开 = 强制工况，关 = 直接冻结） */
  getWeather(): WeatherType;
  setWeather(type: WeatherType): void;
  /** 天气自调节开关：关闭后天气冻结在手动选择 */
  setWeatherAuto(on: boolean): void;
  /** 风/海流：实时读数、自调节开关与手动风向风速 */
  getWindDebug(): WindDebugState;
  setWindAuto(on: boolean): void;
  /** 手动风向（0°=正北）与风速（m/s）；自调节关闭时生效 */
  setManualWind(dirDeg: number, speed: number): void;
}

/** 已完整组装的 Raft 应用。具体系统知识集中在这个应用门面和组合根。 */
export class RaftGame {
  public readonly commands: RaftGameCommands;
  /** 调试命令（仅开发期调试面板消费；上线摘除时随接口注释的清单一起删） */
  public readonly debug: RaftGameDebugCommands;

  constructor(
    private engine: GameEngine,
    private systems: SystemRegistry,
    private definition: RaftGameDefinition,
  ) {
    this.commands = {
      selectHotbarSlot: (index) => {
        this.systems.get<InventorySystem>(SYS.inventory).setActiveHotbarSlot(index);
      },
      consumeSlot: (isInventory, index) => {
        return this.systems.get<InventorySystem>(SYS.inventory).consumeSlot(isInventory, index);
      },
      craftRecipe: (recipeId) => {
        return this.systems.get<InventorySystem>(SYS.inventory).craftRecipe(recipeId);
      },
      selectBuilding: (type) => {
        this.systems.get<BuildSystem>(SYS.build).selectBuildingType(type);
      },
      toggleBuildMode: () => {
        this.systems.get<BuildSystem>(SYS.build).toggleBuildMode();
      },
      respawn: () => {
        this.systems.get<PlayerSystem>(SYS.player).respawnPlayer();
      },
      saveWorld: (notify = true) => {
        return this.systems.get<SaveSystem>(SYS.save).save(notify);
      },
      resetWorld: () => {
        resetRaftWorld(this.systems, this.definition);
      },
    };

    // —— 调试命令块（上线摘除调试时整块删除，见 RaftGameDebugCommands 注释）——
    this.debug = {
      getOceanTuning: () => {
        return this.systems.get<OceanEnvironment>(SYS.ocean).getTuning();
      },
      setOceanTuning: (partial) => {
        this.systems.get<OceanEnvironment>(SYS.ocean).setTuning(partial);
      },
      resetOceanTuning: () => {
        this.systems.get<OceanEnvironment>(SYS.ocean).resetTuning();
      },
      getWeather: () => {
        return this.systems.get<WeatherSystem>(SYS.weather).currentWeather;
      },
      setWeather: (type) => {
        this.systems.get<WeatherSystem>(SYS.weather).setWeather(type);
      },
      setWeatherAuto: (on) => {
        this.systems.get<WeatherSystem>(SYS.weather).setAuto(on);
      },
      getWindDebug: () => {
        return this.systems.get<WindSystem>(SYS.wind).getDebugState();
      },
      setWindAuto: (on) => {
        this.systems.get<WindSystem>(SYS.wind).setAuto(on);
      },
      setManualWind: (dirDeg, speed) => {
        this.systems.get<WindSystem>(SYS.wind).setManualWind(dirDeg, speed);
      },
    };
  }

  public get isPointerLocked(): boolean {
    return this.engine.input.isPointerLocked;
  }

  public set isPointerLocked(value: boolean) {
    this.engine.input.isPointerLocked = value;
  }

  public sampleHud(): RaftHudState {
    const hook = this.systems.get<HookSystem>(SYS.hook);
    const build = this.systems.get<BuildSystem>(SYS.build);
    const shark = this.systems.get<SharkSystem>(SYS.shark);
    return {
      hookState: hook.hookState,
      hookPower: hook.hookPower,
      isBuildMode: build.isBuildMode,
      isDemolishMode: build.isDemolishMode,
      selectedBuilding: build.selectedBuildingType,
      sharkDefeatedOnce: shark.sharkDefeatedOnce,
    };
  }

  public dispose(): void {
    this.engine.dispose();
  }
}

/**
 * Raft 应用组合根：唯一同时认识引擎、具体系统名单、游戏定义和 UI 接线的入口。
 * GameEngine 只接收完整的通用模块，不参与任何具体系统创建。
 */
export function createRaftGame(
  container: HTMLElement,
  definition: RaftGameDefinition = DEFAULT_RAFT_GAME,
): RaftGame {
  const engine = new GameEngine(container, { inputBindings: engineInputBindings() });
  const systems = new SystemRegistry();

  const view: WorldView = {
    scene: engine.scene,
    camera: engine.camera,
    isActionDown: (action) => engine.input.isDown(action),
    isMouseDown: (button) => engine.input.isMouseDown(button),
    isPointerLocked: () => engine.input.isPointerLocked,
    definition,
    player: () => systems.get<PlayerSystem>(SYS.player),
    inventory: () => systems.get<InventorySystem>(SYS.inventory),
    debris: () => systems.get<DebrisSystem>(SYS.debris),
    build: () => systems.get<BuildSystem>(SYS.build),
    hook: () => systems.get<HookSystem>(SYS.hook),
    stations: () => systems.get<StationSystem>(SYS.stations),
    interaction: () => systems.get<InteractionSystem>(SYS.interaction),
    shark: () => systems.get<SharkSystem>(SYS.shark),
    time: () => systems.get<TimeSystem>(SYS.time),
    ocean: () => systems.get<OceanEnvironment>(SYS.ocean),
    weather: () => systems.get<WeatherSystem>(SYS.weather),
    wind: () => systems.get<WindSystem>(SYS.wind),
    saveWorld: (notify = false) => {
      systems.get<SaveSystem>(SYS.save).save(notify);
    },
  };

  createSystems(view, systems);
  bootstrapWorld(view, systems, definition);

  engine.mount({
    systems,
    inputHandler: new RaftInputHandler(view),
  });

  const game = new RaftGame(engine, systems, definition);
  engine.start();
  return game;
}
