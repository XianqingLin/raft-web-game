/**
 * button 动作 -> 处理器（玩法层路由表，与 InteractionSystem 的 toolActions
 * 表同风格）。上下文门控在 actionMaps.ts，这里只写"做什么"。
 *
 * 加一个快捷键 = bindings.ts 加一条（type: 'button'）+ 这里加一行 +
 * 按需挂进 actionMaps.ts 的对应地图。引擎与 RaftGame 门面不用动。
 * value 动作（移动/跳跃）由 PlayerSystem 每帧轮询 isActionDown，不进本表。
 */

import type { WorldView } from '../worldView';
import type { GameAction } from './bindings';
import { events } from '../../core/events';

export const KEY_ACTION_HANDLERS: Partial<Record<GameAction, (w: WorldView) => void>> = {
  interact: (w) => w.interaction().handleInteract(),
  toggleInventory: () => events.emit('toggleInventoryRequested', undefined),
  toggleBuild: (w) => w.build().toggleBuildMode(),
  rotatePiece: (w) => w.build().rotatePiece(),
  toggleDemolish: (w) => w.build().toggleDemolishMode(),
  toggleOceanDebug: () => events.emit('toggleOceanDebugRequested', undefined),
};
