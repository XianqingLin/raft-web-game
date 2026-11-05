/**
 * 键位绑定表 —— 游戏内所有键位的唯一出处（玩法层，Unity Input System 轻量版）。
 *
 * 每个动作 = 绑定键码 + 动作类型：
 * - value：持续按住的动作（移动/跳跃），由 PlayerSystem 每帧轮询 isActionDown；
 * - button：单次按下的动作（交互/开关面板），由 RaftInputHandler 在 onKeyDown
 *   里分发，OS 连发（e.repeat）由 InputSystem 统一过滤。
 *
 * 配套文件：
 * - 动作在哪些上下文生效见 actionMaps.ts；
 * - button 动作触发什么见 handlers.ts；
 * - engine 只拿到"动作名 → 键码"的泛型映射（engineInputBindings），
 *   不认识任何具体动作语义。
 *
 * 约定：
 * - codes 是 KeyboardEvent.code 列表，一个动作可绑多键（任一按下即触发）；
 * - 热栏数字键 1-8 不在本表：按 e.key 字符匹配（兼容主键盘与小键盘），
 *   见 raftInput.ts。
 */

export type InputActionType = 'value' | 'button';

export const KEY_BINDINGS = {
  moveForward: { type: 'value', codes: ['KeyW', 'ArrowUp'] },
  moveBackward: { type: 'value', codes: ['KeyS', 'ArrowDown'] },
  moveLeft: { type: 'value', codes: ['KeyA', 'ArrowLeft'] },
  moveRight: { type: 'value', codes: ['KeyD', 'ArrowRight'] },
  jump: { type: 'value', codes: ['Space'] },
  interact: { type: 'button', codes: ['KeyF'] },
  toggleInventory: { type: 'button', codes: ['KeyI', 'Tab'] },
  toggleBuild: { type: 'button', codes: ['KeyB'] },
  rotatePiece: { type: 'button', codes: ['KeyR'] },
  toggleDemolish: { type: 'button', codes: ['KeyX'] },
  toggleOceanDebug: { type: 'button', codes: ['Backquote'] },
} as const satisfies Record<string, { type: InputActionType; codes: readonly string[] }>;

/** 动作名由键位表派生：加动作只改 KEY_BINDINGS 一处 */
export type GameAction = keyof typeof KEY_BINDINGS;
export type InputActionDef = (typeof KEY_BINDINGS)[GameAction];

// code -> actions 反查表（模块加载时构建一次，运行期只读）
const CODE_TO_ACTIONS: ReadonlyMap<string, GameAction[]> = (() => {
  const map = new Map<string, GameAction[]>();
  for (const [action, def] of Object.entries(KEY_BINDINGS) as [GameAction, InputActionDef][]) {
    for (const code of def.codes) {
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

/** 给 engine 的泛型注入：动作名 → 键码（engine 不理解动作语义与类型） */
export function engineInputBindings(): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const [action, def] of Object.entries(KEY_BINDINGS) as [GameAction, InputActionDef][]) {
    out[action] = def.codes;
  }
  return out;
}
