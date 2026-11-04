/**
 * 跨切面类型：物品/建筑枚举、UI 回调数据、存档格式、统计数值。
 *
 * 与 src/game/entities/ 的边界：entities/ 放"有世界在场感"的实体纯数据
 * （PlayerState/SharkData/DebrisObject，由各管理器系统持有
 * 集合）；本文件放它们引用的共享基型与不含实体生命周期的数据
 * （PlacedStructure 因与存档格式 SerializedStructure、UI 弹窗强耦合，
 * 暂留于此，待存档类型独立成模块时再迁）。
 */

import type { SharkData } from '../game/entities/shark';

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
  | 'ironwood'
  | 'titanium_ingot'
  | 'berry'
  | 'feather'
  | 'egg';

export type ToolId =
  | 'hook'
  | 'hammer'
  | 'spear'
  | 'metal_spear'
  | 'reinforced_hook'
  | 'paddle';

export type ItemId = ResourceId | ToolId;

/** 手持工具左键点击时触发的动作种类（具体执行由 Raft 组合根接线到各系统） */
export type ToolActionKind =
  | 'throw_hook'
  | 'spear_thrust'
  | 'scoop_saltwater';

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
  | 'crafting_table';

export interface ItemDef {
  id: ItemId;
  name: string;
  category: 'resources' | 'tools' | 'food' | 'water';
  color: string;
  icon: string;
  description: string;
  stackSize: number;
  durabilityMax?: number;
  /** 左键主动作（仅工具类物品有；缺省时左键走通用的消耗/使用路径） */
  primaryAction?: ToolActionKind;
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
    /** 帆是否张开（E 交互切换；张开时为木筏提供风推力） */
    sailOpen?: boolean;
  };
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

// NOTE: Story/landmark types (StoryLocationId, StoryLocation, LoreLog,
// SignalArrayState) were removed 2026-11-03 — see docs/FEATURES_OFF.md.

export interface WorldSaveData {
  version: number;
  worldName: string;
  timestamp: number;
  dayCount: number;
  dayTime: number;
  sharkDefeatedOnce: boolean;
  /** v2 起保存每条鲨鱼；旧存档缺省时由新游戏定义补建。 */
  sharks?: SharkData[];
  structures: SerializedStructure[];
  player?: {
    stats: PlayerStats;
    hotbar: HotbarSlot[];
    inventory: InventorySlot[];
    pos: { x: number; y: number; z: number };
    yaw: number;
    pitch: number;
  };
  // NOTE: Legacy save fields `roomId` (multiplayer server room, removed
  // 2026-11-03), `milestones` / `unlockedAchievementIds` (achievement system)
  // and `signalArray` / `unlockedLoreIds` / `completedLocationIds`
  // (story/landmark system) are intentionally accepted on load but ignored —
  // see docs/FEATURES_OFF.md.
}

