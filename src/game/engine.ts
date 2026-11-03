import * as THREE from 'three';
import {
  ResourceId,
  PlayerStats,
  HotbarSlot,
  InventorySlot,
  DebrisObject,
  PlacedStructure,
  SharkData,
  WeatherType,
  WorldSaveData,
} from '../types/game';
import { soundManager } from '../audio/soundManager';
import {
  createDebrisMesh,
  createMerchantRaftMesh,
} from './models';
import { createOceanEnvironment, OceanEnvironment } from './ocean';
import { createWeatherSystem, WeatherSystem } from './weather';
import { createIslandManager, IslandManager, IslandResource } from './islands';
import { FishingSystem } from './fishing';
import { saveWorldLocally, loadWorldLocally, clearWorldLocally } from './storage';
import { SharkSystem } from './shark';
import { InventorySystem } from './inventory';
import { BuildSystem } from './build';
import { PlayerSystem } from './player';
import { HookSystem } from './hook';
import { StationSystem } from './stations';
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

export class RaftEngine {
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

  // Floating Debris
  public debrisList: DebrisObject[] = [];
  private debrisSpawnTimer = 0;
  private nextDebrisId = 1;

  // Hook System (projectile state machine, rope, held FPS tool models)
  public hookSystem: HookSystem;

  // Build Mode state moved to BuildSystem (this.build)

  // Input & Controls
  public keys: Record<string, boolean> = {};
  public isPointerLocked = false;
  private mouseSensitivity = 0.0022;

  // Time & Day Cycle
  public dayTime = 0.25; // 0..1 (0.25 = noon, 0.5 = sunset, 0.75 = midnight)
  public dayCount = 1;
  private dayDurationSeconds = 360; // 6 minutes per full day

  // Raycasting for interactions
  private raycaster = new THREE.Raycaster();
  private aimedInteractable: { structure: PlacedStructure; action: string } | null = null;
  private aimedIslandResource: IslandResource | null = null;
  public aimedMerchant: boolean = false;

  // Signal Array & Navigation Grid State
  // Drifting Merchant Outpost & Dropped Floating Meat
  public merchantRaftGroup: THREE.Group | null = null;

  // Station System (grill/purifier/crop/net/chest/bed/compactor interactions + merchant trades)
  public stations: StationSystem;

  // Animation frame id
  private frameId: number = 0;
  private clock = new THREE.Clock();
  private autoSaveTimer: any = null;
  // UI push throttles (avoid per-frame React re-renders)
  private lastPushedTimeStr: string = '';

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

    // Player System (owns player state & physics; created before systems that
    // reference the shared player object; build/island hooked up lazily)
    this.playerSystem = new PlayerSystem({
      camera: this.camera,
      keys: this.keys,
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
      getIsNight: () => this.dayTime > 0.55 || this.dayTime < 0.05,
      advanceToMorning: () => {
        this.dayTime = 0.15;
        this.dayCount++;
        return this.dayCount;
      },
      getDebrisList: () => this.debrisList,
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
      this.spawnDebris(-55 + Math.random() * 85);
    }

    // Update active equipped tool
    this.hookSystem.updateEquippedTool(this.hotbar[this.activeHotbarIdx]?.itemId ?? null);

    // Bind event listeners
    this.setupEventListeners();

    // Notify initial state to React
    this.callbacks.onStatsChange({ ...this.playerSystem.player.stats });
    this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    this.callbacks.onInventoryChange([...this.inventory]);

    // Start loop
    this.animate = this.animate.bind(this);
    this.frameId = requestAnimationFrame(this.animate);
  }

  // Debris Spawning & Collection
  public spawnDebris(customZ: number | null = null) {
    const types: Array<DebrisObject['type']> = ['wood', 'plastic', 'leaf', 'barrel', 'crate', 'scrap', 'stone'];
    const r = Math.random();
    let type: DebrisObject['type'] = 'wood';
    if (r > 0.88) type = 'barrel';
    else if (r > 0.76) type = 'crate';
    else if (r > 0.58) type = 'leaf';
    else if (r > 0.38) type = 'plastic';
    else if (r > 0.22) type = 'scrap';
    else if (r > 0.12) type = 'stone';

    const mesh = createDebrisMesh(type);
    const x = (Math.random() - 0.5) * 44;
    const z = customZ !== null ? customZ : -65 - Math.random() * 30;
    mesh.position.set(x, 0.05, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(mesh);

    const yields: Partial<Record<ResourceId, number>> = {};
    if (type === 'wood') yields.wood = 1 + Math.floor(Math.random() * 2);
    else if (type === 'plastic') yields.plastic = 1 + Math.floor(Math.random() * 2);
    else if (type === 'leaf') yields.leaf = 1 + Math.floor(Math.random() * 3);
    else if (type === 'barrel') {
      yields.wood = 1 + Math.floor(Math.random() * 2);
      yields.plastic = 1 + Math.floor(Math.random() * 2);
      yields.scrap = 1;
      if (Math.random() > 0.5) yields.raw_potato = 1;
    } else if (type === 'crate') {
      yields.wood = 2;
      yields.rope = 1;
      yields.stone = 1;
    } else if (type === 'scrap') yields.scrap = 1;
    else if (type === 'stone') yields.stone = 1;

    this.debrisList.push({
      id: this.nextDebrisId++,
      mesh,
      type,
      caught: false,
      pos: { x, y: 0.05, z },
      bobPhase: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.7,
      yields,
    });
  }

  // Setup Event Handlers
  private setupEventListeners() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;

      // Inventory shortcut: I or Tab
      if (e.code === 'KeyI') {
        this.callbacks.onToggleInventory?.();
      }

      // Hotbar shortcuts 1-8
      if (e.key >= '1' && e.key <= '8') {
        const slotIdx = parseInt(e.key, 10) - 1;
        this.inventorySystem.setActiveHotbarSlot(slotIdx);
      }

      // Toggle Build Mode: B
      if (e.code === 'KeyB') {
        this.build.toggleBuildMode();
      }

      // Rotate Building Piece: R
      if (e.code === 'KeyR' && this.build.isBuildMode) {
        this.build.rotatePiece();
      }

      // Toggle Demolish Mode: X
      if (e.code === 'KeyX' && this.build.isBuildMode) {
        this.build.toggleDemolishMode();
      }

      // Interact Key: E
      if (e.code === 'KeyE') {
        this.handleInteraction();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'Space') {
        this.playerSystem.releaseSpace();
      }
    });

    window.addEventListener('beforeunload', () => {
      this.saveWorld(false);
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isPointerLocked) return;
      this.playerSystem.player.yaw -= e.movementX * this.mouseSensitivity;
      this.playerSystem.player.pitch -= e.movementY * this.mouseSensitivity;
      const maxPitch = Math.PI / 2 - 0.05;
      this.playerSystem.player.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.playerSystem.player.pitch));
    });

    window.addEventListener('wheel', (e) => {
      if (!this.isPointerLocked) return;
      if (this.build.isBuildMode) {
        // Scroll through building materials!
        e.preventDefault();
        const dir = e.deltaY > 0 ? 1 : -1;
        this.build.cycleBuildingPiece(dir);
      } else {
        if (e.deltaY > 0) {
          this.inventorySystem.setActiveHotbarSlot((this.activeHotbarIdx + 1) % this.hotbar.length);
        } else if (e.deltaY < 0) {
          this.inventorySystem.setActiveHotbarSlot((this.activeHotbarIdx - 1 + this.hotbar.length) % this.hotbar.length);
        }
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (!this.isPointerLocked) return;

      if (e.button === 0) {
        // Left Click Action based on equipped item / mode
        this.handleLeftClickDown();
      } else if (e.button === 2) {
        // Right Click: cancel build mode or ghost
        if (this.build.isBuildMode) {
          this.build.exitBuildMode();
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isPointerLocked) return;
      if (e.button === 0) {
        this.handleLeftClickUp();
      }
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // Unified Smart Structure Interaction (Grill, Purifier, Crop Plot, Collection Net, Chest, Bed, Compactor, Receiver)
  public interactWithStructure(structure: PlacedStructure): boolean {
    return this.stations.interactWithStructure(structure);
  }

  // Interaction Key [E]
  private handleInteraction() {
    // -1. Check Drifting Merchant Outpost Interaction
    if (this.aimedMerchant) {
      this.callbacks.onOpenMerchant?.();
      return;
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
    if (this.aimedMerchant) {
      this.callbacks.onOpenMerchant?.();
      return;
    }

    // 3. Left click on harvestable island resource
    if (this.aimedIslandResource) {
      const res = this.aimedIslandResource;
      const ok = this.islandManager.harvestResource(
        res,
        (id, count) => this.inventorySystem.addItemToInventory(id, count),
        (msg, color) => this.callbacks.onToast(msg, color)
      );
      if (ok) {
        this.aimedIslandResource = null;
        return;
      }
    }

    // 4. Left click on raft structures (Grill, Purifier, Crop Plot, Collection Net, Chest, Compactor, Receiver)
    const targetStructure = this.aimedInteractable?.structure || this.build.getStructureUnderCrosshair();
    if (targetStructure) {
      const handled = this.interactWithStructure(targetStructure);
      if (handled) return;
    }

    // 5. Equipped Tool Actions
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
    } else if (activeSlot?.itemId === 'cup_freshwater') {
      // Drink
      this.playerSystem.player.stats.thirst = Math.min(100, this.playerSystem.player.stats.thirst + 45);
      activeSlot.itemId = 'cup_empty';
      soundManager.playDrink();
      this.callbacks.onToast('Drank pure freshwater! (+45 Thirst)', '#38bdf8');
      this.callbacks.onStatsChange({ ...this.playerSystem.player.stats });
      this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    } else if (activeSlot?.itemId === 'coconut') {
      // Eat Fresh Coconut
      this.playerSystem.player.stats.hunger = Math.min(100, this.playerSystem.player.stats.hunger + 20);
      this.playerSystem.player.stats.thirst = Math.min(100, this.playerSystem.player.stats.thirst + 25);
      this.playerSystem.player.stats.health = Math.min(100, this.playerSystem.player.stats.health + 5);
      activeSlot.count--;
      if (activeSlot.count <= 0) activeSlot.itemId = null;
      soundManager.playEat();
      this.callbacks.onToast('Ate fresh juicy Coconut! (+25 Thirst, +20 Hunger)', '#84cc16');
      this.callbacks.onStatsChange({ ...this.playerSystem.player.stats });
      this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    } else if (
      activeSlot?.itemId === 'cooked_fish' ||
      activeSlot?.itemId === 'cooked_potato' ||
      activeSlot?.itemId === 'cooked_shark_meat' ||
      activeSlot?.itemId === 'shark_meat' ||
      activeSlot?.itemId === 'berry' ||
      activeSlot?.itemId === 'egg'
    ) {
      // Eat Food item
      const id = activeSlot.itemId;
      let hBonus = 25;
      let hpBonus = 5;
      let fName = 'Food';
      if (id === 'cooked_shark_meat') {
        hBonus = 65;
        hpBonus = 30;
        fName = 'Cooked Shark Steak';
      } else if (id === 'shark_meat') {
        hBonus = 25;
        hpBonus = 5;
        fName = 'Raw Shark Meat';
      } else if (id === 'cooked_fish') {
        hBonus = 40;
        hpBonus = 15;
        fName = 'Cooked Fish';
      } else if (id === 'cooked_potato') {
        hBonus = 25;
        hpBonus = 8;
        fName = 'Baked Potato';
      } else if (id === 'berry') {
        hBonus = 18;
        hpBonus = 5;
        fName = 'Wild Berries';
        this.playerSystem.player.stats.thirst = Math.min(100, this.playerSystem.player.stats.thirst + 8);
      } else if (id === 'egg') {
        hBonus = 15;
        hpBonus = 4;
        fName = 'Seagull Egg';
      }

      this.playerSystem.player.stats.hunger = Math.min(100, this.playerSystem.player.stats.hunger + hBonus);
      this.playerSystem.player.stats.health = Math.min(100, this.playerSystem.player.stats.health + hpBonus);
      activeSlot.count--;
      if (activeSlot.count <= 0) activeSlot.itemId = null;
      soundManager.playEat();
      this.callbacks.onToast(`Ate ${fName}! (+${hBonus} Hunger, +${hpBonus} HP)`, '#22c55e');
      this.callbacks.onStatsChange({ ...this.playerSystem.player.stats });
      this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    } else if (activeSlot?.itemId === 'cup_empty' && (this.playerSystem.player.inWater || this.camera.position.y < 3.0)) {
      activeSlot.itemId = 'cup_saltwater';
      soundManager.playWaterSplash(0.9);
      this.callbacks.onToast('Gathered Cup of Ocean Saltwater', '#38bdf8');
      this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    }
  }

  // Left Click Up (Release hook throw, delegated to HookSystem)
  private handleLeftClickUp() {
    this.hookSystem.releaseThrow();
  }

  // Debris Compactor & Merchant trading delegated to StationSystem (this.stations)

  // Update Stations: Boiling Purifiers, Sizzling Grills, Growing Crops, Collection Nets (StationSystem)

  // Update Contextual Raycast Interaction Prompt
  private updateInteractRaycast() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    let foundInteract: { structure: PlacedStructure; action: string } | null = null;
    let promptText: string | null = null;

    // Check structures near player (by distance or raycast)
    const directHit = this.build.getStructureUnderCrosshair();
    const candidateStructures = directHit ? [directHit] : Array.from(this.build.structures.values());

    for (let s of candidateStructures) {
      const dist = this.camera.position.distanceTo(s.mesh.position);
      if (dist < 3.4) {
        if (s.type === 'purifier') {
          if (s.data?.purifierFreshWater) {
            foundInteract = { structure: s, action: 'collect_fresh' };
            const willDrink = this.playerSystem.player.stats.thirst < 95;
            promptText = `[Left-Click / E] ${willDrink ? 'Drink Clean Fresh Water (+Thirst)' : 'Store Clean Water in Cup'}`;
            break;
          } else if (s.data?.purifierSaltWater) {
            promptText = `Purifier Distilling Seawater... (${Math.round(s.data.purifierBoilProgress || 0)}%)`;
            foundInteract = { structure: s, action: 'boiling' };
            break;
          } else {
            foundInteract = { structure: s, action: 'fill_salt' };
            promptText = '[Left-Click / E] Auto-Boil Seawater in Purifier';
            break;
          }
        } else if (s.type === 'grill') {
          if (s.data?.grillDone) {
            foundInteract = { structure: s, action: 'collect_grilled' };
            const willEat = this.playerSystem.player.stats.hunger < 95;
            promptText = `[Left-Click / E] ${willEat ? 'Eat Cooked Food (+Hunger & Health)' : 'Store Cooked Food in Inventory'}`;
            break;
          } else if (s.data?.grillItem) {
            promptText = `Grill Sizzling Food... (${Math.round(s.data.grillProgress || 0)}%)`;
            foundInteract = { structure: s, action: 'grilling' };
            break;
          } else {
            foundInteract = { structure: s, action: 'place_food' };
            promptText = '[Left-Click / E] Auto-Roast Fish or Potato on Grill';
            break;
          }
        } else if (s.type === 'crop_plot') {
          if (s.data?.cropPlanted && (s.data.cropGrowProgress || 0) >= 100) {
            foundInteract = { structure: s, action: 'harvest_crop' };
            promptText = '[Left-Click / E] Harvest Ripe Potatoes';
            break;
          } else if (!s.data?.cropPlanted) {
            foundInteract = { structure: s, action: 'plant_crop' };
            promptText = '[Left-Click / E] Plant Potato in Crop Plot';
            break;
          } else {
            promptText = `Crop Growing... (${Math.round(s.data.cropGrowProgress || 0)}%)`;
            foundInteract = { structure: s, action: 'growing' };
            break;
          }
        } else if (s.type === 'debris_compactor') {
          foundInteract = { structure: s, action: 'compactor' };
          promptText = `[Left-Click / E] Open Debris Compactor (${this.stations.compactorLoadedJunk}/10 Junk Loaded)`;
          break;
        } else if (s.type === 'collection_net' && (s.data?.trappedItems?.length || 0) > 0) {
          foundInteract = { structure: s, action: 'collect_net' };
          promptText = `[Left-Click / E] Collect ${s.data!.trappedItems!.length} Trapped Item(s)`;
          break;
        } else if (s.type === 'chest') {
          foundInteract = { structure: s, action: 'open_chest' };
          promptText = '[Left-Click / E] Open Storage Chest';
          break;
        } else if (s.type === 'bed') {
          foundInteract = { structure: s, action: 'sleep_bed' };
          promptText = '[Left-Click / E] Sleep Until Morning';
          break;
        }
      }
    }

    // Check Drifting Merchant Outpost (Scavenger Economy)
    if (!promptText && this.merchantRaftGroup) {
      const distToMerchant = this.camera.position.distanceTo(this.merchantRaftGroup.position);
      if (distToMerchant < 6.8) {
        this.aimedMerchant = true;
        promptText = '[Left-Click / E] Trade with Drifting Scavenger Merchant';
      } else {
        this.aimedMerchant = false;
      }
    } else {
      this.aimedMerchant = false;
    }

    // Check nearby floating shark meat
    if (!promptText && this.sharkSystem.isNearMeat(this.camera.position)) {
      promptText = 'Walk close or hook to collect Prime Shark Meat!';
    }

    // Check fishing rod state prompt if not aiming at structure
    const activeSlot = this.hotbar[this.activeHotbarIdx];
    if (!promptText && activeSlot?.itemId === 'fishing_rod') {
      if (this.fishingSystem.state === 'IDLE') {
        promptText = '[Left-Click] Cast Fishing Line into Ocean';
      } else if (this.fishingSystem.state === 'WAITING') {
        promptText = 'Waiting for fish... [Left-Click] Reel In';
      } else if (this.fishingSystem.state === 'APPROACHING') {
        promptText = '🐟 Fish approaching bobber! [Get Ready...]';
      } else if (this.fishingSystem.state === 'BITING') {
        promptText = '💥 BITE! CLICK NOW TO REEL IN! 💥';
      } else if (this.fishingSystem.state === 'REELING') {
        promptText = 'Reeling in line...';
      }
    }

    if (!promptText && activeSlot?.itemId === 'cup_empty' && (this.playerSystem.player.inWater || this.camera.position.y < 3.0)) {
      promptText = '[Left-Click / E] Scoop Ocean Saltwater';
    }

    // Check Explorable Island Resources (Coconuts, Driftwood, Loose Stones, Berries, Nests)
    const islandRes = this.islandManager.checkResourceInteract(this.raycaster, this.camera.position);
    if (islandRes) {
      this.aimedIslandResource = islandRes;
      promptText = islandRes.prompt;
    } else {
      this.aimedIslandResource = null;
    }

    this.aimedInteractable = foundInteract;
    this.callbacks.onInteractPrompt(promptText);
  }

  // Survival decay & respawn moved to PlayerSystem (this.playerSystem)

  // Main Loop
  private animate() {
    this.frameId = requestAnimationFrame(this.animate);

    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    // 1. Time of Day & Weather
    this.dayTime = (this.dayTime + dt / this.dayDurationSeconds) % 1.0;
    const hours = Math.floor(this.dayTime * 24);
    const mins = Math.floor(((this.dayTime * 24) % 1) * 60);
    const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    // Only push to UI when the displayed clock string changes (not every frame)
    if (timeStr !== this.lastPushedTimeStr) {
      this.lastPushedTimeStr = timeStr;
      this.callbacks.onTimeChange(this.dayCount, timeStr, this.dayTime);
    }
    this.oceanEnv.updateTimeOfDay(this.dayTime);

    // Dynamic Weather Simulation & Precipitation Particles
    this.weatherSystem.update(dt, this.camera.position, this.dayTime);

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
      debrisList: this.debrisList,
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

    // 5. Update Floating Debris (Slightly increased spawn frequency for active exploration & scavenging)
    this.debrisSpawnTimer += dt;
    if (this.debrisSpawnTimer > 3.4 && this.debrisList.length < 15) {
      this.debrisSpawnTimer = 0;
      this.spawnDebris();
    }

    for (let i = this.debrisList.length - 1; i >= 0; i--) {
      const d = this.debrisList[i];
      if (d.caught) continue;

      d.mesh.position.z += effectiveDrift * dt;
      d.mesh.position.y = Math.sin(elapsed * 2.2 + d.bobPhase) * 0.05 + 0.02;
      d.mesh.rotation.y += d.rotSpeed * dt;

      if (d.mesh.position.z > 58) {
        this.scene.remove(d.mesh);
        this.debrisList.splice(i, 1);
      }
    }


    // 6. Update Survival Decay (thirst/hunger/regen), Meat Drift & Shark
    this.playerSystem.updateSurvival(dt);
    this.sharkSystem.updateMeat(dt, elapsed, effectiveDrift);
    this.sharkSystem.update(dt, elapsed);

    // 7. Update Stations & Interact Raycast
    this.stations.updateStations(dt);
    this.updateInteractRaycast();

    // 8. Update Build Hologram
    this.build.updateBuildHologram();

    // Render Scene
    this.renderer.render(this.scene, this.camera);
  }

  public saveWorld(notify: boolean = true): WorldSaveData {
    const serializedStructures = this.build.serializeStructures();

    const save: WorldSaveData = {
      version: 1,
      worldName: 'Oceanic Raft',
      timestamp: Date.now(),
      dayCount: this.dayCount,
      dayTime: this.dayTime,
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

    if (save.dayCount) this.dayCount = save.dayCount;
    if (save.dayTime !== undefined) this.dayTime = save.dayTime;

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
    this.dayCount = 1;
    this.dayTime = 0.25;
    this.build.createInitialRaft();
    this.playerSystem.respawnPlayer();
    this.callbacks.onToast('🔄 World reset to initial 2x2 starter raft!', '#38bdf8');
  }

  public dispose() {
    this.saveWorld(false);
    if (this.frameId) cancelAnimationFrame(this.frameId);
    if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
    this.build.dispose();
    this.fishingSystem.dispose();
    this.weatherSystem.dispose();
    this.islandManager.dispose();
    this.renderer.dispose();
  }
}
