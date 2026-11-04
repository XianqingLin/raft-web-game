/**
 * StationSystem —— 站点交互系统（拆分自 engine.ts，split step 6）。
 *
 * 职责：木筏功能性站点的交互逻辑（烤架/净水器/作物/收集网/箱子/床/压缩机）、
 * 站点每帧运转（煮沸/烤制/生长/捕网）、压缩机投料与锻造。
 *
 * 通信约定：提示走事件总线 core/events.ts；UI 数值刷新通过 ctx 回调
 * onHotbarChange/onInventoryChange/onStatsChange（后续迁事件总线时移除）。
 */

import type { WorldView } from '../worldView';
import * as THREE from 'three';
import {
  HotbarSlot,
  InventorySlot,
  ItemId,
  PlacedStructure,
  ResourceId,
} from '../../types/game';
import { DebrisObject } from '../entities/debris';
import { ITEM_DEFINITIONS } from '../../data/items';
import { soundManager } from '../../audio/soundManager';
import { createDebrisMesh } from '../visuals/debris';
import { InventorySystem } from './inventory';
import { BuildSystem } from './build';
import { PlayerSystem } from './player';
import { events } from '../../core/events';

export interface StationSystemContext {
  scene: THREE.Scene;
  build: () => BuildSystem;
  player: () => PlayerSystem;
  inventory: InventorySystem;
  /** UI 刷新回调（engine 侧包装 callbacks，后续迁事件总线时移除） */
  onHotbarChange: () => void;
  onInventoryChange: () => void;
  onStatsChange: () => void;
  onOpenChest: (chest: PlacedStructure) => void;
  onOpenCompactor: () => void;
  /** 床睡觉判定（时间策略与数值都在 TimeSystem） */
  getIsNight: () => boolean;
  /** 推进到次日清晨，返回新的天数（用于提示文案） */
  advanceToMorning: () => number;
  /** 漂浮物列表（收集网捕捞用） */
  getDebrisList: () => DebrisObject[];
}

import { Tickable } from '../lifecycle';

export class StationSystem implements Tickable {
  /** 压缩机料斗当前装载量（0-10） */
  public compactorLoadedJunk = 0;

  private ctx: StationSystemContext;

  constructor(ctx: StationSystemContext) {
    this.ctx = ctx;
  }

  // Unified Smart Structure Interaction (Grill, Purifier, Crop Plot, Collection Net, Chest, Bed, Compactor, Receiver)
  public interactWithStructure(structure: PlacedStructure): boolean {
    // 1. Grill - Automatic Cook & Automatic Consume/Store (supports Fish, Potatoes, and Prime Shark Meat)
    if (structure.type === 'grill') {
      if (structure.data?.grillDone) {
        const isShark = structure.data.grillItem === 'shark_meat';
        const isFish = structure.data.grillItem === 'raw_fish';
        const cookedId: ItemId = isShark ? 'cooked_shark_meat' : isFish ? 'cooked_fish' : 'cooked_potato';

        // If player is hungry (< 95), automatically eat on the spot!
        if (this.ctx.player().localPlayer.stats.hunger < 95) {
          const hungerBonus = isShark ? 65 : isFish ? 40 : 25;
          const healthBonus = isShark ? 30 : isFish ? 15 : 8;
          this.ctx.player().localPlayer.stats.hunger = Math.min(100, this.ctx.player().localPlayer.stats.hunger + hungerBonus);
          this.ctx.player().localPlayer.stats.health = Math.min(100, this.ctx.player().localPlayer.stats.health + healthBonus);
          soundManager.playEat();
          events.emit('toast', {
            text: `Ate freshly grilled ${isShark ? 'Shark Steak' : isFish ? 'Fish' : 'Potato'}! (+${hungerBonus} Hunger, +${healthBonus} HP)`,
            color: '#22c55e',
          });
          this.ctx.onStatsChange();
        } else {
          // If already full, store in inventory
          this.ctx.inventory.addItemToInventory(cookedId, 1);
          soundManager.playItemCollect();
          events.emit('toast', {
            text: `Stored ${isShark ? 'Cooked Shark Steak' : isFish ? 'Cooked Fish' : 'Baked Potato'} in Inventory.`,
            color: '#38bdf8',
          });
        }

        structure.data.grillItem = null;
        structure.data.grillDone = false;
        structure.data.grillProgress = 0;
        const foodMesh = structure.mesh.getObjectByName('foodCooking');
        if (foodMesh) foodMesh.visible = false;
        return true;
      } else if (structure.data?.grillItem && !structure.data?.grillDone) {
        events.emit('toast', {
          text: `Food is sizzling on Grill... (${Math.round(structure.data.grillProgress || 0)}%)`,
          color: '#f59e0b',
        });
        return true;
      } else {
        // Empty Grill -> Search hotbar & inventory for shark meat, raw fish, or raw potato
        let foundCookable: { slot: HotbarSlot | InventorySlot } | null = null;
        const cookables: ItemId[] = ['shark_meat', 'raw_fish', 'raw_potato'];
        for (const targetId of cookables) {
          for (const slot of this.ctx.inventory.hotbar) {
            if (slot.itemId === targetId) {
              foundCookable = { slot };
              break;
            }
          }
          if (foundCookable) break;
          for (const slot of this.ctx.inventory.inventory) {
            if (slot.itemId === targetId) {
              foundCookable = { slot };
              break;
            }
          }
          if (foundCookable) break;
        }

        if (foundCookable) {
          const foodId = foundCookable.slot.itemId as 'raw_fish' | 'raw_potato' | 'shark_meat';
          structure.data!.grillItem = foodId;
          structure.data!.grillProgress = 0;
          structure.data!.grillDone = false;
          foundCookable.slot.count--;
          if (foundCookable.slot.count <= 0) foundCookable.slot.itemId = null;

          const foodMesh = structure.mesh.getObjectByName('foodCooking');
          if (foodMesh) {
            foodMesh.visible = true;
            if ((foodMesh as any).material) {
              ((foodMesh as any).material as THREE.MeshStandardMaterial).color.setHex(
                foodId === 'shark_meat' ? 0xdc2626 : foodId === 'raw_fish' ? 0x3b82f6 : 0xd97706
              );
            }
          }
          soundManager.playSizzle();
          const foodLabel = foodId === 'shark_meat' ? 'Prime Shark Meat' : foodId === 'raw_fish' ? 'Raw Mackerel' : 'Raw Potato';
          events.emit('toast', { text: `Placed ${foodLabel} on Grill. Sizzling...`, color: '#f97316' });
          this.ctx.onHotbarChange();
          this.ctx.onInventoryChange();
        } else {
          events.emit('toast', { text: 'No shark meat, fish, or potatoes in inventory to grill!', color: '#ef4444' });
        }
        return true;
      }
    }

    // 2. Purifier - Automatic Boil & Automatic Drink/Store
    if (structure.type === 'purifier') {
      if (structure.data?.purifierFreshWater) {
        if (this.ctx.player().localPlayer.stats.thirst < 95) {
          this.ctx.player().localPlayer.stats.thirst = Math.min(100, this.ctx.player().localPlayer.stats.thirst + 45);
          soundManager.playDrink();
          events.emit('toast', { text: 'Drank fresh clean water! (+45 Thirst)', color: '#38bdf8' });
          this.ctx.onStatsChange();
        } else {
          let foundEmpty: HotbarSlot | InventorySlot | null = null;
          for (const slot of this.ctx.inventory.hotbar) {
            if (slot.itemId === 'cup_empty') {
              foundEmpty = slot;
              break;
            }
          }
          if (!foundEmpty) {
            for (const slot of this.ctx.inventory.inventory) {
              if (slot.itemId === 'cup_empty') {
                foundEmpty = slot;
                break;
              }
            }
          }

          if (foundEmpty) {
            foundEmpty.itemId = 'cup_freshwater';
          } else {
            this.ctx.inventory.addItemToInventory('cup_freshwater', 1);
          }
          soundManager.playWaterSplash(0.9);
          events.emit('toast', { text: 'Collected Clean Water into Cup!', color: '#38bdf8' });
          this.ctx.onHotbarChange();
          this.ctx.onInventoryChange();
        }

        structure.data.purifierFreshWater = false;
        structure.data.purifierBoilProgress = 0;
        const waterDisc = structure.mesh.getObjectByName('waterSurface');
        if (waterDisc) waterDisc.visible = false;
        return true;
      } else if (structure.data?.purifierSaltWater) {
        events.emit('toast', {
          text: `Purifier is distilling seawater... (${Math.round(structure.data.purifierBoilProgress || 0)}%)`,
          color: '#38bdf8',
        });
        return true;
      } else {
        let foundSalt: HotbarSlot | InventorySlot | null = null;
        for (const slot of this.ctx.inventory.hotbar) {
          if (slot.itemId === 'cup_saltwater') {
            foundSalt = slot;
            break;
          }
        }
        if (!foundSalt) {
          for (const slot of this.ctx.inventory.inventory) {
            if (slot.itemId === 'cup_saltwater') {
              foundSalt = slot;
              break;
            }
          }
        }

        if (foundSalt) {
          foundSalt.itemId = 'cup_empty';
          structure.data!.purifierSaltWater = true;
          structure.data!.purifierBoilProgress = 0;
          soundManager.playWaterSplash(0.8);
          events.emit('toast', { text: 'Poured seawater into Purifier. Boiling...', color: '#38bdf8' });
          this.ctx.onHotbarChange();
          this.ctx.onInventoryChange();
        } else {
          let foundEmpty: HotbarSlot | InventorySlot | null = null;
          for (const slot of this.ctx.inventory.hotbar) {
            if (slot.itemId === 'cup_empty') {
              foundEmpty = slot;
              break;
            }
          }
          if (!foundEmpty) {
            for (const slot of this.ctx.inventory.inventory) {
              if (slot.itemId === 'cup_empty') {
                foundEmpty = slot;
                break;
              }
            }
          }

          if (foundEmpty) {
            structure.data!.purifierSaltWater = true;
            structure.data!.purifierBoilProgress = 0;
            soundManager.playWaterSplash(0.85);
            events.emit('toast', { text: 'Scooped seawater with Cup & started boiling!', color: '#38bdf8' });
            this.ctx.onHotbarChange();
            this.ctx.onInventoryChange();
          } else {
            events.emit('toast', { text: 'Need a Wooden Cup with seawater to purify!', color: '#ef4444' });
          }
        }
        return true;
      }
    }

    // 3. Crop Plot
    if (structure.type === 'crop_plot') {
      if (structure.data?.cropPlanted && (structure.data.cropGrowProgress || 0) >= 100) {
        structure.data.cropPlanted = false;
        structure.data.cropGrowProgress = 0;
        const shoots = structure.mesh.getObjectByName('plantShoots');
        if (shoots) shoots.visible = false;
        const harvestCount = 2 + Math.floor(Math.random() * 2);
        this.ctx.inventory.addItemToInventory('raw_potato', harvestCount);
        soundManager.playItemCollect();
        events.emit('toast', { text: `Harvested ${harvestCount} Fresh Potatoes!`, color: '#22c55e' });
      } else if (!structure.data?.cropPlanted) {
        let foundPotato: HotbarSlot | InventorySlot | null = null;
        for (const slot of this.ctx.inventory.hotbar) {
          if (slot.itemId === 'raw_potato') {
            foundPotato = slot;
            break;
          }
        }
        if (!foundPotato) {
          for (const slot of this.ctx.inventory.inventory) {
            if (slot.itemId === 'raw_potato') {
              foundPotato = slot;
              break;
            }
          }
        }

        if (foundPotato) {
          foundPotato.count--;
          if (foundPotato.count <= 0) foundPotato.itemId = null;
          structure.data!.cropPlanted = true;
          structure.data!.cropGrowProgress = 0;
          const shoots = structure.mesh.getObjectByName('plantShoots');
          if (shoots) shoots.visible = true;
          soundManager.playItemCollect();
          events.emit('toast', { text: 'Planted Potato in Crop Plot!', color: '#22c55e' });
          this.ctx.onHotbarChange();
          this.ctx.onInventoryChange();
        } else {
          events.emit('toast', { text: 'Need a Raw Potato in inventory to plant!', color: '#ef4444' });
        }
      } else {
        events.emit('toast', {
          text: `Crop growing... (${Math.round(structure.data.cropGrowProgress || 0)}%)`,
          color: '#84cc16',
        });
      }
      return true;
    }

    // 4. Collection Net
    if (structure.type === 'collection_net') {
      const trapped = structure.data?.trappedItems || [];
      if (trapped.length > 0) {
        trapped.forEach((res) => {
          this.ctx.inventory.addItemToInventory(res, 1);
        });
        structure.data!.trappedItems = [];
        const cGroup = structure.mesh.getObjectByName('caughtItems');
        if (cGroup) cGroup.clear();
        soundManager.playItemCollect();
        events.emit('toast', { text: `Emptied Collection Net (+${trapped.length} items)!`, color: '#38bdf8' });
      } else {
        events.emit('toast', { text: 'Collection net is currently empty.', color: '#94a3b8' });
      }
      return true;
    }

    // 5. Chest
    if (structure.type === 'chest') {
      soundManager.playCraft();
      this.ctx.onOpenChest(structure);
      return true;
    }

    // 6. Bed
    if (structure.type === 'bed') {
      if (this.ctx.getIsNight()) {
        const newDay = this.ctx.advanceToMorning();
        this.ctx.player().localPlayer.stats.health = Math.min(100, this.ctx.player().localPlayer.stats.health + 35);
        soundManager.playDrink();
        events.emit('toast', { text: `Rested peacefully until morning. Day ${newDay}!`, color: '#38bdf8' });
        this.ctx.onStatsChange();
      } else {
        events.emit('toast', { text: 'You can only sleep during the night!', color: '#94a3b8' });
      }
      return true;
    }

    // 7. Debris Compactor (Scavenger Economy Station)
    if (structure.type === 'debris_compactor') {
      this.ctx.onOpenCompactor();
      return true;
    }

    return false;
  }

  // ==================== Debris Compactor ====================

  // Debris Compactor: Feed junk materials (wood, plastic, thatch/leaf, scrap) into hopper
  public feedCompactorJunk(junkItemId: ItemId, count: number = 1): boolean {
    if (this.compactorLoadedJunk >= 10) {
      events.emit('toast', {
        text: 'Debris Compactor hopper is full (10/10)! Ready to forge scrap block.',
        color: '#f59e0b',
      });
      return false;
    }

    const toFeed = Math.min(count, 10 - this.compactorLoadedJunk);
    let remaining = toFeed;

    for (const s of this.ctx.inventory.hotbar) {
      if (s.itemId === junkItemId) {
        const take = Math.min(remaining, s.count);
        s.count -= take;
        remaining -= take;
        if (s.count <= 0) s.itemId = null;
        if (remaining <= 0) break;
      }
    }
    if (remaining > 0) {
      for (const s of this.ctx.inventory.inventory) {
        if (s.itemId === junkItemId) {
          const take = Math.min(remaining, s.count);
          s.count -= take;
          remaining -= take;
          if (s.count <= 0) s.itemId = null;
          if (remaining <= 0) break;
        }
      }
    }

    const fed = toFeed - remaining;
    if (fed <= 0) {
      events.emit('toast', {
        text: `No ${ITEM_DEFINITIONS[junkItemId]?.name || junkItemId} found in inventory!`,
        color: '#ef4444',
      });
      return false;
    }

    this.compactorLoadedJunk += fed;
    soundManager.playItemCollect();
    const itemName = ITEM_DEFINITIONS[junkItemId]?.name || junkItemId;
    events.emit('toast', {
      text: `Fed ${fed}x ${itemName} into Compactor (${this.compactorLoadedJunk}/10)`,
      color: '#38bdf8',
    });
    this.ctx.onHotbarChange();
    this.ctx.onInventoryChange();
    return true;
  }

  // Debris Compactor: Forge 1 Salvaged Scrap Block from 10 ocean junk
  public forgeCompactorBlock(): boolean {
    if (this.compactorLoadedJunk < 10) {
      events.emit('toast', {
        text: `Need 10 ocean junk to forge! Loaded: ${this.compactorLoadedJunk}/10`,
        color: '#ef4444',
      });
      return false;
    }

    this.compactorLoadedJunk = 0;
    this.ctx.inventory.addItemToInventory('salvaged_scrap_block', 1);
    soundManager.playCraft();
    events.emit('toast', { text: '⚙️ Hydraulic Compactor forged 1 Salvaged Scrap Block!', color: '#22c55e' });
    return true;
  }

  // ==================== Per-frame Update ====================

  // Update Stations: Boiling Purifiers, Sizzling Grills, Growing Crops, Collection Nets
  /** 每帧：站点生产推进（Tickable 统一入口） */
  public update(dt: number, _elapsed: number) {
    this.ctx.build().structures.forEach((s) => {
      // 1. Purifier
      if (s.type === 'purifier' && s.data?.purifierSaltWater) {
        s.data.purifierBoilProgress = (s.data.purifierBoilProgress || 0) + dt * 4.5;
        if (s.data.purifierBoilProgress >= 100) {
          s.data.purifierSaltWater = false;
          s.data.purifierFreshWater = true;
          const waterDisc = s.mesh.getObjectByName('waterSurface');
          if (waterDisc) waterDisc.visible = true;
          events.emit('toast', { text: 'Fresh water is ready in Purifier!', color: '#38bdf8' });
        }
      }

      // 2. Grill
      if (s.type === 'grill' && s.data?.grillItem && !s.data?.grillDone) {
        s.data.grillProgress = (s.data.grillProgress || 0) + dt * 6.5;
        if (s.data.grillProgress >= 100) {
          s.data.grillDone = true;
          const foodMesh = s.mesh.getObjectByName('foodCooking');
          if (foodMesh && (foodMesh as any).material) {
            ((foodMesh as any).material as THREE.MeshStandardMaterial).color.setHex(0xea580c); // cooked golden!
          }
          events.emit('toast', { text: 'Food on Grill is cooked!', color: '#22c55e' });
        }
      }

      // 3. Crop Plot
      if (s.type === 'crop_plot' && s.data?.cropPlanted) {
        s.data.cropGrowProgress = (s.data.cropGrowProgress || 0) + dt * 3.0;
        const shoots = s.mesh.getObjectByName('plantShoots');
        if (shoots) {
          const scale = 0.4 + (Math.min(100, s.data.cropGrowProgress) / 100) * 0.7;
          shoots.scale.set(scale, scale, scale);
        }
      }

      // 4. Collection Net Catching Debris
      if (s.type === 'collection_net') {
        const netPos = s.mesh.position;
        const trapped = s.data?.trappedItems || [];
        if (trapped.length < 3) {
          const debrisList = this.ctx.getDebrisList();
          for (let i = 0; i < debrisList.length; i++) {
            const d = debrisList[i];
            if (!d.caught && d.mesh.position.distanceTo(netPos) < 1.1) {
              d.caught = true;
              this.ctx.scene.remove(d.mesh);
              debrisList.splice(i, 1);
              const caughtYield = (Object.keys(d.yields)[0] as ResourceId) || 'wood';
              trapped.push(caughtYield);
              s.data!.trappedItems = trapped;
              soundManager.playItemCollect();

              // Add visual item inside net
              const cGroup = s.mesh.getObjectByName('caughtItems');
              if (cGroup) {
                const mini = createDebrisMesh(d.type);
                mini.scale.set(0.4, 0.4, 0.4);
                mini.position.set((trapped.length - 2) * 0.4, 0, 0);
                cGroup.add(mini);
              }
              break;
            }
          }
        }
      }
    });
  }
}

// ==================== Factory（由 Raft 组合根统一接线） ====================

export function createStationSystem(w: WorldView): StationSystem {
  return new StationSystem({
    scene: w.scene,
    build: () => w.build(),
    player: () => w.player(),
    inventory: w.inventory(),
    onHotbarChange: () => {
      const inv = w.inventory();
      w.ui.onHotbarChange([...inv.hotbar], inv.activeHotbarIdx);
    },
    onInventoryChange: () => w.ui.onInventoryChange([...w.inventory().inventory]),
    onStatsChange: () => w.ui.onStatsChange({ ...w.player().localPlayer.stats }),
    onOpenChest: (chest) => w.ui.onOpenChest(chest),
    onOpenCompactor: () => w.ui.onOpenCompactor?.(),
    getIsNight: () => w.time().isNight,
    advanceToMorning: () => w.time().advanceToMorning(),
    getDebrisList: () => w.debris().items,
  });
}
