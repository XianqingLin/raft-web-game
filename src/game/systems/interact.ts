import type { WorldView } from '../worldView';
import * as THREE from 'three';
import { ItemId, PlacedStructure, ToolActionKind } from '../../types/game';
import { ITEM_DEFINITIONS } from '../../data/items';
import { BuildSystem } from './build';
import { PlayerState } from '../entities/player';
import { HookSystem } from './hook';
import { InventorySystem } from './inventory';
import { SharkSystem } from './shark';
import { StationSystem } from './stations';
import { events } from '../../core/events';

/**
 * InteractionSystem —— 交互系统（拆分自 engine.ts，split step 9）。
 *
 * 职责：木筏站点与漂浮鲨鱼肉的上下文交互提示，
 * 提示文案生成、aimed 状态维护；以及左键动作结算——
 * 优先级链与工具主动作执行表原属旧世界门面，后迁入本系统：aimed
 * 感知与"点下去发生什么"是同一关注点。
 */

export interface AimedInteractable {
  structure: PlacedStructure;
  action: string;
}

export interface InteractionContext {
  camera: THREE.PerspectiveCamera;
  player: () => PlayerState;
  build: BuildSystem;
  stations: StationSystem;
  shark: SharkSystem;
  /** 钩索系统（工具主动作：投掷钩索） */
  hook: HookSystem;
  /** 背包系统（资源入包、进食/喝水统一入口） */
  inventory: InventorySystem;
  /** 是否处于可取水位置（空杯舀海水的条件判定，规则在 PlayerSystem） */
  canScoopSaltwater: () => boolean;
  /** 当前手持物品 id（水杯提示分支与工具主动作分发用） */
  getActiveItemId: () => ItemId | null;
}

import { Tickable } from '../lifecycle';

export class InteractionSystem implements Tickable {
  /** 准星命中的可交互站点与动作 */
  public aimedInteractable: AimedInteractable | null = null;
  private ctx: InteractionContext;
  /** 工具主动作 → 系统调用的执行表（物品→动作的映射在 data/items.ts） */
  private toolActions: Record<ToolActionKind, () => void>;

  constructor(ctx: InteractionContext) {
    this.ctx = ctx;
    this.toolActions = {
      throw_hook: () => {
        ctx.hook.chargeStart();
        ctx.hook.reelClick();
      },
      spear_thrust: () => ctx.shark.spearThrust(ctx.hook.toolModel),
      scoop_saltwater: () => {
        // Water-source condition in PlayerSystem, consumption in inventory
        if (ctx.canScoopSaltwater()) {
          ctx.inventory.fillCupWithSaltwater();
        }
      },
    };
  }

  /** 每帧：重算站点瞄准状态并推送提示文案 */
  public update() {
    const { camera, build, stations, shark } = this.ctx;
    const player = this.ctx.player();
    let foundInteract: AimedInteractable | null = null;
    let promptText: string | null = null;

    // Check structures near player (by distance or raycast)
    const directHit = build.getStructureUnderCrosshair();
    const candidateStructures = directHit ? [directHit] : Array.from(build.structures.values());

    for (let s of candidateStructures) {
      const dist = camera.position.distanceTo(s.mesh.position);
      if (dist < 3.4) {
        if (s.type === 'purifier') {
          if (s.data?.purifierFreshWater) {
            foundInteract = { structure: s, action: 'collect_fresh' };
            const willDrink = player.stats.thirst < 95;
            promptText = `[Left-Click] ${willDrink ? 'Drink Clean Fresh Water (+Thirst)' : 'Store Clean Water in Cup'}`;
            break;
          } else if (s.data?.purifierSaltWater) {
            promptText = `Purifier Distilling Seawater... (${Math.round(s.data.purifierBoilProgress || 0)}%)`;
            foundInteract = { structure: s, action: 'boiling' };
            break;
          } else {
            foundInteract = { structure: s, action: 'fill_salt' };
            promptText = '[Left-Click] Auto-Boil Seawater in Purifier';
            break;
          }
        } else if (s.type === 'grill') {
          if (s.data?.grillDone) {
            foundInteract = { structure: s, action: 'collect_grilled' };
            const willEat = player.stats.hunger < 95;
            promptText = `[Left-Click] ${willEat ? 'Eat Cooked Food (+Hunger & Health)' : 'Store Cooked Food in Inventory'}`;
            break;
          } else if (s.data?.grillItem) {
            promptText = `Grill Sizzling Food... (${Math.round(s.data.grillProgress || 0)}%)`;
            foundInteract = { structure: s, action: 'grilling' };
            break;
          } else {
            foundInteract = { structure: s, action: 'place_food' };
            promptText = '[Left-Click] Auto-Roast Fish or Potato on Grill';
            break;
          }
        } else if (s.type === 'crop_plot') {
          if (s.data?.cropPlanted && (s.data.cropGrowProgress || 0) >= 100) {
            foundInteract = { structure: s, action: 'harvest_crop' };
            promptText = '[Left-Click] Harvest Ripe Potatoes';
            break;
          } else if (!s.data?.cropPlanted) {
            foundInteract = { structure: s, action: 'plant_crop' };
            promptText = '[Left-Click] Plant Potato in Crop Plot';
            break;
          } else {
            promptText = `Crop Growing... (${Math.round(s.data.cropGrowProgress || 0)}%)`;
            foundInteract = { structure: s, action: 'growing' };
            break;
          }
        } else if (s.type === 'collection_net' && (s.data?.trappedItems?.length || 0) > 0) {
          foundInteract = { structure: s, action: 'collect_net' };
          promptText = `[Left-Click] Collect ${s.data!.trappedItems!.length} Trapped Item(s)`;
          break;
        } else if (s.type === 'sail') {
          foundInteract = { structure: s, action: 'toggle_sail' };
          promptText = s.data?.sailOpen ? '[Left-Click] Furl the Sail' : '[Left-Click] Unfurl the Sail';
          break;
        } else if (s.type === 'chest') {
          foundInteract = { structure: s, action: 'open_chest' };
          promptText = '[Left-Click] Open Storage Chest';
          break;
        } else if (s.type === 'bed') {
          foundInteract = { structure: s, action: 'sleep_bed' };
          promptText = '[Left-Click] Sleep Until Morning';
          break;
        }
      }
    }

    // Check nearby floating shark meat
    if (!promptText && shark.isNearMeat(camera.position)) {
      promptText = 'Walk close or hook to collect Prime Shark Meat!';
    }

    const activeItemId = this.ctx.getActiveItemId();
    if (!promptText && activeItemId === 'cup_empty' && (player.inWater || camera.position.y < 3.0)) {
      promptText = '[Left-Click] Scoop Ocean Saltwater';
    }

    this.aimedInteractable = foundInteract;
    events.emit('interactPromptChanged', promptText);
  }

  // ==================== Click / Interact Resolution ====================

  /**
   * 左键主动作：按优先级短路结算。链路顺序即逻辑——新增可交互物时在
   * 合适的优先级插入一级，而不是往开关里加分支。
   */
  public handlePrimaryClick() {
    const ctx = this.ctx;

    // 1. Build Mode: Place piece or Demolish
    if (ctx.build.isBuildMode) {
      ctx.build.tryPlace();
      return;
    }

    // 2. Left click on raft structures (Grill, Purifier, Crop Plot, Collection Net, Chest)
    const targetStructure = this.aimedInteractable?.structure || ctx.build.getStructureUnderCrosshair();
    if (targetStructure) {
      const handled = ctx.stations.interactWithStructure(targetStructure);
      if (handled) return;
    }

    // 3. Equipped tool primary action — the item→action mapping lives in item
    // definitions (data layer); add a new tool by tagging primaryAction there.
    const activeItemId = ctx.getActiveItemId();
    const action = activeItemId ? ITEM_DEFINITIONS[activeItemId]?.primaryAction : undefined;
    if (action) {
      this.toolActions[action]();
      return;
    }

    // 4. Food & drink consumption — single unified path (also used by HUD
    // auto-consume; previously there was a duplicated eat/drink block)
    ctx.inventory.consumeSlot(false, ctx.inventory.activeHotbarIdx);
  }
}

// ==================== Factory（由 Raft 组合根统一接线） ====================

export function createInteractionSystem(w: WorldView): InteractionSystem {
  return new InteractionSystem({
    camera: w.camera,
    player: () => w.player().localPlayer,
    build: w.build(),
    stations: w.stations(),
    shark: w.shark(),
    hook: w.hook(),
    inventory: w.inventory(),
    canScoopSaltwater: () => w.player().canScoopSaltwater(),
    getActiveItemId: () => {
      const inv = w.inventory();
      return inv.hotbar[inv.activeHotbarIdx]?.itemId ?? null;
    },
  });
}
