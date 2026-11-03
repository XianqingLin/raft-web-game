import * as THREE from 'three';
import {
  PlayerStats,
  HotbarSlot,
  InventorySlot,
  PlacedStructure,
  SharkData,
  WeatherType,
  WorldSaveData,
} from '../types/game';
import {
  createMerchantRaftMesh,
} from './models';
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
import { InputSystem } from './input';
import { WorldState, createWorldState } from './world';
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
 * engine 内部使用的回调视图：构造函数会用事件总线接管 onToast 并覆盖原值，
 * 因此内部调用点可以安全地把它当必选字段用。
 */
type EngineCallbacks = GameCallbacks & Required<Pick<GameCallbacks, 'onToast'>>;

/**
 * Game —— 组合根与主循环（原 RaftEngine，engine 拆分收尾后更名）。
 *
 * 职责收敛为四件事：
 * 1. 引导：创建 scene/camera/renderer，构造所有系统并接线 context；
 * 2. 主循环 animate()：按固定顺序 tick 各系统；
 * 3. 分发：把 InputSystem 的语义事件路由到对应系统的动作入口；
 * 4. 存档编排：saveWorld / loadWorld / resetWorld / dispose。
 *
 * 玩法规则与状态归各系统；跨系统共享的可变数据在 WorldState；
 * 系统间通知走事件总线 core/events.ts。
 */
export class Game {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  private oceanEnv: OceanEnvironment;
  public weatherSystem: WeatherSystem;
  public islandManager: IslandManager;
  public fishingSystem: FishingSystem;
  public sharkSystem: SharkSystem;
  public inventorySystem: InventorySystem;
  // Inventory arrays live in InventorySystem; getters so existing read/mutate
  // sites keep working during the engine split.
  public get hotbar(): HotbarSlot[] { return this.inventorySystem.hotbar; }
  public get inventory(): InventorySlot[] { return this.inventorySystem.inventory; }
  public get activeHotbarIdx(): number { return this.inventorySystem.activeHotbarIdx; }
  private callbacks: EngineCallbacks;

  // Player System (owns player state, movement physics, survival decay, respawn)
  public playerSystem: PlayerSystem;

  // Raft Build System (owns structures map, build mode, hologram, collision)
  public build: BuildSystem;

  // Hook System (projectile state machine, rope, held FPS tool models)
  public hookSystem: HookSystem;

  // Station System (grill/purifier/crop/net/chest/bed/compactor interactions + merchant trades)
  public stations: StationSystem;

  // Time / Debris / Interaction / Input systems
  public time: TimeSystem;
  public debrisSystem: DebrisSystem;
  public interaction: InteractionSystem;
  public input: InputSystem;

  /** 跨系统共享的可变世界状态（时间、漂浮物） */
  public world: WorldState = createWorldState();

  // 漂流商人筏（场景对象，交互系统近距离判定 + Game 持有）
  public merchantRaftGroup: THREE.Group | null = null;

  // Pointer lock（React 侧 pointerlockchange 时写入；实际门控在 InputSystem）
  public get isPointerLocked(): boolean { return this.input.isPointerLocked; }
  public set isPointerLocked(v: boolean) { this.input.isPointerLocked = v; }

  private frameId: number = 0;
  private clock = new THREE.Clock();
  private autoSaveTimer: any = null;
  private mouseSensitivity = 0.0022;

  constructor(
    container: HTMLElement,
    callbacks: GameCallbacks
  ) {
    // Toast 统一走事件总线（UI 在 state/uiStore.ts 订阅）。旧调用点继续用
    // this.callbacks.onToast，逐系统拆分时改为 events.emit('toast', ...)。
    this.callbacks = {
      ...callbacks,
      onToast: (text, color) => events.emit('toast', { text, color }),
    };

    // Scene
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);

    // Modern Renderer with Soft Shadows
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    // Input System（keys 状态表先就位，PlayerSystem 构造需要引用它）
    this.input = new InputSystem({
      onKeyDown: (code, key) => this.handleKeyDown(code, key),
      onKeyUp: (code) => this.handleKeyUp(code),
      onMouseMove: (dx, dy) => this.handleMouseMove(dx, dy),
      onWheel: (deltaY) => this.handleWheel(deltaY),
      onMouseDown: (button) => this.handleMouseDown(button),
      onMouseUp: (button) => this.handleMouseUp(button),
    });

    // Player System (owns player state & physics; created before systems that
    // reference the shared player object; build/island hooked up lazily)
    this.playerSystem = new PlayerSystem({
      camera: this.camera,
      keys: this.input.keys,
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
    this.oceanEnv = createOceanEnvironment(this.scene);

    // Dynamic Weather System (Clear, Light Fog, Heavy Rain)
    this.weatherSystem = createWeatherSystem(
      this.scene,
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
    this.islandManager = createIslandManager(this.scene);

    // Drifting Merchant Outpost Barge (Scavenger Economy)
    this.merchantRaftGroup = createMerchantRaftMesh();
    this.merchantRaftGroup.position.set(-26, 0, -22);
    this.scene.add(this.merchantRaftGroup);

    // Minecraft-Style Fishing System
    this.fishingSystem = new FishingSystem(this.scene, {
      onToast: (text, color) => this.callbacks.onToast(text, color),
    });

    // Hook & FPS Tool System (projectile state machine, rope, held tool models)
    this.hookSystem = new HookSystem({ scene: this.scene, camera: this.camera });

    // Raft Build System: owns structures map, placement/demolition, build mode,
    // hologram, support/collision queries and structure serialization.
    this.build = new BuildSystem({
      scene: this.scene,
      camera: this.camera,
      player: this.playerSystem.player,
      inventory: this.inventorySystem,
      onSave: () => this.saveWorld(false),
      getIslandHeight: (x, z) => this.islandManager.getHeightAt(x, z),
    });

    // Time System (owns day duration & morning policy; values live in WorldState)
    this.time = new TimeSystem(this.world, {
      onTimeChange: (day, timeStr, progress) => this.callbacks.onTimeChange(day, timeStr, progress),
    });

    // Debris System (spawn/drift/despawn; list lives in WorldState.debris)
    this.debrisSystem = new DebrisSystem({ scene: this.scene, world: this.world });

    // Station System: functional raft stations (grill/purifier/crop/net/chest/bed/compactor),
    // their per-frame simulation, and the scavenger economy (compactor forge + merchant trades).
    this.stations = new StationSystem({
      scene: this.scene,
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
      getDebrisList: () => this.world.debris,
    });

    // Shark AI & Combat System (Bruce)
    this.sharkSystem = new SharkSystem({
      scene: this.scene,
      camera: this.camera,
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
      camera: this.camera,
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

    // Window lifecycle listeners (gameplay input lives in InputSystem)
    window.addEventListener('beforeunload', () => {
      this.saveWorld(false);
    });
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Notify initial state to React
    this.callbacks.onStatsChange({ ...this.playerSystem.player.stats });
    this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    this.callbacks.onInventoryChange([...this.inventory]);

    // Start loop
    this.animate = this.animate.bind(this);
    this.frameId = requestAnimationFrame(this.animate);
  }

  // ==================== Input Dispatch (InputSystem -> systems) ====================

  private handleKeyDown(code: string, key: string) {
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

  private handleKeyUp(code: string) {
    if (code === 'Space') {
      this.playerSystem.releaseSpace();
    }
  }

  private handleMouseMove(dx: number, dy: number) {
    this.playerSystem.player.yaw -= dx * this.mouseSensitivity;
    this.playerSystem.player.pitch -= dy * this.mouseSensitivity;
    const maxPitch = Math.PI / 2 - 0.05;
    this.playerSystem.player.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.playerSystem.player.pitch));
  }

  private handleWheel(deltaY: number): boolean {
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

  private handleMouseDown(button: number) {
    if (button === 0) {
      this.handleLeftClickDown();
    } else if (button === 2) {
      // Right Click: cancel build mode or ghost
      if (this.build.isBuildMode) {
        this.build.exitBuildMode();
      }
    }
  }

  private handleMouseUp(button: number) {
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
        const rodTip = new THREE.Vector3(0.38, -0.16, -1.2).applyMatrix4(this.camera.matrixWorld);
        const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
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
    } else if (activeSlot?.itemId === 'cup_empty' && (this.playerSystem.player.inWater || this.camera.position.y < 3.0)) {
      // Scoop saltwater (water-source condition checked here, consumption in inventory)
      this.inventorySystem.fillCupWithSaltwater();
    } else {
      // 6. Food & drink consumption — single unified path (also used by HUD
      // auto-consume; previously engine had a duplicated eat/drink block)
      this.inventorySystem.consumeSlot(false, this.activeHotbarIdx);
    }
  }

  // ==================== Main Loop ====================

  private animate() {
    this.frameId = requestAnimationFrame(this.animate);

    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    // 1. Time of Day & Weather
    this.time.update(dt);
    this.oceanEnv.updateTimeOfDay(this.world.dayTime);

    // Dynamic Weather Simulation & Precipitation Particles
    this.weatherSystem.update(dt, this.camera.position, this.world.dayTime);

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
      debrisList: this.world.debris,
      addItemToInventory: (id, count) => this.inventorySystem.addItemToInventory(id, count),
    });

    // 4b. Minecraft-style Fishing System Update
    const fishingRodTip = new THREE.Vector3(0.38, -0.16, -1.2).applyMatrix4(this.camera.matrixWorld);
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

    // Render Scene
    this.renderer.render(this.scene, this.camera);
  }

  // ==================== Save / Load ====================

  public saveWorld(notify: boolean = true): WorldSaveData {
    const serializedStructures = this.build.serializeStructures();

    const save: WorldSaveData = {
      version: 1,
      worldName: 'Oceanic Raft',
      timestamp: Date.now(),
      dayCount: this.world.dayCount,
      dayTime: this.world.dayTime,
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

    if (save.dayCount) this.world.dayCount = save.dayCount;
    if (save.dayTime !== undefined) this.world.dayTime = save.dayTime;

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
    this.world.dayCount = 1;
    this.world.dayTime = 0.25;
    this.build.createInitialRaft();
    this.playerSystem.respawnPlayer();
    this.callbacks.onToast('🔄 World reset to initial 2x2 starter raft!', '#38bdf8');
  }

  public dispose() {
    this.saveWorld(false);
    if (this.frameId) cancelAnimationFrame(this.frameId);
    if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
    this.input.dispose();
    this.build.dispose();
    this.debrisSystem.dispose();
    this.fishingSystem.dispose();
    this.weatherSystem.dispose();
    this.islandManager.dispose();
    this.renderer.dispose();
  }
}
