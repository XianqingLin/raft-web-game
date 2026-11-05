/**
 * 输入上下文与动作地图（Unity Input System 的 Action Map 轻量版）。
 *
 * 键位"什么时候生效"的唯一出处：RaftInputHandler 每次按键时采样
 * InputContext，只有落在当前激活地图里的动作才会分发到 handlers.ts。
 * 各系统与处理器不再自带 isPointerLocked / isBuildMode 门控。
 *
 * 地图划分：
 * - ui：始终可用（背包/调试面板的开关在暂停、弹窗里也要能按）；
 * - movement：指针锁定时可用（建造模式下同样保持移动与跳跃）；
 * - gameplay：指针锁定且非建造模式（交互、进出建造模式）；
 * - build：指针锁定且建造模式（旋转/拆除；B 仍在两态间切换）。
 */

import type { GameAction } from './bindings';

export interface InputContext {
  /** 指针锁定（游玩中）。未锁定时只有 ui 地图可用。 */
  isPointerLocked: boolean;
  /** 建造模式：gameplay 地图换成 build 地图 */
  isBuildMode: boolean;
}

const UI_ACTIONS: readonly GameAction[] = ['toggleInventory', 'toggleOceanDebug'];
const MOVEMENT_ACTIONS: readonly GameAction[] = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'jump',
];
const GAMEPLAY_ACTIONS: readonly GameAction[] = ['interact', 'toggleBuild'];
const BUILD_ACTIONS: readonly GameAction[] = ['toggleBuild', 'rotatePiece', 'toggleDemolish'];

/** 当前上下文下允许分发的动作集合（每次按键重算，无缓存生命周期问题） */
export function activeActions(ctx: InputContext): ReadonlySet<GameAction> {
  const active = new Set<GameAction>(UI_ACTIONS);
  if (!ctx.isPointerLocked) return active;

  for (const action of MOVEMENT_ACTIONS) active.add(action);
  for (const action of ctx.isBuildMode ? BUILD_ACTIONS : GAMEPLAY_ACTIONS) active.add(action);
  return active;
}
