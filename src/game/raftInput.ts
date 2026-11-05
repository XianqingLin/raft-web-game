import type { EngineInputHandler } from './engine/gameEngine';
import { actionsForCode } from './input/bindings';
import { activeActions, type InputContext } from './input/actionMaps';
import { KEY_ACTION_HANDLERS } from './input/handlers';
import type { WorldView } from './worldView';

/**
 * Raft 的原始输入语义：GameEngine 只转发事件，不认识这些玩法决策。
 * 键位在 input/bindings.ts，上下文门控在 input/actionMaps.ts，
 * "按下去发生什么"在 input/handlers.ts。
 */
export class RaftInputHandler implements EngineInputHandler {
  constructor(private view: WorldView) {}

  public onKeyDown(code: string, key: string): void {
    // 每次按键采样上下文：只有落在当前激活动作地图里的动作才分发
    const ctx: InputContext = {
      isPointerLocked: this.view.isPointerLocked(),
      isBuildMode: this.view.build().isBuildMode,
    };
    const active = activeActions(ctx);

    for (const action of actionsForCode(code)) {
      if (active.has(action)) {
        KEY_ACTION_HANDLERS[action]?.(this.view);
      }
    }

    // 数字键按 e.key 匹配，兼容主键盘与小键盘。
    if (key >= '1' && key <= '8') {
      this.view.inventory().setActiveHotbarSlot(parseInt(key, 10) - 1);
    }
  }

  public onKeyUp(code: string): void {
    // 松开语义不受动作地图门控：无论按键期间上下文怎么变化都要复位
    if (actionsForCode(code).includes('jump')) {
      this.view.player().releaseSpace();
    }
  }

  public onMouseMove(dx: number, dy: number): void {
    this.view.player().applyLookDelta(dx, dy);
  }

  public onWheel(deltaY: number): boolean {
    const build = this.view.build();
    if (build.isBuildMode) {
      build.cycleBuildingPiece(deltaY > 0 ? 1 : -1);
      return true;
    }

    const inventory = this.view.inventory();
    const slotCount = inventory.hotbar.length;
    if (deltaY > 0) {
      inventory.setActiveHotbarSlot((inventory.activeHotbarIdx + 1) % slotCount);
    } else if (deltaY < 0) {
      inventory.setActiveHotbarSlot((inventory.activeHotbarIdx - 1 + slotCount) % slotCount);
    }
    return false;
  }

  public onMouseDown(button: number): void {
    if (button === 0) {
      this.view.interaction().handlePrimaryClick();
    } else if (button === 2 && this.view.build().isBuildMode) {
      this.view.build().exitBuildMode();
    }
  }

  public onMouseUp(button: number): void {
    if (button === 0) {
      this.view.hook().releaseThrow();
    }
  }
}
