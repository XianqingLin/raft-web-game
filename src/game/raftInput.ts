import type { EngineInputHandler } from './engine/gameEngine';
import { actionsForCode } from './engine/inputMap';
import { KEY_ACTION_HANDLERS } from './inputActions';
import type { WorldView } from './worldView';

/** Raft 的原始输入语义：GameEngine 只转发事件，不认识这些玩法决策。 */
export class RaftInputHandler implements EngineInputHandler {
  constructor(private view: WorldView) {}

  public onKeyDown(code: string, key: string): void {
    for (const action of actionsForCode(code)) {
      KEY_ACTION_HANDLERS[action]?.(this.view);
    }

    // 数字键按 e.key 匹配，兼容主键盘与小键盘。
    if (key >= '1' && key <= '8') {
      this.view.inventory().setActiveHotbarSlot(parseInt(key, 10) - 1);
    }
  }

  public onKeyUp(code: string): void {
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
