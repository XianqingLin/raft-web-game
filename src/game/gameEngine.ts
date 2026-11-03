import * as THREE from 'three';
import { InputSystem } from './input';

/**
 * 引擎委托接口：GameEngine 只认识这组回调，不认识任何玩法系统。
 * GameWorld 实现它，在构造时挂接。
 */
export interface EngineDelegate {
  /** 每帧 tick（dt 已钳制到 0.1s 上限）；渲染由引擎在 tick 后自行执行 */
  onFrame(dt: number, elapsed: number): void;
  onKeyDown: (code: string, key: string) => void;
  onKeyUp: (code: string) => void;
  onMouseMove: (dx: number, dy: number) => void;
  /** 滚轮。返回 true 表示已消费（阻止默认滚动行为） */
  onWheel: (deltaY: number) => boolean;
  onMouseDown: (button: number) => void;
  onMouseUp: (button: number) => void;
}

/**
 * GameEngine —— 引擎基础设施层（原 RaftEngine/Game 的底层部分）。
 *
 * 职责：scene/camera/renderer 引导、RAF 主循环与时钟、原始输入绑定
 * （InputSystem）、窗口 resize、渲染提交。
 *
 * 纪律：本层不得出现任何玩法概念（系统、物品、状态机……）。
 * 玩法世界见 GameWorld（gameWorld.ts），它实现 EngineDelegate 消费本层。
 */
export class GameEngine {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public input: InputSystem;

  /** 玩法世界委托（GameWorld 构造时挂接；start 前必须就位） */
  public delegate: EngineDelegate | null = null;

  private frameId: number = 0;
  private clock = new THREE.Clock();
  private running = false;
  private resizeHandler = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);

    // Modern Renderer with Soft Shadows
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    // Raw input binding (semantics decided by the delegate / GameWorld)
    this.input = new InputSystem({
      onKeyDown: (code, key) => this.delegate?.onKeyDown(code, key),
      onKeyUp: (code) => this.delegate?.onKeyUp(code),
      onMouseMove: (dx, dy) => this.delegate?.onMouseMove(dx, dy),
      onWheel: (deltaY) => this.delegate?.onWheel(deltaY) ?? false,
      onMouseDown: (button) => this.delegate?.onMouseDown(button),
      onMouseUp: (button) => this.delegate?.onMouseUp(button),
    });

    window.addEventListener('resize', this.resizeHandler);
  }

  /** 启动主循环（GameWorld 完成系统接线后调用） */
  public start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  private loop = () => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.loop);

    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    this.delegate?.onFrame(dt, elapsed);
    this.renderer.render(this.scene, this.camera);
  };

  public dispose() {
    this.running = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.resizeHandler);
    this.input.dispose();
    this.renderer.dispose();
  }
}
