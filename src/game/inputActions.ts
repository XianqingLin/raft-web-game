import type { WorldView } from './worldView';
import type { GameAction } from './engine/inputMap';

/**
 * 快捷键动作 -> 处理器（玩法层路由表，与 InteractionSystem 的 toolActions
 * 表同风格）。
 *
 * 加一个快捷键 = engine/inputMap.ts 加键位 + 这里加一行，引擎与 RaftGame 门面不用动。
 * moveForward/moveBackward/moveLeft/moveRight/jump 是"持续按住"的动作，
 * 由 PlayerSystem 每帧轮询 isActionDown，不进本表。
 */
export const KEY_ACTION_HANDLERS: Partial<Record<GameAction, (w: WorldView) => void>> = {
  toggleInventory: (w) => w.ui.onToggleInventory?.(),
  toggleBuild: (w) => w.build().toggleBuildMode(),
  rotatePiece: (w) => {
    if (w.build().isBuildMode) {
      w.build().rotatePiece();
    }
  },
  toggleDemolish: (w) => {
    if (w.build().isBuildMode) {
      w.build().toggleDemolishMode();
    }
  },
};
