/**
 * InputSystem —— 输入系统（拆分自 engine.ts，split step 11）。
 *
 * 职责：键盘/鼠标原始事件的绑定与生命周期、按键状态表（keys，PlayerSystem
 * 每帧读取）、准星锁定状态的维护。
 *
 * 本系统是纯粹的"翻译层"：把原始 DOM 事件翻译成语义回调（onKeyDown /
 * onMouseDown…），把按键映射到具体系统动作的决策留给 Game（组合根）。
 * 游戏内交互（左键动作、快捷键）只在指针锁定时生效，由本系统统一门控。
 */

export interface InputHandlers {
  /** 按下任意键。code 为 KeyboardEvent.code，key 为 KeyboardEvent.key（数字快捷键用） */
  onKeyDown: (code: string, key: string) => void;
  onKeyUp: (code: string) => void;
  /** 鼠标移动增量（仅在指针锁定时转发） */
  onMouseMove: (dx: number, dy: number) => void;
  /** 滚轮。返回 true 表示已消费（阻止默认滚动行为） */
  onWheel: (deltaY: number) => boolean;
  /** 鼠标按下/抬起（仅在指针锁定时转发）。button: 0=左键 2=右键 */
  onMouseDown: (button: number) => void;
  onMouseUp: (button: number) => void;
}

export class InputSystem {
  /** 按键状态表（code -> 是否按下），供移动系统每帧读取 */
  public keys: Record<string, boolean> = {};
  /** 是否处于指针锁定（Game 对外暴露读写，React 侧 pointerlockchange 时写入） */
  public isPointerLocked = false;

  private handlers: InputHandlers;
  private disposers: Array<() => void> = [];

  constructor(handlers: InputHandlers) {
    this.handlers = handlers;
    this.bind();
  }

  private bind() {
    const onKeyDown = (e: KeyboardEvent) => {
      this.keys[e.code] = true;
      this.handlers.onKeyDown(e.code, e.key);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys[e.code] = false;
      this.handlers.onKeyUp(e.code);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!this.isPointerLocked) return;
      this.handlers.onMouseMove(e.movementX, e.movementY);
    };
    const onWheel = (e: WheelEvent) => {
      if (!this.isPointerLocked) return;
      if (this.handlers.onWheel(e.deltaY)) {
        e.preventDefault();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!this.isPointerLocked) return;
      this.handlers.onMouseDown(e.button);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!this.isPointerLocked) return;
      this.handlers.onMouseUp(e.button);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('wheel', onWheel);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);

    this.disposers = [
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('wheel', onWheel),
      () => window.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
    ];
  }

  public dispose() {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }
}
