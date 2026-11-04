import type {
  BuildingType,
  ItemId,
  MerchantItem,
  WorldSaveData,
} from '../types/game';
import { events } from '../core/events';
import { DEFAULT_WORLD, type WorldDefinition } from '../data/worldDefinition';
import { GameEngine } from './engine/gameEngine';
import { SystemRegistry } from './lifecycle';
import { RaftInputHandler } from './raftInput';
import {
  SYS,
  bootstrapWorld,
  createSystems,
  resetRaftWorld,
} from './systems';
import type { HookState } from './systems/hook';
import type { GameCallbacks, WorldCallbacks } from './ui';
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
  feedCompactorJunk(itemId: ItemId, count: number): boolean;
  forgeCompactorBlock(): boolean;
  buyMerchantItem(item: MerchantItem): boolean;
  saveWorld(notify?: boolean): WorldSaveData;
  resetWorld(): void;
}

/** 已完整组装的 Raft 应用。具体系统知识集中在这个应用门面和组合根。 */
export class RaftGame {
  public readonly commands: RaftGameCommands;

  constructor(
    private engine: GameEngine,
    private systems: SystemRegistry,
    private definition: WorldDefinition,
    private ui: WorldCallbacks,
  ) {
    this.commands = {
      selectHotbarSlot: (index) => {
        this.systems.get(SYS.inventory).setActiveHotbarSlot(index);
      },
      consumeSlot: (isInventory, index) => {
        return this.systems.get(SYS.inventory).consumeSlot(isInventory, index);
      },
      craftRecipe: (recipeId) => {
        return this.systems.get(SYS.inventory).craftRecipe(recipeId);
      },
      selectBuilding: (type) => {
        this.systems.get(SYS.build).selectBuildingType(type);
      },
      toggleBuildMode: () => {
        this.systems.get(SYS.build).toggleBuildMode();
      },
      respawn: () => {
        this.systems.get(SYS.player).respawnPlayer();
      },
      feedCompactorJunk: (itemId, count) => {
        return this.systems.get(SYS.stations).feedCompactorJunk(itemId, count);
      },
      forgeCompactorBlock: () => {
        return this.systems.get(SYS.stations).forgeCompactorBlock();
      },
      buyMerchantItem: (item) => {
        return this.systems.get(SYS.stations).buyMerchantItem(item);
      },
      saveWorld: (notify = true) => {
        return this.systems.get(SYS.save).save(notify);
      },
      resetWorld: () => {
        resetRaftWorld(this.systems, this.definition, this.ui);
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
    const hook = this.systems.get(SYS.hook);
    const build = this.systems.get(SYS.build);
    const shark = this.systems.get(SYS.shark);
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
 * Raft 应用组合根：唯一同时认识引擎、具体系统名单、世界定义和 UI 接线的入口。
 * GameEngine 只接收完整的通用模块，不参与任何具体系统创建。
 */
export function createRaftGame(
  container: HTMLElement,
  callbacks: GameCallbacks,
  definition: WorldDefinition = DEFAULT_WORLD,
): RaftGame {
  const engine = new GameEngine(container);
  const ui: WorldCallbacks = {
    ...callbacks,
    onToast: (text, color) => events.emit('toast', { text, color }),
  };
  const systems = new SystemRegistry();

  const view: WorldView = {
    scene: engine.scene,
    camera: engine.camera,
    isActionDown: (action) => engine.input.isDown(action),
    isPointerLocked: () => engine.input.isPointerLocked,
    definition,
    player: () => systems.get(SYS.player),
    inventory: () => systems.get(SYS.inventory),
    debris: () => systems.get(SYS.debris),
    build: () => systems.get(SYS.build),
    hook: () => systems.get(SYS.hook),
    fishing: () => systems.get(SYS.fishing),
    stations: () => systems.get(SYS.stations),
    interaction: () => systems.get(SYS.interaction),
    shark: () => systems.get(SYS.shark),
    time: () => systems.get(SYS.time),
    islands: () => systems.get(SYS.islands),
    ocean: () => systems.get(SYS.ocean),
    weather: () => systems.get(SYS.weather),
    merchant: () => systems.get(SYS.merchant),
    saveWorld: (notify = false) => {
      systems.get(SYS.save).save(notify);
    },
    toast: (text, color) => ui.onToast(text, color),
    ui,
  };

  createSystems(view, systems);
  bootstrapWorld(view, systems, definition, ui);

  engine.mount({
    systems,
    inputHandler: new RaftInputHandler(view),
  });

  const game = new RaftGame(engine, systems, definition, ui);
  engine.start();
  return game;
}
