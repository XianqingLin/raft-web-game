import * as THREE from 'three';
import {
  DebrisObject,
  PlayerStats,
  HotbarSlot,
  InventorySlot,
  PlacedStructure,
  SharkData,
  WeatherType,
  WorldSaveData,
  ToolActionKind,
} from '../types/game';
import { createMerchantRaftMesh } from './visuals/models';
import { ITEM_DEFINITIONS } from '../data/itemsAndRecipes';
import { WorldDefinition, DEFAULT_WORLD } from '../data/worldDefinition';
import { createOceanEnvironment, OceanEnvironment, OCEAN_DRIFT_BASE } from './environment/ocean';
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
 * 跨系统共享的可变世界状态（纯数据）。
 *
 * 设计约束：
 * - 只放跨系统共享的可变状态，不放服务/回调（引用走各系统 context），
 *   避免它变成新的 god object。
 * - 数据与行为分离：它是未来网络同步/存档扩展的天然快照边界
 *   （多人友好设计约束之一，见 docs/FEATURES_OFF.md §3）。
 */
export interface WorldState {
  /** 一天中的时间 0..1（0.25 = 正午，0.5 = 日落，0.75 = 午夜） */
  dayTime: number;
  /** 存活天数 */
  dayCount: number;
  /** 漂浮物列表（由 DebrisSystem 维护；hook/stations 通过它捕捞） */
  debris: DebrisObject[];
  /** 漂浮物自增 id（DebrisSystem 生成时使用） */
  nextDebrisId: number;
}

function createWorldState(start: WorldDefinition['start']): WorldState {
  return {
    dayTime: start.dayTime,
    dayCount: start.dayCount,
    debris: [],
    nextDebrisId: 1,
  };
}

/**
 * GameWorld —— 玩法世界：组合根 + 主循环编排 + 输入语义分发。
 *
 * 与 GameEngine（gameEngine.ts）的分层：
 * - GameEngine 是基础设施（renderer/scene/循环/原始输入），不认识玩法；
 * - GameWorld 构造并接线所有玩法系统，实现 EngineDelegate 消费引擎：
 *   每帧 tick 顺序、按键到系统动作的映射都在这里。
 *
 * 场景内容（商人筏位置、开局漂浮物等）来自 WorldDefinition（data 层），
 * 本类不硬编码；存档持久化归 SaveSystem。
 * 玩法规则与状态归各系统；跨系统共享的可变数据在 WorldState（this.state）；
 * 系统间通知走事件总线 core/events.ts。
 */
export class GameWorld implements EngineDelegate {
  // 引擎基础设施（scene/camera/renderer/循环/原始输入）
  public engine: GameEngine;

  /** 跨系统共享的可变世界状态（时间、漂浮物） */
  public state: WorldState;

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

  // 漂流商人筏（场景对象，交互系统近距离判定 + GameWorld 持有）
  public merchantRaftGroup: THREE.Group | null = null;

  private oceanEnv: OceanEnvironment;
  private callbacks: WorldCallbacks;
  /** 本世界的场景内容定义（默认 DEFAULT_WORLD，可传入变体） */
  private definition: WorldDefinition;
  /** 工具主动作 → 系统调用的执行表（物品→动作的映射在 data/itemsAndRecipes.ts） */
  private toolActions: Record<ToolActionKind, () => void>;

  /** 每帧 tick 注册表（顺序即执行顺序，见 lifecycle.ts 的两层生命周期约定） */
  private tickers: Tickable[] = [];

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

    // World state seeded from the definition (time, floating debris, ids)
    this.state = createWorldState(definition.start);

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
      state: this.state,
      definition: this.definition,
      player: () => this.playerSystem,
      inventory: () => this.inventorySystem,
      build: () => this.build,
      hook: () => this.hookSystem,
      fishing: () => this.fishingSystem,
      stations: () => this.stations,
      shark: () => this.sharkSystem,
      time: () => this.time,
      islands: () => this.islandManager,
      ocean: () => this.oceanEnv,
      merchantRaft: () => this.merchantRaftGroup!,
      saveWorld: (notify = false) => {
        this.saveWorld(notify);
      },
      toast: (text, color) => this.callbacks.onToast(text, color),
      ui: this.callbacks,
    };

    // Systems: one create per system — wiring lives in each system's factory.
    // Order matters: a factory may only call getters of already-created systems.
    this.playerSystem = createPlayerSystem(w);
    this.inventorySystem = createInventorySystem(w);
    this.oceanEnv = createOceanEnvironment(scene);
    this.weatherSystem = createWeather(w, this.oceanEnv);
    this.islandManager = createIslandManager(scene);

    // Drifting Merchant Outpost Barge (Scavenger Economy)
    this.merchantRaftGroup = createMerchantRaftMesh();
    this.merchantRaftGroup.position.set(...definition.merchant.position);
    scene.add(this.merchantRaftGroup);

    // Minecraft-Style Fishing System
    this.fishingSystem = createFishingSystem(w);

    // Hook & FPS Tool System
    this.hookSystem = createHookSystem(w);

    // Raft Build System
    this.build = createBuildSystem(w);

    // Time System
    this.time = createTimeSystem(w);

    // Debris System
    this.debrisSystem = createDebrisSystem(w);

    // Station System
    this.stations = createStationSystem(w);

    // Shark AI & Combat System (Bruce)
    this.sharkSystem = createSharkSystem(w);

    // Interaction System (crosshair raycasts & prompts; reads many systems)
    this.interaction = createInteractionSystem(w);

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
    this.callbacks.onStatsChange({ ...this.playerSystem.player.stats });
    this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    this.callbacks.onInventoryChange([...this.inventory]);

    // Frame tick order — the declarative replacement for a handwritten
    // onFrame. Later tickers may read earlier tickers' output (time pushes
    // dayTime → ocean/weather consume it); cross-system data flow inside a
    // single step lives in the closure below (composition root's job).
    this.registerTickers();

    // All systems wired: start the engine loop
    this.engine.start();
  }

  /** 洋流有效漂移速度（基础漂移 × 建筑加成；hook/debris/shark 共用） */
  private getEffectiveDrift(): number {
    return OCEAN_DRIFT_BASE * this.build.driftSpeedMultiplier;
  }

  /** 组合根的帧顺序声明：一个系统一个条目，条目内闭包只做接线 */
  private registerTickers() {
    this.tickers.push(
      { name: 'time', tick: (dt) => this.time.update(dt) },
      { name: 'weather', tick: (dt) => this.weatherSystem.update(dt, this.engine.camera.position, this.state.dayTime) },
      {
        name: 'ocean',
        tick: (_dt, elapsed) => {
          this.oceanEnv.updateTimeOfDay(this.state.dayTime);
          this.oceanEnv.updateWaves(
            elapsed,
            this.getEffectiveDrift(),
            this.weatherSystem.getWaveHeightMultiplier(),
            this.weatherSystem.getWaveSpeedMultiplier(),
            this.weatherSystem.getOceanColor(),
            this.weatherSystem.getOceanRoughness()
          );
        },
      },
      { name: 'islands', tick: (dt) => this.islandManager.update(dt) },
      { name: 'player.movement', tick: (dt, elapsed) => this.playerSystem.update(dt, elapsed) },
      {
        name: 'hook',
        tick: (dt, elapsed) =>
          this.hookSystem.update(dt, elapsed, {
            effectiveDrift: this.getEffectiveDrift(),
            playerPos: this.playerSystem.player.pos,
            activeToolAction: this.getActivePrimaryAction() ?? null,
            debrisList: this.state.debris,
            addItemToInventory: (id, count) => this.inventorySystem.addItemToInventory(id, count),
          }),
      },
      {
        name: 'fishing',
        tick: (dt, elapsed) => {
          const waveHMult = this.weatherSystem.getWaveHeightMultiplier();
          const waveSMult = this.weatherSystem.getWaveSpeedMultiplier();
          this.fishingSystem.update(
            dt,
            this.playerSystem.player.pos,
            elapsed,
            (x, z) => this.oceanEnv.getWaveHeightAt(x, z, elapsed, waveHMult, waveSMult)
          );
        },
      },
      { name: 'debris', tick: (dt, elapsed) => this.debrisSystem.update(dt, elapsed, this.getEffectiveDrift()) },
      { name: 'player.survival', tick: (dt) => this.playerSystem.updateSurvival(dt) },
      { name: 'shark.meat', tick: (dt, elapsed) => this.sharkSystem.updateMeat(dt, elapsed, this.getEffectiveDrift()) },
      { name: 'shark', tick: (dt, elapsed) => this.sharkSystem.update(dt, elapsed) },
      { name: 'stations', tick: (dt) => this.stations.updateStations(dt) },
      { name: 'interaction', tick: () => this.interaction.update() },
      { name: 'build.hologram', tick: () => this.build.updateBuildHologram() },
    );
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

  /** 每帧玩法 tick（渲染由引擎在 tick 后执行）：按注册表顺序执行 */
  public onFrame(dt: number, elapsed: number) {
    for (const t of this.tickers) {
      t.tick(dt, elapsed);
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
    this.state.dayCount = this.definition.start.dayCount;
    this.state.dayTime = this.definition.start.dayTime;
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
