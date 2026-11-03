import type { WorldView } from '../worldView';
import * as THREE from 'three';
import { ItemId, PlacedStructure } from '../../types/game';
import { BuildSystem } from './build';
import { PlayerState } from '../context';
import { FishingSystem } from './fishing';
import { IslandManager, IslandResource } from '../environment/islands';
import { SharkSystem } from './shark';
import { StationSystem } from './stations';

/**
 * InteractionSystem —— 交互射线系统（拆分自 engine.ts，split step 9）。
 *
 * 职责：准星射线检测（木筏站点/岛屿资源/商人筏/漂浮鲨鱼肉）、
 * 上下文提示文案生成、aimed 状态维护。
 *
 * 本系统是只读的"感知层"：只负责探测与提示，实际的交互动作
 * （收获/开箱/购买…）由 Game 把 aimed 结果分发给对应系统执行。
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
  /** 漂流商人筏（Game 创建并持有） */
  merchantRaftGroup: THREE.Group;
  /** 当前手持物品 id（鱼竿/水杯的提示分支用） */
  getActiveItemId: () => ItemId | null;
  onInteractPrompt: (prompt: string | null) => void;
}

export class InteractionSystem {
  /** 准星命中的可交互站点与动作 */
  public aimedInteractable: AimedInteractable | null = null;
  /** 准星命中的可采集岛屿资源 */
  public aimedIslandResource: IslandResource | null = null;
  /** 是否面向商人筏（近距离判定） */
  public aimedMerchant: boolean = false;

  private ctx: InteractionContext;
  private raycaster = new THREE.Raycaster();

  constructor(ctx: InteractionContext) {
    this.ctx = ctx;
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
    if (!promptText && this.ctx.merchantRaftGroup) {
      const distToMerchant = camera.position.distanceTo(this.ctx.merchantRaftGroup.position);
      if (distToMerchant < 6.8) {
        this.aimedMerchant = true;
        promptText = '[Left-Click / E] Trade with Drifting Scavenger Merchant';
      } else {
        this.aimedMerchant = false;
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
}

// ==================== Factory（依赖接线集中于此，GameWorld 一行调用） ====================

export function createInteractionSystem(w: WorldView): InteractionSystem {
  return new InteractionSystem({
    camera: w.camera,
    player: w.player().player,
    build: w.build(),
    stations: w.stations(),
    fishing: w.fishing(),
    shark: w.shark(),
    islands: w.islands(),
    merchantRaftGroup: w.merchantRaft(),
    getActiveItemId: () => {
      const inv = w.inventory();
      return inv.hotbar[inv.activeHotbarIdx]?.itemId ?? null;
    },
    onInteractPrompt: (prompt) => w.ui.onInteractPrompt(prompt),
  });
}
