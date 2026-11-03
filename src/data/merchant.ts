import { MerchantItem } from '../types/game';

// Items sold by the Drifting Merchant Outpost.
// Story-only goods (power_cell, locator_node) were removed with the story
// system — see docs/FEATURES_OFF.md for restoration notes.
export const MERCHANT_ITEMS: MerchantItem[] = [
  {
    id: 'trade_titanium',
    name: 'Forged Titanium Ingot',
    icon: '💎',
    costBlocks: 2,
    description: 'Ultra-durable aerospace titanium alloy salvaged from old world wreckage.',
    yieldItem: 'titanium_ingot',
    yieldCount: 2,
    category: 'alloys',
  },
  {
    id: 'trade_shark_bait',
    name: 'Reinforced Shark Bait (x2)',
    icon: '🥩',
    costBlocks: 1,
    description: 'Scented deep-sea chum lure. Distracts Bruce for 90 seconds while you harvest!',
    yieldItem: 'shark_bait',
    yieldCount: 2,
    category: 'survival',
  },
  {
    id: 'trade_metal_pack',
    name: 'Bulk Metal Ingots (x4)',
    icon: '🧈',
    costBlocks: 2,
    description: 'Four freshly cast metal ingots for structural reinforcements and spear blades.',
    yieldItem: 'metal_ingot',
    yieldCount: 4,
    category: 'alloys',
  },
  {
    id: 'trade_ironwood',
    name: 'Mutated Ironwood Planks (x6)',
    icon: '🪵',
    costBlocks: 2,
    description: 'Rock-solid petrified redwood timber with impervious durability.',
    yieldItem: 'ironwood',
    yieldCount: 6,
    category: 'alloys',
  },
];
