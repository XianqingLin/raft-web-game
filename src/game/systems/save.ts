import type { WorldView } from '../worldView';
import { WorldSaveData, PlayerStats, HotbarSlot, InventorySlot } from '../../types/game';
import type { TimeSystem } from './time';
import { saveWorldLocally, loadWorldLocally, clearWorldLocally } from '../storage';
import { BuildSystem } from './build';
import { InventorySystem } from './inventory';
import { PlayerSystem } from './player';
import { SharkSystem } from './shark';

/**
 * SaveSystem —— 存档系统。
 *
 * 职责：把世界状态序列化为 WorldSaveData 并持久化、从存档恢复各系统、
 * 自动存档节律、页面卸载前的保存。存储后端是 storage.ts（localStorage）。
 *
 * 与 InteractionSystem 同类：构造在所有系统之后、消费所有系统的只读引用。
 * 是否存档/何时清档的"世界级决策"归 RaftGame 与系统编排层，本系统只负责持久化本身。
 */

export interface SaveSystemContext {
  time: TimeSystem;
  build: BuildSystem;
  inventory: InventorySystem;
  player: PlayerSystem;
  shark: SharkSystem;
  definition: {
    worldName: string;
    autoSaveIntervalMs: number;
  };
  callbacks: {
    onToast: (text: string, color?: string) => void;
    onStatsChange: (stats: PlayerStats) => void;
    onHotbarChange: (hotbar: HotbarSlot[], activeIdx: number) => void;
    onInventoryChange: (inventory: InventorySlot[]) => void;
  };
}

export class SaveSystem {
  private ctx: SaveSystemContext;
  private autoSaveTimer: any = null;

  constructor(ctx: SaveSystemContext) {
    this.ctx = ctx;

    // Auto-save cadence + save on page unload
    this.autoSaveTimer = setInterval(() => {
      this.save(false);
    }, ctx.definition.autoSaveIntervalMs);

    window.addEventListener('beforeunload', this.handleBeforeUnload);
  }

  private handleBeforeUnload = () => {
    this.save(false);
  };

  /** 读取最近的本地存档（无存档或无建筑结构时返回 null，由调用方决定新建世界） */
  public loadLatest(): WorldSaveData | null {
    const saved = loadWorldLocally();
    if (saved && Array.isArray(saved.structures) && saved.structures.length > 0) {
      return saved;
    }
    return null;
  }

  public save(notify: boolean = true): WorldSaveData {
    const { time, build, inventory, player, shark, definition } = this.ctx;

    const save: WorldSaveData = {
      version: 2,
      worldName: definition.worldName,
      timestamp: Date.now(),
      dayCount: time.dayCount,
      dayTime: time.dayTime,
      sharkDefeatedOnce: shark.sharkDefeatedOnce,
      sharks: shark.serializeSharks(),
      structures: build.serializeStructures(),
      player: {
        stats: { ...player.localPlayer.stats },
        hotbar: [...inventory.hotbar],
        inventory: [...inventory.inventory],
        pos: { x: player.localPlayer.pos.x, y: player.localPlayer.pos.y, z: player.localPlayer.pos.z },
        yaw: player.localPlayer.yaw,
        pitch: player.localPlayer.pitch,
      },
    };

    saveWorldLocally(save);

    if (notify) {
      this.ctx.callbacks.onToast('💾 World saved successfully!', '#10b981');
    }
    return save;
  }

  /** 把存档应用到各系统并推送 UI 更新 */
  public load(save: WorldSaveData): boolean {
    const { time, build, inventory, player, shark } = this.ctx;
    if (!save || !Array.isArray(save.structures)) return false;

    // Clear existing structures and reconstruct all preserving exact IDs
    build.loadFrom(save.structures);

    time.restore(save.dayTime, save.dayCount);

    if (save.sharkDefeatedOnce !== undefined) {
      shark.setDefeated(save.sharkDefeatedOnce);
    }
    if (Array.isArray(save.sharks)) {
      shark.restoreSharks(save.sharks);
    }

    if (save.player) {
      player.clear();
      player.spawn({
        position: save.player.pos
          ? [save.player.pos.x, save.player.pos.y, save.player.pos.z]
          : undefined,
      });
      if (save.player.hotbar && Array.isArray(save.player.hotbar)) inventory.hotbar = save.player.hotbar;
      if (save.player.inventory && Array.isArray(save.player.inventory)) inventory.inventory = save.player.inventory;
      if (save.player.stats) player.localPlayer.stats = { ...player.localPlayer.stats, ...save.player.stats };
      if (save.player.pos) {
        player.localPlayer.pos.set(save.player.pos.x, save.player.pos.y, save.player.pos.z);
      }
      if (save.player.yaw !== undefined) player.localPlayer.yaw = save.player.yaw;
      if (save.player.pitch !== undefined) player.localPlayer.pitch = save.player.pitch;

      const { callbacks } = this.ctx;
      callbacks.onStatsChange({ ...player.localPlayer.stats });
      callbacks.onHotbarChange([...inventory.hotbar], inventory.activeHotbarIdx);
      callbacks.onInventoryChange([...inventory.inventory]);
    }

    return true;
  }

  /** 清除本地存档（世界重置的持久化部分；世界重建编排归 systems/index.ts） */
  public clear(): void {
    clearWorldLocally();
  }

  public dispose(): void {
    this.save(false);
    if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
  }
}

// ==================== Factory（由 Raft 组合根统一接线） ====================

export function createSaveSystem(w: WorldView): SaveSystem {
  return new SaveSystem({
    time: w.time(),
    build: w.build(),
    inventory: w.inventory(),
    player: w.player(),
    shark: w.shark(),
    definition: {
      worldName: w.definition.worldName,
      autoSaveIntervalMs: w.definition.autoSaveIntervalMs,
    },
    callbacks: {
      onToast: w.toast,
      onStatsChange: (stats) => w.ui.onStatsChange(stats),
      onHotbarChange: (hotbar, activeIdx) => w.ui.onHotbarChange(hotbar, activeIdx),
      onInventoryChange: (inv) => w.ui.onInventoryChange(inv),
    },
  });
}
