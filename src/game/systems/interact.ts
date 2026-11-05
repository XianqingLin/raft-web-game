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
 * 职责：木筏站点与漂浮鲨鱼肉的上下文交互提示、aimed 状态维护、
 * F 设施交互，以及左键工具/道具使用动作执行表。
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
    const { camera, build, shark } = this.ctx;
    const player = this.ctx.player();
    let foundInteract: AimedInteractable | null = null;
    let promptText: string | null = null;

    // Only the structure under the crosshair is interactive. Proximity alone
    // must never select a station, especially a tall sail beside the player.
    const s = build.getStructureUnderCrosshair();
    if (s?.type === 'purifier') {
      if (s.data?.purifierFreshWater) {
        foundInteract = { structure: s, action: 'collect_fresh' };
        const willDrink = player.stats.thirst < 95;
        promptText = `[F] ${willDrink ? 'Drink Clean Fresh Water (+Thirst)' : 'Store Clean Water in Cup'}`;
      } else if (s.data?.purifierSaltWater) {
        promptText = `Purifier Distilling Seawater... (${Math.round(s.data.purifierBoilProgress || 0)}%)`;
        foundInteract = { structure: s, action: 'boiling' };
      } else {
        foundInteract = { structure: s, action: 'fill_salt' };
        promptText = '[F] Auto-Boil Seawater in Purifier';
      }
    } else if (s?.type === 'grill') {
      if (s.data?.grillDone) {
        foundInteract = { structure: s, action: 'collect_grilled' };
        const willEat = player.stats.hunger < 95;
        promptText = `[F] ${willEat ? 'Eat Cooked Food (+Hunger & Health)' : 'Store Cooked Food in Inventory'}`;
      } else if (s.data?.grillItem) {
        promptText = `Grill Sizzling Food... (${Math.round(s.data.grillProgress || 0)}%)`;
        foundInteract = { structure: s, action: 'grilling' };
      } else {
        foundInteract = { structure: s, action: 'place_food' };
        promptText = '[F] Auto-Roast Fish or Potato on Grill';
      }
    } else if (s?.type === 'crop_plot') {
      if (s.data?.cropPlanted && (s.data.cropGrowProgress || 0) >= 100) {
        foundInteract = { structure: s, action: 'harvest_crop' };
        promptText = '[F] Harvest Ripe Potatoes';
      } else if (!s.data?.cropPlanted) {
        foundInteract = { structure: s, action: 'plant_crop' };
        promptText = '[F] Plant Potato in Crop Plot';
      } else {
        promptText = `Crop Growing... (${Math.round(s.data.cropGrowProgress || 0)}%)`;
        foundInteract = { structure: s, action: 'growing' };
      }
    } else if (s?.type === 'collection_net' && (s.data?.trappedItems?.length || 0) > 0) {
      foundInteract = { structure: s, action: 'collect_net' };
      promptText = `[F] Collect ${s.data!.trappedItems!.length} Trapped Item(s)`;
    } else if (s?.type === 'sail') {
      foundInteract = { structure: s, action: 'toggle_sail' };
      promptText = s.data?.sailOpen ? '[F] Furl the Sail' : '[F] Unfurl the Sail';
    } else if (s?.type === 'chest') {
      foundInteract = { structure: s, action: 'open_chest' };
      promptText = '[F] Open Storage Chest';
    } else if (s?.type === 'bed') {
      foundInteract = { structure: s, action: 'sleep_bed' };
      promptText = '[F] Sleep Until Morning';
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

  /** F 设施交互：只结算当前准星目标，不回退到附近结构。 */
  public handleInteract() {
    if (this.ctx.build.isBuildMode) return;
    const target = this.aimedInteractable?.structure;
    if (target) this.ctx.stations.interactWithStructure(target);
  }

  /** 左键主动作：建造与手持物品使用；设施交互统一走 F。 */
  public handlePrimaryClick() {
    const ctx = this.ctx;

    // 1. Build Mode: Place piece or Demolish
    if (ctx.build.isBuildMode) {
      ctx.build.tryPlace();
      return;
    }

    // 2. Equipped tool primary action — the item→action mapping lives in item
    // definitions (data layer); add a new tool by tagging primaryAction there.
    const activeItemId = ctx.getActiveItemId();
    const action = activeItemId ? ITEM_DEFINITIONS[activeItemId]?.primaryAction : undefined;
    if (action) {
      this.toolActions[action]();
      return;
    }

    // 3. Food & drink consumption — single unified path (also used by HUD
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
