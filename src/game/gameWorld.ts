import {
  PlayerStats,
  HotbarSlot,
  InventorySlot,
  PlacedStructure,
  WeatherType,
  WorldSaveData,
  ToolActionKind,
} from '../types/game';
import { SharkData } from './entities/shark';
import { ITEM_DEFINITIONS } from '../data/items';
import { WorldDefinition, DEFAULT_WORLD } from '../data/worldDefinition';
import { createOceanEnvironment, OceanEnvironment } from './environment/ocean';
import { WeatherSystem, createWeather } from './environment/weather';
import { createIslandManager, IslandManager } from './environment/islands';
import { FishingSystem, createFishingSystem } from './systems/fishing';
import { SaveSystem, createSaveSystem } from './systems/save';
import { SharkSystem, createSharkSystem } from './systems/shark';
import { InventorySystem, createInventorySystem } from './systems/inventory';
import { BuildSystem, createBuildSystem } from './systems/build';
import { PlayerSystem, createPlayerSystem } from './systems/player';
import { HookSystem, createHookSystem } from './systems/hook';
import { StationSystem, createStationSystem } from './systems/stations';
import { TimeSystem, createTimeSystem } from './systems/time';
import { DebrisSystem, createDebrisSystem } from './systems/debris';
import { InteractionSystem, createInteractionSystem } from './systems/interact';
import { MerchantSystem, createMerchantSystem } from './systems/merchant';
import { GameEngine, EngineDelegate } from './engine/gameEngine';
import { WorldView } from './worldView';
import { Tickable } from './lifecycle';
import { events } from '../core/events';

export interface GameCallbacks {
  onStatsChange: (stats: PlayerStats) => void;
  onHotbarChange: (hotbar: HotbarSlot[], activeIdx: number) => void;
  onInventoryChange: (inventory: InventorySlot[]) => void;
  /** @deprecated 已迁至事件总线 core/events.ts 的 `toast` 事件。内部调用点在
   *  各系统拆分时逐一改为 events.emit('toast', ...)，拆完删除本字段。 */
  onToast?: (text: string, color?: string) => void;
  onInteractPrompt: (prompt: string | null) => void;
  onSharkAlert: (alerting: boolean) => void;
  onSharkDataChange?: (shark: SharkData) => void;
  onOpenChest: (chest: PlacedStructure | null) => void;
  onTimeChange: (day: number, timeStr: string, progress: number) => void;
  onWeatherChange?: (weather: WeatherType) => void;
  onToggleInventory?: () => void;
  onOpenCompactor?: () => void;
  onOpenMerchant?: () => void;
}

/**
 * GameWorld 内部使用的回调视图：构造函数会用事件总线接管 onToast 并覆盖
 * 原值，因此内部调用点可以安全地把它当必选字段用。
 */
type WorldCallbacks = GameCallbacks & Required<Pick<GameCallbacks, 'onToast'>>;

/**
 * GameWorld —— 玩法世界：组合根 + 主循环编排 + 输入语义分发。
 *
 * 与 GameEngine（gameEngine.ts）的分层：
 * - GameEngine 是基础设施（renderer/scene/循环/原始输入），不认识玩法；
 * - GameWorld 构造并接线所有玩法系统，实现 EngineDelegate 消费引擎：
 *   每帧 tick 顺序、按键到系统动作的映射都在这里。
 *
 * 场景内容（商人筏、鲨鱼、玩家出生点、开局漂浮物等）来自 WorldDefinition
 * （data 层），本类不硬编码；存档持久化归 SaveSystem。
 * 玩法规则与状态归各系统：时间归 TimeSystem、漂浮物集合归 DebrisSystem、
 * 各实体归各自的管理器（entity-manager 模式，见 lifecycle.ts）；
 * 系统间通知走事件总线 core/events.ts。
 */
export class GameWorld implements EngineDelegate {
  // 引擎基础设施（scene/camera/renderer/循环/原始输入）
  public engine: GameEngine;

  // 玩法系统
  public playerSystem: PlayerSystem;
  public inventorySystem: InventorySystem;
  public build: BuildSystem;
  public hookSystem: HookSystem;
  public stations: StationSystem;
  public sharkSystem: SharkSystem;
  public time: TimeSystem;
  public debrisSystem: DebrisSystem;
  public interaction: InteractionSystem;
  public weatherSystem: WeatherSystem;
  public islandManager: IslandManager;
  public merchantSystem: MerchantSystem;
  public fishingSystem: FishingSystem;
  public saveSystem: SaveSystem;

  // Inventory arrays live in InventorySystem; getters so existing read/mutate
  // sites keep working.
  public get hotbar(): HotbarSlot[] { return this.inventorySystem.hotbar; }
  public get inventory(): InventorySlot[] { return this.inventorySystem.inventory; }
  public get activeHotbarIdx(): number { return this.inventorySystem.activeHotbarIdx; }

  // Pointer lock（React 侧 pointerlockchange 时写入；实际门控在 engine.input）
  public get isPointerLocked(): boolean { return this.engine.input.isPointerLocked; }
  public set isPointerLocked(v: boolean) { this.engine.input.isPointerLocked = v; }

  private oceanEnv: OceanEnvironment;
  private callbacks: WorldCallbacks;
  /** 本世界的场景内容定义（默认 DEFAULT_WORLD，可传入变体） */
  private definition: WorldDefinition;
  /** 工具主动作 → 系统调用的执行表（物品→动作的映射在 data/itemsAndRecipes.ts） */
  private toolActions: Record<ToolActionKind, () => void>;

  /** 每帧 tick 注册表：创建顺序即 tick 顺序（见 lifecycle.ts） */
  private tickers: Tickable[] = [];

  /** 登记一个每帧 tick 的系统（在创建处紧跟调用） */
  private register(t: Tickable) {
    this.tickers.push(t);
  }

  constructor(
    container: HTMLElement,
    callbacks: GameCallbacks,
    definition: WorldDefinition = DEFAULT_WORLD
  ) {
    this.definition = definition;

    // Toast 统一走事件总线（UI 在 state/uiStore.ts 订阅）。旧调用点继续用
    // this.callbacks.onToast，逐步改为 events.emit('toast', ...)。
    this.callbacks = {
      ...callbacks,
      onToast: (text, color) => events.emit('toast', { text, color }),
    };

    // Engine first: scene/camera/renderer/input bootstrap
    this.engine = new GameEngine(container);
    this.engine.delegate = this;

    const { scene } = this.engine;

    // World view: the one handle factories use to pull dependencies. System
    // getters are lazy — availability is guaranteed by factory call order.
    const w: WorldView = {
      scene,
      camera: this.engine.camera,
      keys: this.engine.input.keys,
      isPointerLocked: () => this.isPointerLocked,
      definition: this.definition,
      player: () => this.playerSystem,
      inventory: () => this.inventorySystem,
      debris: () => this.debrisSystem,
      build: () => this.build,
      hook: () => this.hookSystem,
      fishing: () => this.fishingSystem,
      stations: () => this.stations,
      shark: () => this.sharkSystem,
      time: () => this.time,
      islands: () => this.islandManager,
      ocean: () => this.oceanEnv,
      weather: () => this.weatherSystem,
      merchant: () => this.merchantSystem,
      saveWorld: (notify = false) => {
        this.saveWorld(notify);
      },
      toast: (text, color) => this.callbacks.onToast(text, color),
      ui: this.callbacks,
    };

    // Systems: one create per system — wiring lives in each system's factory.
    // 创建顺序即 tick 顺序（见 lifecycle.ts）：每个有每帧行为的系统创建后
    // 紧跟一行 register()，没有第二份顺序清单要维护。工厂只能引用已创建
    // 系统的 getter（惰性 getter 在 tick 期才求值的除外）。
    // Time 最先：后续系统的 tick 都读 time.dayTime。
    this.time = createTimeSystem(w);
    this.register(this.time);

    this.playerSystem = createPlayerSystem(w);
    this.register(this.playerSystem);

    this.inventorySystem = createInventorySystem(w);

    // Ocean 在 weather 之前：weather 的灯光由 ocean 创建（创建期依赖），
    // 因此 ocean 的 tick 也略先于 weather——波形参数消费上一帧的天气值；
    // 这些参数本身以秒级速度插值，一帧滞后不可感知。
    this.oceanEnv = createOceanEnvironment(w);
    this.register(this.oceanEnv);
    this.weatherSystem = createWeather(w, this.oceanEnv);
    this.register(this.weatherSystem);

    this.islandManager = createIslandManager(scene);
    this.register(this.islandManager);

    // Drifting Merchant Outpost Barge (Scavenger Economy) — count/position from definition
    // 静态场景实体，无每帧行为，不进 tick 注册表
    this.merchantSystem = createMerchantSystem(w);

    // Minecraft-Style Fishing System
    this.fishingSystem = createFishingSystem(w);
    this.register(this.fishingSystem);

    // Hook & FPS Tool System
    this.hookSystem = createHookSystem(w);
    this.register(this.hookSystem);

    // Raft Build System
    this.build = createBuildSystem(w);
    this.register(this.build);

    // Debris System
    this.debrisSystem = createDebrisSystem(w);
    this.register(this.debrisSystem);

    // Station System
    this.stations = createStationSystem(w);
    this.register(this.stations);

    // Shark AI & Combat System (Bruce)
    this.sharkSystem = createSharkSystem(w);
    this.register(this.sharkSystem);

    // Interaction System (crosshair raycasts & prompts; reads many systems)
    this.interaction = createInteractionSystem(w);
    this.register(this.interaction);

    // Tool action dispatch: which item maps to which action lives in item
    // definitions (data layer); the world only wires actions to systems here.
    this.toolActions = {
      throw_hook: () => {
        this.hookSystem.chargeStart();
        this.hookSystem.reelClick();
      },
      cast_fishing_rod: () => this.fishingSystem.onPrimaryAction(),
      spear_thrust: () => this.sharkSystem.spearThrust(this.hookSystem.toolModel),
      scoop_saltwater: () => {
        // Water-source condition in PlayerSystem, consumption in inventory
        if (this.playerSystem.canScoopSaltwater()) {
          this.inventorySystem.fillCupWithSaltwater();
        }
      },
    };

    // Save System (starts auto-save cadence & beforeunload listener itself)
    this.saveSystem = createSaveSystem(w);

    // Load Saved World or Create Starter Raft
    const savedWorld = this.saveSystem.loadLatest();
    if (savedWorld) {
      this.saveSystem.load(savedWorld);
      this.callbacks.onToast(`📂 World restored from previous save! (Day ${savedWorld.dayCount || 1})`, '#38bdf8');
    } else {
      this.build.createInitialRaft();
    }

    // Populate Initial Floating Debris
    const [debrisMinX, debrisMaxX] = definition.initialDebris.xRange;
    for (let i = 0; i < definition.initialDebris.count; i++) {
      this.debrisSystem.spawn(debrisMinX + Math.random() * (debrisMaxX - debrisMinX));
    }

    // Update active equipped tool
    this.hookSystem.updateEquippedTool(this.hotbar[this.activeHotbarIdx]?.itemId ?? null);

    // Notify initial state to React
    this.callbacks.onStatsChange({ ...this.playerSystem.localPlayer.stats });
    this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    this.callbacks.onInventoryChange([...this.inventory]);

    // All systems wired: start the engine loop
    this.engine.start();
  }

  // ==================== EngineDelegate: Input Dispatch -> systems ====================

  public onKeyDown(code: string, key: string) {
    // Inventory shortcut: I
    if (code === 'KeyI') {
      this.callbacks.onToggleInventory?.();
    }

    // Hotbar shortcuts 1-8
    if (key >= '1' && key <= '8') {
      const slotIdx = parseInt(key, 10) - 1;
      this.inventorySystem.setActiveHotbarSlot(slotIdx);
    }

    // Toggle Build Mode: B
    if (code === 'KeyB') {
      this.build.toggleBuildMode();
    }

    // Rotate Building Piece: R
    if (code === 'KeyR' && this.build.isBuildMode) {
      this.build.rotatePiece();
    }

    // Toggle Demolish Mode: X
    if (code === 'KeyX' && this.build.isBuildMode) {
      this.build.toggleDemolishMode();
    }

    // Interact Key: E
    if (code === 'KeyE') {
      this.handleInteraction();
    }
  }

  public onKeyUp(code: string) {
    if (code === 'Space') {
      this.playerSystem.releaseSpace();
    }
  }

  public onMouseMove(dx: number, dy: number) {
    this.playerSystem.applyLookDelta(dx, dy);
  }

  public onWheel(deltaY: number): boolean {
    if (this.build.isBuildMode) {
      // Scroll through building materials!
      this.build.cycleBuildingPiece(deltaY > 0 ? 1 : -1);
      return true;
    }
    if (deltaY > 0) {
      this.inventorySystem.setActiveHotbarSlot((this.activeHotbarIdx + 1) % this.hotbar.length);
    } else if (deltaY < 0) {
      this.inventorySystem.setActiveHotbarSlot((this.activeHotbarIdx - 1 + this.hotbar.length) % this.hotbar.length);
    }
    return false;
  }

  public onMouseDown(button: number) {
    if (button === 0) {
      this.handleLeftClickDown();
    } else if (button === 2) {
      // Right Click: cancel build mode or ghost
      if (this.build.isBuildMode) {
        this.build.exitBuildMode();
      }
    }
  }

  public onMouseUp(button: number) {
    if (button === 0) {
      this.hookSystem.releaseThrow();
    }
  }

  // Interaction Key [E]
  private handleInteraction() {
    // Check Drifting Merchant Outpost Interaction
    if (this.interaction.aimedMerchant) {
      this.callbacks.onOpenMerchant?.();
    }
  }

  // Left Click Down
  private handleLeftClickDown() {
    // 1. Build Mode: Place piece or Demolish
    if (this.build.isBuildMode) {
      this.build.tryPlace();
      return;
    }

    // 2. Check Merchant interaction
    if (this.interaction.aimedMerchant) {
      this.callbacks.onOpenMerchant?.();
      return;
    }

    // 3. Left click on harvestable island resource
    if (this.interaction.aimedIslandResource) {
      const res = this.interaction.aimedIslandResource;
      const ok = this.islandManager.harvestResource(
        res,
        (id, count) => this.inventorySystem.addItemToInventory(id, count),
        (msg, color) => this.callbacks.onToast(msg, color)
      );
      if (ok) {
        this.interaction.clearIslandAim();
        return;
      }
    }

    // 4. Left click on raft structures (Grill, Purifier, Crop Plot, Collection Net, Chest, Compactor, Receiver)
    const targetStructure = this.interaction.aimedInteractable?.structure || this.build.getStructureUnderCrosshair();
    if (targetStructure) {
      const handled = this.stations.interactWithStructure(targetStructure);
      if (handled) return;
    }

    // 5. Equipped tool primary action — the item→action mapping lives in item
    // definitions (data layer); add a new tool by tagging primaryAction there.
    const action = this.getActivePrimaryAction();
    if (action) {
      this.toolActions[action]();
      return;
    }

    // 6. Food & drink consumption — single unified path (also used by HUD
    // auto-consume; previously there was a duplicated eat/drink block)
    this.inventorySystem.consumeSlot(false, this.activeHotbarIdx);
  }

  /** 当前手持物品的主动作（来自物品定义；无主动作的工具/资源返回 undefined） */
  private getActivePrimaryAction(): ToolActionKind | undefined {
    const id = this.hotbar[this.activeHotbarIdx]?.itemId;
    return id ? ITEM_DEFINITIONS[id]?.primaryAction : undefined;
  }

  // ==================== EngineDelegate: Frame ====================

  /** 每帧玩法 tick（渲染由引擎在 tick 后执行）：按注册顺序执行 */
  public onFrame(dt: number, elapsed: number) {
    for (const t of this.tickers) {
      t.update(dt, elapsed);
    }
  }

  // ==================== Save / Load（持久化在 SaveSystem，这里只留世界级决策） ====================

  public saveWorld(notify: boolean = true): WorldSaveData {
    return this.saveSystem.save(notify);
  }

  public resetWorld() {
    this.saveSystem.clear();
    this.build.clearAll();
    this.sharkSystem.reset();
    this.time.resetTo(this.definition.start);
    this.build.createInitialRaft();
    this.playerSystem.respawnPlayer();
    this.callbacks.onToast('🔄 World reset to initial 2x2 starter raft!', '#38bdf8');
  }

  public dispose() {
    this.saveSystem.dispose();
    this.engine.delegate = null;
    this.build.dispose();
    this.debrisSystem.dispose();
    this.fishingSystem.dispose();
    this.weatherSystem.dispose();
    this.islandManager.dispose();
    this.engine.dispose();
  }
}
