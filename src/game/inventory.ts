import { HotbarSlot, InventorySlot, ItemId, ResourceId, BuildingType } from '../types/game';
import { ITEM_DEFINITIONS, CRAFTING_RECIPES } from '../data/itemsAndRecipes';
import { soundManager } from '../audio/soundManager';
import { PlayerState } from './context';

/**
 * Inventory & Crafting System.
 * Extracted from engine.ts — owns hotbar/inventory slots, stacking,
 * cost handling and recipe crafting. Slot mutations push UI updates
 * through InventoryContext.callbacks.
 */
export interface InventoryCallbacks {
  onToast: (text: string, color?: string) => void;
  onHotbarChange: (hotbar: HotbarSlot[], activeIdx: number) => void;
  onInventoryChange: (inventory: InventorySlot[]) => void;
  onStatsChange: (stats: PlayerState['stats']) => void;
}

export interface InventoryContext {
  callbacks: InventoryCallbacks;
  player: PlayerState;
  /** Recipe targets a building: engine enters build mode pre-selected. */
  onReadyToBuild: (building: BuildingType) => void;
  /** Active hotbar slot changed: engine re-equips tool, toggles build/fishing. */
  onToolSlotChanged: (itemId: ItemId | null) => void;
}

export class InventorySystem {
  public hotbar: HotbarSlot[] = [
    { itemId: 'hook', count: 1, durability: 50 },
    { itemId: 'hammer', count: 1, durability: 100 },
    { itemId: 'spear', count: 1, durability: 40 },
    { itemId: 'cup_empty', count: 1 },
    { itemId: 'wood', count: 20 },
    { itemId: 'plastic', count: 16 },
    { itemId: 'leaf', count: 12 },
    { itemId: 'scrap', count: 8 },
  ];
  public activeHotbarIdx: number = 0;

  public inventory: InventorySlot[] = Array.from({ length: 16 }, () => ({
    itemId: null,
    count: 0,
  }));

  private ctx: InventoryContext;
  private player: PlayerState;
  private callbacks: InventoryCallbacks;

  constructor(ctx: InventoryContext) {
    this.ctx = ctx;
    this.player = ctx.player;
    this.callbacks = ctx.callbacks;
  }

  public setActiveHotbarSlot(idx: number) {
    if (idx < 0 || idx >= this.hotbar.length) return;
    this.activeHotbarIdx = idx;
    this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    this.ctx.onToolSlotChanged(this.hotbar[idx].itemId ?? null);
  }

  public addItemToInventory(itemId: ItemId, count: number = 1): boolean {
    const def = ITEM_DEFINITIONS[itemId];
    if (!def) return false;

    let remaining = count;

    // 1. Try filling existing hotbar stacks
    for (let slot of this.hotbar) {
      if (slot.itemId === itemId && slot.count < def.stackSize) {
        const canAdd = Math.min(remaining, def.stackSize - slot.count);
        slot.count += canAdd;
        remaining -= canAdd;
        if (remaining <= 0) break;
      }
    }

    // 2. Try filling existing inventory stacks
    if (remaining > 0) {
      for (let slot of this.inventory) {
        if (slot.itemId === itemId && slot.count < def.stackSize) {
          const canAdd = Math.min(remaining, def.stackSize - slot.count);
          slot.count += canAdd;
          remaining -= canAdd;
          if (remaining <= 0) break;
        }
      }
    }

    // 3. Try empty hotbar slots
    if (remaining > 0) {
      for (let slot of this.hotbar) {
        if (!slot.itemId) {
          slot.itemId = itemId;
          slot.count = remaining;
          remaining = 0;
          break;
        }
      }
    }

    // 4. Try empty inventory slots
    if (remaining > 0) {
      for (let slot of this.inventory) {
        if (!slot.itemId) {
          slot.itemId = itemId;
          slot.count = remaining;
          remaining = 0;
          break;
        }
      }
    }

    this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    this.callbacks.onInventoryChange([...this.inventory]);
    return remaining === 0;
  }

  public canAfford(cost: Partial<Record<ResourceId, number>>): boolean {
    const totals: Record<string, number> = {};
    const countIn = (slots: (HotbarSlot | InventorySlot)[]) => {
      slots.forEach((s) => {
        if (s.itemId) {
          totals[s.itemId] = (totals[s.itemId] || 0) + s.count;
        }
      });
    };
    countIn(this.hotbar);
    countIn(this.inventory);

    for (let [res, amt] of Object.entries(cost)) {
      if ((totals[res] || 0) < (amt || 0)) return false;
    }
    return true;
  }

  public deductCost(cost: Partial<Record<ResourceId, number>>) {
    for (let [res, amtNeeded] of Object.entries(cost)) {
      let needed = amtNeeded || 0;
      // Hotbar first
      for (let slot of this.hotbar) {
        if (slot.itemId === res) {
          const deduct = Math.min(needed, slot.count);
          slot.count -= deduct;
          needed -= deduct;
          if (slot.count <= 0) slot.itemId = null;
          if (needed <= 0) break;
        }
      }
      // Inventory second
      if (needed > 0) {
        for (let slot of this.inventory) {
          if (slot.itemId === res) {
            const deduct = Math.min(needed, slot.count);
            slot.count -= deduct;
            needed -= deduct;
            if (slot.count <= 0) slot.itemId = null;
            if (needed <= 0) break;
          }
        }
      }
    }
    this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    this.callbacks.onInventoryChange([...this.inventory]);
  }

  public craftRecipe(recipeId: string): boolean {
    const recipe = CRAFTING_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return false;

    if (!this.canAfford(recipe.cost)) {
      this.callbacks.onToast('Missing materials!', '#ef4444');
      return false;
    }

    this.deductCost(recipe.cost);

    if (recipe.targetItem) {
      this.addItemToInventory(recipe.targetItem, 1);
      soundManager.playCraft();
      const def = ITEM_DEFINITIONS[recipe.targetItem];
      this.callbacks.onToast(`Crafted ${def?.name || 'Item'}!`, '#22c55e');
    } else if (recipe.targetBuilding) {
      // Auto-switch to building mode with this item
      this.ctx.onReadyToBuild(recipe.targetBuilding);
      soundManager.playCraft();
      this.callbacks.onToast(`Ready to build ${recipe.name}!`, '#38bdf8');
    }
    return true;
  }

  public consumeSlot(isInventory: boolean, index: number): boolean {
    const slot = isInventory ? this.inventory[index] : this.hotbar[index];
    if (!slot || !slot.itemId) return false;

    const itemId = slot.itemId;

    // 1. Food items
    if (
      itemId === 'cooked_fish' ||
      itemId === 'cooked_potato' ||
      itemId === 'coconut' ||
      itemId === 'raw_potato' ||
      itemId === 'raw_fish' ||
      itemId === 'shark_meat' ||
      itemId === 'cooked_shark_meat' ||
      itemId === 'berry' ||
      itemId === 'egg'
    ) {
      if (this.player.stats.hunger >= 98 && itemId !== 'coconut' && itemId !== 'berry') {
        this.callbacks.onToast("You're already full! (Hunger 100%)", '#94a3b8');
        return false;
      }

      let hungerBonus = 0;
      let healthBonus = 0;
      let name = '';

      if (itemId === 'cooked_shark_meat') {
        hungerBonus = 65;
        healthBonus = 30;
        name = 'Cooked Shark Steak';
      } else if (itemId === 'shark_meat') {
        hungerBonus = 25;
        healthBonus = 5;
        name = 'Raw Shark Meat';
      } else if (itemId === 'berry') {
        hungerBonus = 18;
        healthBonus = 5;
        name = 'Wild Berries';
        this.player.stats.thirst = Math.min(100, this.player.stats.thirst + 8);
      } else if (itemId === 'egg') {
        hungerBonus = 15;
        healthBonus = 4;
        name = 'Seagull Egg';
      } else if (itemId === 'cooked_fish') {
        hungerBonus = 40;
        healthBonus = 15;
        name = 'Cooked Fish';
      } else if (itemId === 'cooked_potato') {
        hungerBonus = 25;
        healthBonus = 8;
        name = 'Baked Potato';
      } else if (itemId === 'coconut') {
        hungerBonus = 20;
        healthBonus = 5;
        name = 'Fresh Coconut';
        this.player.stats.thirst = Math.min(100, this.player.stats.thirst + 25);
      } else if (itemId === 'raw_potato') {
        hungerBonus = 12;
        name = 'Raw Potato';
      } else if (itemId === 'raw_fish') {
        hungerBonus = 15;
        name = 'Raw Fish';
      }

      this.player.stats.hunger = Math.min(100, this.player.stats.hunger + hungerBonus);
      this.player.stats.health = Math.min(100, this.player.stats.health + healthBonus);

      slot.count--;
      if (slot.count <= 0) slot.itemId = null;

      soundManager.playEat();
      this.callbacks.onToast(`Ate ${name}! (+${hungerBonus} Hunger${healthBonus ? `, +${healthBonus} HP` : ''})`, '#22c55e');
      this.callbacks.onStatsChange({ ...this.player.stats });
      this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
      this.callbacks.onInventoryChange([...this.inventory]);
      return true;
    }

    // 2. Drinks
    if (itemId === 'cup_freshwater') {
      if (this.player.stats.thirst >= 98) {
        this.callbacks.onToast("You're already fully hydrated! (Thirst 100%)", '#94a3b8');
        return false;
      }
      this.player.stats.thirst = Math.min(100, this.player.stats.thirst + 45);
      slot.itemId = 'cup_empty';
      soundManager.playDrink();
      this.callbacks.onToast('Drank pure freshwater! (+45 Thirst)', '#38bdf8');
      this.callbacks.onStatsChange({ ...this.player.stats });
      this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
      this.callbacks.onInventoryChange([...this.inventory]);
      return true;
    }

    return false;
  }

  /** 把当前手持的空杯装满海水（是否靠近水源由 Game 判定后调用） */
  public fillCupWithSaltwater(): boolean {
    const slot = this.hotbar[this.activeHotbarIdx];
    if (!slot || slot.itemId !== 'cup_empty') return false;

    slot.itemId = 'cup_saltwater';
    soundManager.playWaterSplash(0.9);
    this.callbacks.onToast('Gathered Cup of Ocean Saltwater', '#38bdf8');
    this.callbacks.onHotbarChange([...this.hotbar], this.activeHotbarIdx);
    return true;
  }
}
