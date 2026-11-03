import React, { useState } from 'react';
import { InventorySlot, HotbarSlot, PlacedStructure, ResourceId, ItemId } from '../types/game';
import { ITEM_DEFINITIONS } from '../data/items';
import { CRAFTING_RECIPES } from '../data/recipes';
import { X, Wrench, Shield, Home, Coffee, Package, ArrowRightLeft } from 'lucide-react';
import { soundManager } from '../audio/soundManager';

interface InventoryCraftingModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventory: InventorySlot[];
  hotbar: HotbarSlot[];
  activeChest: PlacedStructure | null;
  onCloseChest: () => void;
  onCraftRecipe: (recipeId: string) => void;
  onMoveItemToChest?: (fromInvIdx: number) => void;
  onMoveItemFromChest?: (fromChestIdx: number) => void;
  onConsumeSlot?: (isInventory: boolean, index: number) => void;
  stats?: { hunger: number; thirst: number };
}

export const InventoryCraftingModal: React.FC<InventoryCraftingModalProps> = ({
  isOpen,
  onClose,
  inventory,
  hotbar,
  activeChest,
  onCloseChest,
  onCraftRecipe,
  onConsumeSlot,
  stats,
}) => {
  const [activeCategory, setActiveCategory] = useState<'tools' | 'survival' | 'building' | 'food_water'>('tools');

  if (!isOpen && !activeChest) return null;

  // Calculate total resources available
  const resourceTotals: Record<string, number> = {};
  [...hotbar, ...inventory].forEach((slot) => {
    if (slot.itemId) {
      resourceTotals[slot.itemId] = (resourceTotals[slot.itemId] || 0) + slot.count;
    }
  });

  const categories: Array<{ id: 'tools' | 'survival' | 'building' | 'food_water'; label: string; icon: any }> = [
    { id: 'tools', label: 'Tools & Weapons', icon: Wrench },
    { id: 'survival', label: 'Survival Stations', icon: Shield },
    { id: 'building', label: 'Raft Architecture', icon: Home },
    { id: 'food_water', label: 'Food & Water', icon: Coffee },
  ];

  const filteredRecipes = CRAFTING_RECIPES.filter((r) => r.category === activeCategory);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none">
      <div className="bg-slate-900 border border-white/15 rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-950 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📓</span>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">
                {activeChest ? 'Storage Chest & Inventory' : 'Survivor Notebook & Crafting'}
              </h2>
              <p className="text-xs text-slate-400">Expand your vessel &bull; Press [I] or [Esc] to return to raft</p>
            </div>
          </div>
          <button
            onClick={() => {
              if (activeChest) onCloseChest();
              else onClose();
            }}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/10 overflow-y-auto">
          {/* Left Column: Crafting Recipes or Chest Storage */}
          {activeChest ? (
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm uppercase tracking-wider">
                <Package className="w-4 h-4" />
                <span>Chest Storage (12 Slots)</span>
              </div>
              <p className="text-xs text-slate-400">Click items in your inventory to store them inside the chest.</p>

              <div className="grid grid-cols-4 gap-2.5">
                {activeChest.data?.chestItems?.map((slot, idx) => {
                  const itemDef = slot.itemId ? ITEM_DEFINITIONS[slot.itemId] : null;
                  return (
                    <div
                      key={idx}
                      className="w-16 h-16 rounded-xl bg-slate-800 border border-white/10 flex flex-col items-center justify-center relative p-1"
                    >
                      {itemDef ? (
                        <>
                          <span className="text-2xl">{itemDef.icon}</span>
                          <span className="text-[10px] text-slate-300 font-semibold truncate max-w-full">
                            {itemDef.name}
                          </span>
                          <span className="absolute bottom-1 right-1.5 text-[10px] font-bold text-white bg-slate-950/80 px-1 rounded">
                            {slot.count}
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-slate-600 font-mono">Empty</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-6 flex flex-col gap-4 overflow-y-auto">
              {/* Category Tabs */}
              <div className="flex gap-1.5 bg-slate-950 p-1 rounded-xl border border-white/10">
                {categories.map((c) => {
                  const Icon = c.icon;
                  const isActive = activeCategory === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveCategory(c.id)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                        isActive ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{c.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Recipe List */}
              <div className="flex flex-col gap-3 overflow-y-auto pr-1">
                {filteredRecipes.map((recipe) => {
                  const canAfford = Object.entries(recipe.cost).every(
                    ([res, amt]) => (resourceTotals[res] || 0) >= (amt || 0)
                  );

                  return (
                    <div
                      key={recipe.id}
                      className="bg-slate-950/70 border border-white/10 p-3.5 rounded-2xl flex flex-col gap-2 hover:border-white/20 transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-2">
                            <span>{recipe.name}</span>
                          </h4>
                          <p className="text-xs text-slate-400 mt-0.5">{recipe.description}</p>
                        </div>
                        <button
                          disabled={!canAfford}
                          onClick={() => onCraftRecipe(recipe.id)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                            canAfford
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5'
                          }`}
                        >
                          Craft
                        </button>
                      </div>

                      {/* Required Resources badges */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-white/5">
                        <span className="text-[11px] text-slate-400 font-semibold mr-1">Cost:</span>
                        {Object.entries(recipe.cost).map(([res, amt]) => {
                          const current = resourceTotals[res] || 0;
                          const hasEnough = current >= (amt || 0);
                          const itemDef = ITEM_DEFINITIONS[res as ResourceId];

                          return (
                            <span
                              key={res}
                              className={`text-[11px] font-medium px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                                hasEnough
                                  ? 'bg-slate-800 text-slate-200 border-white/10'
                                  : 'bg-red-950/50 text-red-300 border-red-500/30'
                              }`}
                            >
                              <span>{itemDef?.icon || '•'}</span>
                              <span>{itemDef?.name || res}</span>
                              <span className={hasEnough ? 'text-emerald-400' : 'text-red-400'}>
                                ({current}/{amt})
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Right Column: Player Inventory & Hotbar */}
          <div className="p-6 flex flex-col gap-5">
            {/* Inventory (16 slots) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Survivor Inventory (16 Slots)
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  {inventory.filter((s) => s.itemId !== null).length} / 16
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {inventory.map((slot, idx) => {
                  const itemDef = slot.itemId ? ITEM_DEFINITIONS[slot.itemId] : null;
                  const isFood = slot.itemId && ['cooked_fish', 'cooked_potato', 'coconut', 'raw_potato', 'raw_fish'].includes(slot.itemId);
                  const isDrink = slot.itemId && ['cup_freshwater', 'coconut'].includes(slot.itemId);
                  const shouldEat = isFood && (stats?.hunger ?? 100) < 98;
                  const shouldDrink = isDrink && (stats?.thirst ?? 100) < 98;

                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        if (slot.itemId && onConsumeSlot) {
                          onConsumeSlot(true, idx);
                        }
                      }}
                      title={
                        itemDef
                          ? `${itemDef.name}\n${itemDef.description}${isFood ? '\n[Click to Eat]' : ''}${isDrink ? '\n[Click to Drink]' : ''}`
                          : 'Empty Slot'
                      }
                      className={`w-15 h-15 rounded-xl bg-slate-950/80 border flex flex-col items-center justify-center relative p-1 transition-all ${
                        slot.itemId ? 'cursor-pointer hover:scale-105 active:scale-95' : ''
                      } ${
                        shouldEat
                          ? 'border-emerald-500/70 shadow-sm shadow-emerald-500/20 hover:border-emerald-400 bg-emerald-950/30'
                          : shouldDrink
                          ? 'border-sky-500/70 shadow-sm shadow-sky-500/20 hover:border-sky-400 bg-sky-950/30'
                          : 'border-white/10 hover:border-white/30'
                      }`}
                    >
                      {itemDef ? (
                        <>
                          <span className="text-xl">{itemDef.icon}</span>
                          <span className="text-[9px] text-slate-300 font-semibold truncate max-w-full">
                            {itemDef.name}
                          </span>
                          {slot.count > 1 && (
                            <span className="absolute bottom-1 right-1 text-[10px] font-bold text-white bg-slate-900/90 px-1 rounded">
                              {slot.count}
                            </span>
                          )}
                          {shouldEat && (
                            <span className="absolute -top-1 -right-1 text-[8px] bg-emerald-600 text-white font-extrabold px-1 rounded-full shadow animate-pulse">
                              EAT
                            </span>
                          )}
                          {shouldDrink && !shouldEat && (
                            <span className="absolute -top-1 -right-1 text-[8px] bg-sky-600 text-white font-extrabold px-1 rounded-full shadow animate-pulse">
                              DRINK
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[10px] text-slate-700 font-mono">•</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Hotbar (8 slots) */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2">
                Active Hotbar (Keys 1-8)
              </div>
              <div className="grid grid-cols-4 gap-2">
                {hotbar.map((slot, idx) => {
                  const itemDef = slot.itemId ? ITEM_DEFINITIONS[slot.itemId] : null;
                  const isFood = slot.itemId && ['cooked_fish', 'cooked_potato', 'coconut', 'raw_potato', 'raw_fish'].includes(slot.itemId);
                  const isDrink = slot.itemId && ['cup_freshwater', 'coconut'].includes(slot.itemId);
                  const shouldEat = isFood && (stats?.hunger ?? 100) < 98;
                  const shouldDrink = isDrink && (stats?.thirst ?? 100) < 98;

                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        if (slot.itemId && onConsumeSlot) {
                          onConsumeSlot(false, idx);
                        }
                      }}
                      title={
                        itemDef
                          ? `${itemDef.name}\n${itemDef.description}${isFood ? '\n[Click to Eat]' : ''}${isDrink ? '\n[Click to Drink]' : ''}`
                          : 'Empty Slot'
                      }
                      className={`w-15 h-15 rounded-xl bg-slate-950/80 border flex flex-col items-center justify-center relative p-1 transition-all ${
                        slot.itemId ? 'cursor-pointer hover:scale-105 active:scale-95' : ''
                      } ${
                        shouldEat
                          ? 'border-emerald-500 shadow-sm shadow-emerald-500/20 bg-emerald-950/30'
                          : shouldDrink
                          ? 'border-sky-500 shadow-sm shadow-sky-500/20 bg-sky-950/30'
                          : 'border-amber-500/30 hover:border-amber-500/60'
                      }`}
                    >
                      <span className="absolute top-1 left-1.5 text-[8px] font-bold text-amber-400">
                        {idx + 1}
                      </span>
                      {itemDef ? (
                        <>
                          <span className="text-xl">{itemDef.icon}</span>
                          <span className="text-[9px] text-slate-300 font-semibold truncate max-w-full">
                            {itemDef.name}
                          </span>
                          {slot.count > 1 && (
                            <span className="absolute bottom-1 right-1 text-[10px] font-bold text-white bg-slate-900/90 px-1 rounded">
                              {slot.count}
                            </span>
                          )}
                          {shouldEat && (
                            <span className="absolute -top-1 -right-1 text-[8px] bg-emerald-600 text-white font-extrabold px-1 rounded-full shadow animate-pulse">
                              EAT
                            </span>
                          )}
                          {shouldDrink && !shouldEat && (
                            <span className="absolute -top-1 -right-1 text-[8px] bg-sky-600 text-white font-extrabold px-1 rounded-full shadow animate-pulse">
                              DRINK
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[10px] text-slate-700 font-mono">•</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
