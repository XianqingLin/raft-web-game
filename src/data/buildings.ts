/**
 * 建筑定义（data 层）：每种 BuildingType 的名称/图标/建造成本/吸附面。
 * BuildSystem 的建造轮盘与成本校验消费它；网格外观见 game/visuals/buildings.ts。
 */
import { BuildingType, ResourceId } from '../types/game';

export const BUILDING_DEFINITIONS: Record<
  BuildingType,
  {
    name: string;
    cost: Partial<Record<ResourceId, number>>;
    icon: string;
    description: string;
    snappableTo: 'water' | 'raft' | 'pillar';
  }
> = {
  foundation: {
    name: 'Wooden Planks (Lower & Upper Deck)',
    cost: { wood: 2, plastic: 1 },
    icon: '🪵',
    description: 'Universal plank: lower deck on water or upper deck atop beams & walls.',
    snappableTo: 'water',
  },
  tri_foundation: {
    name: 'Triangle Foundation',
    cost: { wood: 2, plastic: 1 },
    icon: '📐',
    description: 'Corner angled floating plank.',
    snappableTo: 'water',
  },
  collection_net: {
    name: 'Collection Net',
    cost: { wood: 4, rope: 4 },
    icon: '🕸️',
    description: 'Automatically catches passing floating debris!',
    snappableTo: 'water',
  },
  pillar: {
    name: 'Support Pillar (Beam)',
    cost: { wood: 2, scrap: 1 },
    icon: '🏛️',
    description: 'Vertical support beam to connect upper deck planks.',
    snappableTo: 'raft',
  },
  floor: {
    name: 'Wooden Planks (Upper Deck)',
    cost: { wood: 2, plastic: 1 },
    icon: '🪵',
    description: 'Upper deck planks supported by beams, walls, or window walls.',
    snappableTo: 'pillar',
  },
  stairs: {
    name: 'Wooden Stairs',
    cost: { wood: 4, rope: 2 },
    icon: '🪜',
    description: 'Climb up to your second-floor deck.',
    snappableTo: 'raft',
  },
  wall: {
    name: 'Wooden Wall',
    cost: { wood: 3 },
    icon: '🧱',
    description: 'Sturdy wooden plank perimeter wall.',
    snappableTo: 'raft',
  },
  window_wall: {
    name: 'Window Wall',
    cost: { wood: 3 },
    icon: '🪟',
    description: 'Wall with open ocean lookout.',
    snappableTo: 'raft',
  },
  fence: {
    name: 'Safety Railing',
    cost: { wood: 1, rope: 1 },
    icon: '🚧',
    description: 'Prevent falling into water.',
    snappableTo: 'raft',
  },
  purifier: {
    name: 'Simple Purifier',
    cost: { wood: 4, leaf: 4, plastic: 4 },
    icon: '⚗️',
    description: 'Boils saltwater into pure drinking water.',
    snappableTo: 'raft',
  },
  grill: {
    name: 'Simple Grill',
    cost: { wood: 4, scrap: 2, rope: 2 },
    icon: '🍳',
    description: 'Cooks raw fish and potatoes over hot coals.',
    snappableTo: 'raft',
  },
  crop_plot: {
    name: 'Small Crop Plot',
    cost: { wood: 4, rope: 2 },
    icon: '🌱',
    description: 'Grow potatoes for infinite sustenance.',
    snappableTo: 'raft',
  },
  chest: {
    name: 'Storage Chest',
    cost: { wood: 6, plastic: 4, rope: 2 },
    icon: '📦',
    description: 'Safely stores 12 slots of items.',
    snappableTo: 'raft',
  },
  sail: {
    name: 'Canvas Sail',
    cost: { wood: 8, leaf: 8, rope: 4 },
    icon: '⛵',
    description: 'Accelerates raft drift and debris collection speed.',
    snappableTo: 'raft',
  },
  bed: {
    name: 'Hammock Bed',
    cost: { wood: 6, leaf: 6, rope: 4 },
    icon: '🛏️',
    description: 'Rest through the night to heal +30 Health.',
    snappableTo: 'raft',
  },
  crafting_table: {
    name: 'Advanced Research Workbench',
    cost: { wood: 8, plastic: 4, scrap: 2 },
    icon: '🔬',
    description: 'Enables advanced engineering blueprinted tools and metal structures.',
    snappableTo: 'raft',
  },
  debris_compactor: {
    name: 'Debris Compactor',
    cost: { wood: 6, plastic: 4, scrap: 4, bolt: 2 },
    icon: '🗜️',
    description: 'Compress 10 ocean junk pieces into Salvaged Scrap Blocks.',
    snappableTo: 'raft',
  },
};
