/**
 * 按键绑定表 —— 游戏内所有键位的唯一出处。
 *
 * 改键、加备用键（如方向键）、加新动作都只改这一个文件：
 * - InputSystem 用它做"按住"轮询（isDown）与浏览器默认行为拦截；
 * - RaftInputHandler 用它做"单次按下"分发（actionsForCode 反查动作）。
 *
 * 约定：
 * - 值是 KeyboardEvent.code 列表，一个动作可绑多键（任一按下即触发）；
 * - 移动/跳跃这类"持续按住"的动作由 PlayerSystem 每帧轮询 isDown；
 * - 交互/开关面板这类"单次按下"的动作由 RaftInputHandler 在 onKeyDown 里分发，
 *   OS 连发（e.repeat）由 InputSystem 统一过滤；
 * - 热栏数字键 1-8 不在本表：按 e.key 字符匹配（兼容主键盘与小键盘），
 *   见 raftInput.ts。
 */
export type GameAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'toggleInventory'
  | 'toggleBuild'
  | 'rotatePiece'
  | 'toggleDemolish'
  | 'toggleOceanDebug';

export const KEY_BINDINGS: Record<GameAction, string[]> = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBackward: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  toggleInventory: ['KeyI', 'Tab'],
  toggleBuild: ['KeyB'],
  rotatePiece: ['KeyR'],
  toggleDemolish: ['KeyX'],
  toggleOceanDebug: ['Backquote'],
};

// code -> actions 反查表（模块加载时构建一次，运行期只读）
const CODE_TO_ACTIONS: ReadonlyMap<string, GameAction[]> = (() => {
  const map = new Map<string, GameAction[]>();
  for (const [action, codes] of Object.entries(KEY_BINDINGS) as [GameAction, string[]][]) {
    for (const code of codes) {
      const list = map.get(code);
      if (list) list.push(action);
      else map.set(code, [action]);
    }
  }
  return map;
})();

/** 该 code 绑定了哪些动作（未绑定的键返回空数组） */
export function actionsForCode(code: string): readonly GameAction[] {
  return CODE_TO_ACTIONS.get(code) ?? [];
}

/** 该 code 是否绑定了任意动作（InputSystem 据此决定是否 preventDefault） */
export function isBoundKey(code: string): boolean {
  return CODE_TO_ACTIONS.has(code);
}
