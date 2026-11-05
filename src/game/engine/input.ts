/**
 * InputSystem —— 输入系统（通用引擎层）。
 *
 * 职责：键盘/鼠标原始事件的绑定与生命周期、按键状态表（keys，供"按住"
 * 动作每帧轮询）、动作级轮询（isDown）、准星锁定状态的维护。另负责两类
 * 健壮性：窗口失焦/切后台时清空按键（否则 keyup 丢失、角色粘滞移动），
 * 以及过滤 OS 按住连发（e.repeat）。
 *
 * 本系统是纯粹的"翻译层"：把原始 DOM 事件翻译成语义回调（onKeyDown /
 * onMouseDown…）。键位绑定（动作名 → 键码）由宿主应用在构造时注入
 * （InputBindings），engine 不认识任何具体动作语义；"动作在哪些上下文
 * 生效、触发什么"由玩法层的 action maps / handlers 决定。指针敏感的
 * 鼠标事件（移动/滚轮/点击）在本系统统一门控，键盘动作的上下文门控
 * 归玩法层。
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

/** 宿主应用注入的键位配置：动作名 → 绑定键码列表（engine 只做泛型查找） */
export type InputBindings = Readonly<Record<string, readonly string[]>>;

export class InputSystem {
  /** 按键状态表（code -> 是否按下），供移动系统每帧读取 */
  public keys: Record<string, boolean> = {};
  /** 鼠标按键状态（button -> 是否按下），供划桨等"按住"逻辑每帧轮询 */
  private mouseButtons: Record<number, boolean> = {};
  /** 是否处于指针锁定（Game 对外暴露读写，React 侧 pointerlockchange 时写入） */
  public isPointerLocked = false;

  private bindings: InputBindings;
  /** 绑定键码全集（preventDefault 判定用，构造时算一次） */
  private boundCodes: ReadonlySet<string>;

  /** 动作是否处于按住状态（任一绑定键按下即为真）；供移动系统每帧轮询 */
  public isDown(action: string): boolean {
    return this.bindings[action]?.some((code) => this.keys[code]) ?? false;
  }

  /** 鼠标按键是否处于按住状态（0=左键 2=右键） */
  public isMouseDown(button: number): boolean {
    return this.mouseButtons[button] ?? false;
  }

  private handlers: InputHandlers;
  private disposers: Array<() => void> = [];

  constructor(handlers: InputHandlers, bindings: InputBindings) {
    this.handlers = handlers;
    this.bindings = bindings;
    this.boundCodes = new Set(Object.values(bindings).flat());
    this.bind();
  }

  private bind() {
    const onKeyDown = (e: KeyboardEvent) => {
      // 输入框/文本域里打字不触发游戏键位（模态框内表单等场景）
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // OS 按住连发（e.repeat）不重复触发"单次按下"动作
      if (e.repeat) return;
      this.keys[e.code] = true;
      // 游戏键拦截浏览器默认行为（Tab 切焦点、Space 滚动页面）
      if (this.boundCodes.has(e.code)) e.preventDefault();
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
      // 按住状态在指针锁定门外就记录：松开可能发生在解锁后（如弹窗点按），状态必须能复位
      this.mouseButtons[e.button] = true;
      if (!this.isPointerLocked) return;
      this.handlers.onMouseDown(e.button);
    };
    const onMouseUp = (e: MouseEvent) => {
      this.mouseButtons[e.button] = false;
      if (!this.isPointerLocked) return;
      this.handlers.onMouseUp(e.button);
    };

    // 失焦/切后台时 keyup 会丢失，按键状态表会残留"按住"——角色粘滞移动。
    // 清表并对每个已按下的键补发 onKeyUp，让依赖"松开"语义的逻辑（如跳跃
    // 去重标记）同步复位。
    const clearAllKeys = () => {
      for (const code of Object.keys(this.keys)) {
        if (this.keys[code]) {
          this.keys[code] = false;
          this.handlers.onKeyUp(code);
        }
      }
      this.mouseButtons = {};
    };
    const onBlur = () => clearAllKeys();
    const onVisibilityChange = () => {
      if (document.hidden) clearAllKeys();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('wheel', onWheel);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);

    this.disposers = [
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('wheel', onWheel),
      () => window.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => window.removeEventListener('blur', onBlur),
      () => document.removeEventListener('visibilitychange', onVisibilityChange),
    ];
  }

  public dispose() {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }
}
