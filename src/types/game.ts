export type WeatherType = 'CLEAR' | 'LIGHT_FOG' | 'HEAVY_RAIN';

export type ResourceId =
  | 'wood'
  | 'plastic'
  | 'leaf'
  | 'rope'
  | 'scrap'
  | 'stone'
  | 'coconut'
  | 'raw_fish'
  | 'cooked_fish'
  | 'raw_potato'
  | 'cooked_potato'
  | 'cup_empty'
  | 'cup_saltwater'
  | 'cup_freshwater'
  | 'metal_ingot'
  | 'bolt'
  | 'shark_bait'
  | 'shark_meat'
  | 'cooked_shark_meat'
  | 'salvaged_scrap_block'
  | 'power_cell'
  | 'locator_node'
  | 'ironwood'
  | 'titanium_ingot'
  | 'berry'
  | 'feather'
  | 'egg';

export type ToolId =
  | 'hook'
  | 'hammer'
  | 'spear'
  | 'fishing_rod'
  | 'metal_spear'
  | 'reinforced_hook';

export type ItemId = ResourceId | ToolId;

export type BuildingType =
  | 'foundation'
  | 'collection_net'
  | 'tri_foundation'
  | 'wall'
  | 'window_wall'
  | 'pillar'
  | 'floor'
  | 'stairs'
  | 'fence'
  | 'purifier'
  | 'grill'
  | 'crop_plot'
  | 'chest'
  | 'sail'
  | 'bed'
  | 'crafting_table'
  | 'debris_compactor'
  | 'signal_receiver'
  | 'locator_antenna';

export interface ItemDef {
  id: ItemId;
  name: string;
  category: 'resources' | 'tools' | 'food' | 'water';
  color: string;
  icon: string;
  description: string;
  stackSize: number;
  durabilityMax?: number;
}

export interface CraftingRecipe {
  id: string;
  targetItem?: ItemId;
  targetBuilding?: BuildingType;
  name: string;
  category: 'tools' | 'survival' | 'building' | 'food_water';
  cost: Partial<Record<ResourceId, number>>;
  description: string;
  unlockedByDefault: boolean;
  yieldCount?: number;
  requiresWorkbench?: boolean;
}

export interface PlayerStats {
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
  thirst: number;
  maxThirst: number;
  isDead: boolean;
}

export interface HotbarSlot {
  itemId: ItemId | null;
  count: number;
  durability?: number;
}

export interface InventorySlot {
  itemId: ItemId | null;
  count: number;
  durability?: number;
}

export interface DebrisObject {
  id: number;
  mesh: any; // THREE.Group
  type: 'wood' | 'plastic' | 'leaf' | 'barrel' | 'crate' | 'stone' | 'scrap';
  caught: boolean;
  pos: { x: number; y: number; z: number };
  bobPhase: number;
  rotSpeed: number;
  yields: Partial<Record<ResourceId, number>>;
}

export interface PlacedStructure {
  id: string;
  type: BuildingType;
  gx: number;
  gy: number;
  gz: number;
  rotation: number; // 0, 1, 2, 3 (* 90 deg)
  health: number;
  maxHealth: number;
  mesh: any; // THREE.Group
  data?: {
    purifierSaltWater?: boolean;
    purifierFreshWater?: boolean;
    purifierBoilProgress?: number;
    grillItem?: 'raw_fish' | 'raw_potato' | 'shark_meat' | null;
    grillProgress?: number;
    grillDone?: boolean;
    cropPlanted?: boolean;
    cropGrowProgress?: number;
    trappedItems?: ResourceId[];
    chestItems?: InventorySlot[];
  };
}

export type SharkState = 'CIRCLING' | 'STALKING_PLAYER' | 'ATTACKING_RAFT' | 'ATTACKING_PLAYER' | 'FLEEING';

export interface SharkData {
  health: number;
  maxHealth: number;
  state: SharkState;
  pos: { x: number; y: number; z: number };
  targetPos: { x: number; y: number; z: number };
  angle: number;
  circleRadius: number;
  speed: number;
  targetPlankKey: string | null;
  biteTimer: number;
  fleeTimer: number;
  inWaterAttackTimer: number;
}

export interface RemotePlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  maxHealth: number;
  isSwimming: boolean;
  activeItem?: ItemId | null;
  lastUpdated: number;
}

export interface SerializedStructure {
  id: string;
  type: BuildingType;
  gx: number;
  gy: number;
  gz: number;
  rotation: number;
  health: number;
  maxHealth: number;
  posX?: number;
  posY?: number;
  posZ?: number;
  data?: PlacedStructure['data'];
}

export type StoryLocationId =
  | 'sunken_beacon'
  | 'leviathan_wreck'
  | 'redwood_atoll'
  | 'scrap_city'
  | 'biodome_colony'
  | 'trench_spire'
  | 'glacier_station'
  | 'last_haven';

export interface LoreLog {
  id: string;
  title: string;
  source: string;
  timestamp: string;
  snippet: string;
  fullText: string[];
}

export interface StoryLocation {
  id: StoryLocationId;
  name: string;
  tagline: string;
  frequency: number; // e.g. 104.2 MHz
  x: number;
  z: number;
  icon: string;
  discovered: boolean;
  restored: boolean;
  objective: string;
  loreLogs: LoreLog[];
  rewards: Partial<Record<ResourceId, number>>;
}

export interface SignalArrayState {
  receiverPlaced: boolean;
  nodesPlacedCount: number; // 0..3
  powerCellInserted: boolean;
  activeFrequency: number;
  activeLocationId: StoryLocationId;
}

export interface CompactorState {
  loadedJunk: number; // Max 10 junk to compact 1 block
  maxJunk: number;
  isCompacting: boolean;
  compactProgress: number;
}

export interface MerchantItem {
  id: string;
  name: string;
  icon: string;
  costBlocks: number;
  description: string;
  yieldItem: ResourceId | ItemId;
  yieldCount: number;
  category: 'blueprints' | 'energy' | 'alloys' | 'survival';
}

export interface WorldSaveData {
  version: number;
  roomId: string;
  worldName: string;
  timestamp: number;
  dayCount: number;
  dayTime: number;
  sharkDefeatedOnce: boolean;
  structures: SerializedStructure[];
  player?: {
    stats: PlayerStats;
    hotbar: HotbarSlot[];
    inventory: InventorySlot[];
    pos: { x: number; y: number; z: number };
    yaw: number;
    pitch: number;
  };
  // NOTE: Legacy save fields `milestones` / `unlockedAchievementIds` (achievement
  // system, removed 2026-11-03) are intentionally accepted on load but ignored.
  // See docs/FEATURES_OFF.md for restoration info.
  signalArray?: {
    powerCellInserted: boolean;
    activeFrequency: number;
    activeLocationId: StoryLocationId;
  };
  unlockedLoreIds?: string[];
  completedLocationIds?: StoryLocationId[];
}

