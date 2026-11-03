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
} from '../types/game';
import { createMerchantRaftMesh } from './models';
import { createOceanEnvironment, OceanEnvironment } from './ocean';
import { createWeatherSystem, WeatherSystem } from './weather';
import { createIslandManager, IslandManager } from './islands';
import { FishingSystem } from './fishing';
import { saveWorldLocally, loadWorldLocally, clearWorldLocally } from './storage';
import { SharkSystem } from './shark';
import { InventorySystem } from './inventory';
import { BuildSystem } from './build';
import { PlayerSystem } from './player';
import { HookSystem } from './hook';
import { StationSystem } from './stations';
import { TimeSystem } from './time';
import { DebrisSystem } from './debris';
import { InteractionSystem } from './interact';
import { GameEngine, EngineDelegate } from './gameEngine';
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

function createWorldState(): WorldState {
  return {
    dayTime: 0.25,
    dayCount: 1,
    debris: [],
    nextDebrisId: 1,
  };
}

/**
 * GameWorld —— 玩法世界：组合根 + 主循环编排 + 输入语义分发 + 存档。
 *
 * 与 GameEngine（gameEngine.ts）的分层：
 * - GameEngine 是基础设施（renderer/scene/循环/原始输入），不认识玩法；
 * - GameWorld 构造并接线所有玩法系统，实现 EngineDelegate 消费引擎：
 *   每帧 tick 顺序、按键到系统动作的映射、存档编排都在这里。
 *
 * 玩法规则与状态归各系统；跨系统共享的可变数据在 WorldState（this.state）；
 * 系统间通知走事件总线 core/events.ts。
 */
export class GameWorld implements EngineDelegate {
  // 引擎基础设施（scene/camera/renderer/循环/原始输入）
  public engine: GameEngine;

  /** 跨系统共享的可变世界状态（时间、漂浮物） */
  public state: WorldState = createWorldState();

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
  private autoSaveTimer: any = null;
  private mouseSensitivity = 0.0022;

  constructor(
    container: HTMLElement,
    callbacks: GameCallbacks
  ) {
    // Toast 统一走事件总线（UI 在 state/uiStore.ts 订阅）。旧调用点继续用
    // this.callbacks.onToast，逐步改为 events.emit('toast', ...)。
    this.callbacks = {
      ...callbacks,
      onToast: (text, color) => events.emit('toast', { text, color }),
    };

    // Engine first: scene/camera/renderer/input bootstrap
    this.engine = new GameEngine(container);
    this.engine.delegate = this;

    const { scene, camera } = this.engine;

    // Input System（keys 状态表先就位，PlayerSystem 构造需要引用它）
    // Player System (owns player state & physics; created before systems that
    // reference the shared player object; build/island hooked up lazily)
    this.playerSystem = new PlayerSystem({
      camera,
      keys: this.engine.input.keys,
      getPointerLocked: () => this.isPointerLocked,
      build: () => this.build,
      getIslandHeight: (x, z) => this.islandManager.getHeightAt(x, z),
      onStatsChange: (stats) => this.callbacks.onStatsChange(stats),
    });

    // Inventory & Crafting System
    this.inventorySystem = new InventorySystem({
      callbacks: {
        onToast: (text, color) => this.callbacks.onToast(text, color),
        onHotbarChange: (hotbar, activeIdx) => this.callbacks.onHotbarChange(hotbar, activeIdx),
        onInventoryChange: (inv) => this.callbacks.onInventoryChange(inv),
        onStatsChange: (stats) => this.callbacks.onStatsChange(stats),
      },
      player: this.playerSystem.player,
      onReadyToBuild: (building) => {
        this.build.enterBuildMode(building);
      },
      onToolSlotChanged: (itemId) => {
        this.hookSystem.updateEquippedTool(this.hotbar[this.activeHotbarIdx]?.itemId ?? null);
        if (itemId === 'hammer') {
          this.build.enterBuildMode();
        } else if (this.build.isBuildMode) {
          this.build.exitBuildMode();
        }
        if (itemId !== 'fishing_rod' && this.fishingSystem && this.fishingSystem.state !== 'IDLE') {
          this.fishingSystem.reset();
        }
      },
    });

    // Ocean & Lighting
    this.oceanEnv = createOceanEnvironment(scene);

    // Dynamic Weather System (Clear, Light Fog, Heavy Rain)
    this.weatherSystem = createWeatherSystem(
      scene,
      this.oceanEnv.sunLight,
      this.oceanEnv.ambientLight,
      this.oceanEnv.hemiLight,
      (newWeather) => {
        this.callbacks.onWeatherChange?.(newWeather);
        if (newWeather === 'LIGHT_FOG') {
          this.callbacks.onToast('🌫️ A thick sea mist rolls across the ocean waters...', '#94a3b8');
        } else if (newWeather === 'HEAVY_RAIN') {
          this.callbacks.onToast('🌧️ A tropical storm strikes! Rough waves and rain!', '#38bdf8');
        } else {
          this.callbacks.onToast('☀️ The skies clear over the open sea.', '#fde047');
        }
      }
    );

    // Explorable Tropical Islands with flora, terrain, palm trees, and harvestables
    this.islandManager = createIslandManager(scene);

    // Drifting Merchant Outpost Barge (Scavenger Economy)
    this.merchantRaftGroup = createMerchantRaftMesh();
    this.merchantRaftGroup.position.set(-26, 0, -22);
    scene.add(this.merchantRaftGroup);

    // Minecraft-Style Fishing System
    this.fishingSystem = new FishingSystem(scene, {
      onToast: (text, color) => this.callbacks.onToast(text, color),
    });

    // Hook & FPS Tool System (projectile state machine, rope, held tool models)
    this.hookSystem = new HookSystem({ scene, camera });

    // Raft Build System: owns structures map, placement/demolition, build mode,
    // hologram, support/collision queries and structure serialization.
    this.build = new BuildSystem({
      scene,
      camera,
      player: this.playerSystem.player,
      inventory: this.inventorySystem,
      onSave: () => this.saveWorld(false),
      getIslandHeight: (x, z) => this.islandManager.getHeightAt(x, z),
    });

    // Time System (owns day duration & morning policy; values live in WorldState)
    this.time = new TimeSystem(this.state, {
      onTimeChange: (day, timeStr, progress) => this.callbacks.onTimeChange(day, timeStr, progress),
    });

    // Debris System (spawn/drift/despawn; list lives in WorldState.debris)
    this.debrisSystem = new DebrisSystem({ scene, world: this.state });

    // Station System: functional raft stations (grill/purifier/crop/net/chest/bed/compactor),
    // their per-frame simulation, and the scavenger economy (compactor forge + merchant trades).
    this.stations = new StationSystem({
      scene,
      build: () => this.build,
      player: () => this.playerSystem,
      inventory: this.inventorySystem,
      onHotbarChange: () => this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx),
      onInventoryChange: () => this.callbacks.onInventoryChange([...this.inventory]),
      onStatsChange: () => this.callbacks.onStatsChange({ ...this.playerSystem.player.stats }),
      onOpenChest: (chest) => this.callbacks.onOpenChest(chest),
      onOpenCompactor: () => this.callbacks.onOpenCompactor?.(),
      getIsNight: () => this.time.isNight,
      advanceToMorning: () => this.time.advanceToMorning(),
      getDebrisList: () => this.state.debris,
    });

    // Shark AI & Combat System (Bruce)
    this.sharkSystem = new SharkSystem({
      scene,
      camera,
      player: this.playerSystem.player,
      structures: this.build.structures,
      raftGroup: this.build.raftGroup,
      callbacks: {
        onToast: (text, color) => this.callbacks.onToast(text, color),
        onSharkAlert: (alerting) => this.callbacks.onSharkAlert(alerting),
        onSharkDataChange: (shark) => this.callbacks.onSharkDataChange?.(shark),
        onStatsChange: (stats) => this.callbacks.onStatsChange(stats),
      },
      addItemToInventory: (id, count) => this.inventorySystem.addItemToInventory(id, count),
      saveWorld: (notify) => this.saveWorld(notify),
      getHookState: () => this.hookSystem.hookState,
      getHookPos: () => this.hookSystem.hookPos,
    });

    // Interaction System (crosshair raycasts & prompts; created last: reads
    // build/stations/shark/fishing)
    this.interaction = new InteractionSystem({
      camera,
      player: this.playerSystem.player,
      build: this.build,
      stations: this.stations,
      fishing: this.fishingSystem,
      shark: this.sharkSystem,
      islands: this.islandManager,
      merchantRaftGroup: this.merchantRaftGroup,
      getActiveItemId: () => this.hotbar[this.activeHotbarIdx]?.itemId ?? null,
      onInteractPrompt: (prompt) => this.callbacks.onInteractPrompt(prompt),
    });

    // Load Saved World or Create Starter Raft
    const savedWorld = loadWorldLocally();
    if (savedWorld && Array.isArray(savedWorld.structures) && savedWorld.structures.length > 0) {
      this.loadWorld(savedWorld);
      this.callbacks.onToast(`📂 World restored from previous save! (Day ${savedWorld.dayCount || 1})`, '#38bdf8');
    } else {
      this.build.createInitialRaft();
    }

    // Auto-save every 12 seconds
    this.autoSaveTimer = setInterval(() => {
      this.saveWorld(false);
    }, 12000);

    // Populate Initial Floating Debris
    for (let i = 0; i < 6; i++) {
      this.debrisSystem.spawn(-55 + Math.random() * 85);
    }

    // Update active equipped tool
    this.hookSystem.updateEquippedTool(this.hotbar[this.activeHotbarIdx]?.itemId ?? null);

    // Window lifecycle listener (gameplay data; engine handles resize)
    window.addEventListener('beforeunload', () => {
      this.saveWorld(false);
    });

    // Notify initial state to React
    this.callbacks.onStatsChange({ ...this.playerSystem.player.stats });
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
    this.playerSystem.player.yaw -= dx * this.mouseSensitivity;
    this.playerSystem.player.pitch -= dy * this.mouseSensitivity;
    const maxPitch = Math.PI / 2 - 0.05;
    this.playerSystem.player.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.playerSystem.player.pitch));
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
    const activeSlot = this.hotbar[this.activeHotbarIdx];

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

    // 5. Equipped Tool Actions (hook/fishing rod/spear need cross-system context)
    if (activeSlot?.itemId === 'hook') {
      this.hookSystem.chargeStart();
      this.hookSystem.reelClick();
    } else if (activeSlot?.itemId === 'fishing_rod') {
      // Minecraft-style Fishing Rod
      if (this.fishingSystem.state === 'IDLE') {
        const rodTip = new THREE.Vector3(0.38, -0.16, -1.2).applyMatrix4(this.engine.camera.matrixWorld);
        const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.engine.camera.quaternion).normalize();
        this.fishingSystem.cast(rodTip, lookDir);
      } else {
        // Reel line in!
        const result = this.fishingSystem.reel(this.playerSystem.player.pos);
        if (result.caught) {
          this.inventorySystem.addItemToInventory(result.item, 1);
          if (activeSlot.durability !== undefined) {
            activeSlot.durability -= 1;
            if (activeSlot.durability <= 0) {
              activeSlot.itemId = null;
              this.callbacks.onToast('Your Fishing Rod broke!', '#ef4444');
            }
            this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
          }
        }
      }
    } else if (activeSlot?.itemId === 'spear') {
      this.sharkSystem.spearThrust(this.hookSystem.toolModel);
    } else if (activeSlot?.itemId === 'cup_empty' && (this.playerSystem.player.inWater || this.engine.camera.position.y < 3.0)) {
      // Scoop saltwater (water-source condition checked here, consumption in inventory)
      this.inventorySystem.fillCupWithSaltwater();
    } else {
      // 6. Food & drink consumption — single unified path (also used by HUD
      // auto-consume; previously there was a duplicated eat/drink block)
      this.inventorySystem.consumeSlot(false, this.activeHotbarIdx);
    }
  }

  // ==================== EngineDelegate: Frame ====================

  /** 每帧玩法 tick（渲染由引擎在 tick 后执行） */
  public onFrame(dt: number, elapsed: number) {
    // 1. Time of Day & Weather
    this.time.update(dt);
    this.oceanEnv.updateTimeOfDay(this.state.dayTime);

    // Dynamic Weather Simulation & Precipitation Particles
    this.weatherSystem.update(dt, this.engine.camera.position, this.state.dayTime);

    // Explorable Island Manager Update
    this.islandManager.update(dt);

    // 2. Waves & Drift (Reacts to weather wind and storm swells)
    const effectiveDrift = 1.9 * this.build.driftSpeedMultiplier;
    this.oceanEnv.updateWaves(
      elapsed,
      effectiveDrift,
      this.weatherSystem.getWaveHeightMultiplier(),
      this.weatherSystem.getWaveSpeedMultiplier(),
      this.weatherSystem.getOceanColor(),
      this.weatherSystem.getOceanRoughness()
    );

    // 3. Player Movement & Physics (PlayerSystem: walking, swimming, gravity, ceiling)
    this.playerSystem.update(dt, elapsed);

    // 4. Hook Mechanics (HookSystem: charging, projectile physics, loot collection)
    this.hookSystem.update(dt, elapsed, {
      effectiveDrift,
      playerPos: this.playerSystem.player.pos,
      activeToolId: this.hotbar[this.activeHotbarIdx]?.itemId ?? null,
      debrisList: this.state.debris,
      addItemToInventory: (id, count) => this.inventorySystem.addItemToInventory(id, count),
    });

    // 4b. Minecraft-style Fishing System Update
    const fishingRodTip = new THREE.Vector3(0.38, -0.16, -1.2).applyMatrix4(this.engine.camera.matrixWorld);
    const waveHMult = this.weatherSystem.getWaveHeightMultiplier();
    const waveSMult = this.weatherSystem.getWaveSpeedMultiplier();
    this.fishingSystem.update(
      dt,
      fishingRodTip,
      this.playerSystem.player.pos,
      elapsed,
      (x, z) => this.oceanEnv.getWaveHeightAt(x, z, elapsed, waveHMult, waveSMult)
    );

    // 5. Floating Debris (spawn cadence, drift, bob, despawn)
    this.debrisSystem.update(dt, elapsed, effectiveDrift);

    // 6. Update Survival Decay (thirst/hunger/regen), Meat Drift & Shark
    this.playerSystem.updateSurvival(dt);
    this.sharkSystem.updateMeat(dt, elapsed, effectiveDrift);
    this.sharkSystem.update(dt, elapsed);

    // 7. Update Stations & Interact Raycast
    this.stations.updateStations(dt);
    this.interaction.update();

    // 8. Update Build Hologram
    this.build.updateBuildHologram();
  }

  // ==================== Save / Load ====================

  public saveWorld(notify: boolean = true): WorldSaveData {
    const serializedStructures = this.build.serializeStructures();

    const save: WorldSaveData = {
      version: 1,
      worldName: 'Oceanic Raft',
      timestamp: Date.now(),
      dayCount: this.state.dayCount,
      dayTime: this.state.dayTime,
      sharkDefeatedOnce: this.sharkSystem.sharkDefeatedOnce,
      structures: serializedStructures,
      player: {
        stats: { ...this.playerSystem.player.stats },
        hotbar: [...this.hotbar],
        inventory: [...this.inventory],
        pos: { x: this.playerSystem.player.pos.x, y: this.playerSystem.player.pos.y, z: this.playerSystem.player.pos.z },
        yaw: this.playerSystem.player.yaw,
        pitch: this.playerSystem.player.pitch,
      },
    };

    saveWorldLocally(save);

    if (notify) {
      this.callbacks.onToast('💾 World saved successfully!', '#10b981');
    }
    return save;
  }

  public loadWorld(save: WorldSaveData): boolean {
    if (!save || !Array.isArray(save.structures)) return false;

    // Clear existing structures and reconstruct all preserving exact IDs
    this.build.loadFrom(save.structures);

    if (save.dayCount) this.state.dayCount = save.dayCount;
    if (save.dayTime !== undefined) this.state.dayTime = save.dayTime;

    if (save.sharkDefeatedOnce !== undefined) {
      this.sharkSystem.setDefeated(save.sharkDefeatedOnce);
    }

    if (save.player) {
      if (save.player.hotbar && Array.isArray(save.player.hotbar)) this.inventorySystem.hotbar = save.player.hotbar;
      if (save.player.inventory && Array.isArray(save.player.inventory)) this.inventorySystem.inventory = save.player.inventory;
      if (save.player.stats) this.playerSystem.player.stats = { ...this.playerSystem.player.stats, ...save.player.stats };
      if (save.player.pos) {
        this.playerSystem.player.pos.set(save.player.pos.x, save.player.pos.y, save.player.pos.z);
      }
      if (save.player.yaw !== undefined) this.playerSystem.player.yaw = save.player.yaw;
      if (save.player.pitch !== undefined) this.playerSystem.player.pitch = save.player.pitch;

      this.callbacks.onStatsChange({ ...this.playerSystem.player.stats });
      this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
      this.callbacks.onInventoryChange([...this.inventory]);
    }

    return true;
  }

  public resetWorld() {
    clearWorldLocally();
    this.build.clearAll();
    this.sharkSystem.reset();
    this.state.dayCount = 1;
    this.state.dayTime = 0.25;
    this.build.createInitialRaft();
    this.playerSystem.respawnPlayer();
    this.callbacks.onToast('🔄 World reset to initial 2x2 starter raft!', '#38bdf8');
  }

  public dispose() {
    this.saveWorld(false);
    this.engine.delegate = null;
    if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
    this.build.dispose();
    this.debrisSystem.dispose();
    this.fishingSystem.dispose();
    this.weatherSystem.dispose();
    this.islandManager.dispose();
    this.engine.dispose();
  }
}
