import type {
  BuildingType,
  WorldSaveData,
} from '../types/game';
import { DEFAULT_RAFT_GAME, type RaftGameDefinition } from '../data/gameDefinition';
import { GameEngine } from './engine/gameEngine';
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
import type { WeatherSystem } from './systems/environment/weather';
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

/** 已完整组装的 Raft 应用。具体系统知识集中在这个应用门面和组合根。 */
export class RaftGame {
  public readonly commands: RaftGameCommands;

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
  const engine = new GameEngine(container);
  const systems = new SystemRegistry();

  const view: WorldView = {
    scene: engine.scene,
    camera: engine.camera,
    isActionDown: (action) => engine.input.isDown(action),
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
