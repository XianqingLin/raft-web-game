import type { WorldView } from '../worldView';
import * as THREE from 'three';
import { ItemId, PlacedStructure, ToolActionKind } from '../../types/game';
import { ITEM_DEFINITIONS } from '../../data/items';
import { BuildSystem } from './build';
import { PlayerState } from '../entities/player';
import { FishingSystem } from './fishing';
import { HookSystem } from './hook';
import { InventorySystem } from './inventory';
import { IslandManager, IslandResource } from '../environment/islands';
import { SharkSystem } from './shark';
import { StationSystem } from './stations';
import { MerchantSystem } from './merchant';

/**
 * InteractionSystem —— 交互系统（拆分自 engine.ts，split step 9）。
 *
 * 职责：准星射线检测（木筏站点/岛屿资源/商人筏/漂浮鲨鱼肉）、上下文
 * 提示文案生成、aimed 状态维护；以及点击/交互键的动作结算——左键
 * 优先级链与工具主动作执行表原属旧世界门面，后迁入本系统：aimed
 * 感知与"点下去发生什么"是同一关注点。
 */

export interface AimedInteractable {
  structure: PlacedStructure;
  action: string;
}

export interface InteractionContext {
  camera: THREE.PerspectiveCamera;
  player: PlayerState;
  build: BuildSystem;
  stations: StationSystem;
  fishing: FishingSystem;
  shark: SharkSystem;
  islands: IslandManager;
  /** 漂流商人筏管理器（实体集合，近距离判定遍历它） */
  merchant: MerchantSystem;
  /** 钩索系统（工具主动作：投掷钩索） */
  hook: HookSystem;
  /** 背包系统（资源入包、进食/喝水统一入口） */
  inventory: InventorySystem;
  /** 是否处于可取水位置（空杯舀海水的条件判定，规则在 PlayerSystem） */
  canScoopSaltwater: () => boolean;
  /** 当前手持物品 id（鱼竿/水杯的提示分支与工具主动作分发用） */
  getActiveItemId: () => ItemId | null;
  onInteractPrompt: (prompt: string | null) => void;
  /** 打开商人面板（React 侧回调） */
  onOpenMerchant: () => void;
  /** 提示气泡（岛屿资源收获反馈） */
  toast: (text: string, color?: string) => void;
}

import { Tickable } from '../lifecycle';

export class InteractionSystem implements Tickable {
  /** 准星命中的可交互站点与动作 */
  public aimedInteractable: AimedInteractable | null = null;
  /** 准星命中的可采集岛屿资源 */
  public aimedIslandResource: IslandResource | null = null;
  /** 是否面向商人筏（近距离判定） */
  public aimedMerchant: boolean = false;

  private ctx: InteractionContext;
  private raycaster = new THREE.Raycaster();
  /** 工具主动作 → 系统调用的执行表（物品→动作的映射在 data/items.ts） */
  private toolActions: Record<ToolActionKind, () => void>;

  constructor(ctx: InteractionContext) {
    this.ctx = ctx;
    this.toolActions = {
      throw_hook: () => {
        ctx.hook.chargeStart();
        ctx.hook.reelClick();
      },
      cast_fishing_rod: () => ctx.fishing.onPrimaryAction(),
      spear_thrust: () => ctx.shark.spearThrust(ctx.hook.toolModel),
      scoop_saltwater: () => {
        // Water-source condition in PlayerSystem, consumption in inventory
        if (ctx.canScoopSaltwater()) {
          ctx.inventory.fillCupWithSaltwater();
        }
      },
    };
  }

  /** 采集命中资源后清除瞄准状态（避免同一资源连续触发） */
  public clearIslandAim() {
    this.aimedIslandResource = null;
  }

  /** 每帧：重算三条瞄准线（站点/商人/岛屿资源）并推送提示文案 */
  public update() {
    const { camera, player, build, stations, fishing, shark, islands } = this.ctx;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
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
            const willEat = player.stats.hunger < 95;
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
          promptText = `[Left-Click / E] Open Debris Compactor (${stations.compactorLoadedJunk}/10 Junk Loaded)`;
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
    if (!promptText) {
      const nearMerchant = this.ctx.merchant.merchants.some(
        (m) => camera.position.distanceTo(m.group.position) < 6.8
      );
      this.aimedMerchant = nearMerchant;
      if (nearMerchant) {
        promptText = '[Left-Click / E] Trade with Drifting Scavenger Merchant';
      }
    } else {
      this.aimedMerchant = false;
    }

    // Check nearby floating shark meat
    if (!promptText && shark.isNearMeat(camera.position)) {
      promptText = 'Walk close or hook to collect Prime Shark Meat!';
    }

    // Check fishing rod state prompt if not aiming at structure
    const activeItemId = this.ctx.getActiveItemId();
    if (!promptText && activeItemId === 'fishing_rod') {
      if (fishing.state === 'IDLE') {
        promptText = '[Left-Click] Cast Fishing Line into Ocean';
      } else if (fishing.state === 'WAITING') {
        promptText = 'Waiting for fish... [Left-Click] Reel In';
      } else if (fishing.state === 'APPROACHING') {
        promptText = '🐟 Fish approaching bobber! [Get Ready...]';
      } else if (fishing.state === 'BITING') {
        promptText = '💥 BITE! CLICK NOW TO REEL IN! 💥';
      } else if (fishing.state === 'REELING') {
        promptText = 'Reeling in line...';
      }
    }

    if (!promptText && activeItemId === 'cup_empty' && (player.inWater || camera.position.y < 3.0)) {
      promptText = '[Left-Click / E] Scoop Ocean Saltwater';
    }

    // Check Explorable Island Resources (Coconuts, Driftwood, Loose Stones, Berries, Nests)
    const islandRes = islands.checkResourceInteract(this.raycaster, camera.position);
    if (islandRes) {
      this.aimedIslandResource = islandRes;
      promptText = islandRes.prompt;
    } else {
      this.aimedIslandResource = null;
    }

    this.aimedInteractable = foundInteract;
    this.ctx.onInteractPrompt(promptText);
  }

  // ==================== Click / Interact Resolution ====================

  /** 交互键 [E]：目前只用于商人筏面板 */
  public handleInteractKey() {
    if (this.aimedMerchant) {
      this.ctx.onOpenMerchant();
    }
  }

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

    // 2. Check Merchant interaction
    if (this.aimedMerchant) {
      ctx.onOpenMerchant();
      return;
    }

    // 3. Left click on harvestable island resource
    if (this.aimedIslandResource) {
      const res = this.aimedIslandResource;
      const ok = ctx.islands.harvestResource(
        res,
        (id, count) => ctx.inventory.addItemToInventory(id, count),
        ctx.toast
      );
      if (ok) {
        this.clearIslandAim();
        return;
      }
    }

    // 4. Left click on raft structures (Grill, Purifier, Crop Plot, Collection Net, Chest, Compactor, Receiver)
    const targetStructure = this.aimedInteractable?.structure || ctx.build.getStructureUnderCrosshair();
    if (targetStructure) {
      const handled = ctx.stations.interactWithStructure(targetStructure);
      if (handled) return;
    }

    // 5. Equipped tool primary action — the item→action mapping lives in item
    // definitions (data layer); add a new tool by tagging primaryAction there.
    const activeItemId = ctx.getActiveItemId();
    const action = activeItemId ? ITEM_DEFINITIONS[activeItemId]?.primaryAction : undefined;
    if (action) {
      this.toolActions[action]();
      return;
    }

    // 6. Food & drink consumption — single unified path (also used by HUD
    // auto-consume; previously there was a duplicated eat/drink block)
    ctx.inventory.consumeSlot(false, ctx.inventory.activeHotbarIdx);
  }
}

// ==================== Factory（由 Raft 组合根统一接线） ====================

export function createInteractionSystem(w: WorldView): InteractionSystem {
  return new InteractionSystem({
    camera: w.camera,
    player: w.player().localPlayer,
    build: w.build(),
    stations: w.stations(),
    fishing: w.fishing(),
    shark: w.shark(),
    islands: w.islands(),
    merchant: w.merchant(),
    hook: w.hook(),
    inventory: w.inventory(),
    canScoopSaltwater: () => w.player().canScoopSaltwater(),
    getActiveItemId: () => {
      const inv = w.inventory();
      return inv.hotbar[inv.activeHotbarIdx]?.itemId ?? null;
    },
    onInteractPrompt: (prompt) => w.ui.onInteractPrompt(prompt),
    onOpenMerchant: () => w.ui.onOpenMerchant?.(),
    toast: (text, color) => w.toast(text, color),
  });
}
