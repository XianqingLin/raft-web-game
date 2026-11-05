import * as THREE from 'three';
import { InputSystem, type InputBindings } from './input';
import type { Disposable, Tickable } from '../lifecycle';

/** 引擎构造选项：键位绑定由宿主应用注入，engine 不持有任何游戏键位表。 */
export interface EngineOptions {
  inputBindings: InputBindings;
}

/** 通用引擎需要的外部输入语义，不包含任何具体玩法。 */
export interface EngineInputHandler {
  onKeyDown: (code: string, key: string) => void;
  onKeyUp: (code: string) => void;
  onMouseMove: (dx: number, dy: number) => void;
  /** 返回 true 表示已消费（阻止默认滚动行为）。 */
  onWheel: (deltaY: number) => boolean;
  onMouseDown: (button: number) => void;
  onMouseUp: (button: number) => void;
}

/** 引擎只依赖生命周期视图；具体注册表与系统名单由应用组合根决定。 */
export interface EngineSystems {
  tickables(): Tickable[];
  disposables(): Disposable[];
}

export interface EngineModule {
  systems: EngineSystems;
  inputHandler: EngineInputHandler;
}

/**
 * GameEngine —— 通用游戏运行宿主。
 *
 * 负责 renderer/scene/RAF/原始输入，以及已挂载模块的 tick/dispose。
 * 具体系统、输入语义、世界引导和 UI 都由外部应用组合根创建并注入。
 */
export class GameEngine {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public input: InputSystem;

  private module: EngineModule | null = null;
  private frameId = 0;
  private clock = new THREE.Clock();
  private running = false;
  private disposed = false;
  private resizeHandler = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  constructor(container: HTMLElement, options: EngineOptions) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.input = new InputSystem(
      {
        onKeyDown: (code, key) => this.module?.inputHandler.onKeyDown(code, key),
        onKeyUp: (code) => this.module?.inputHandler.onKeyUp(code),
        onMouseMove: (dx, dy) => this.module?.inputHandler.onMouseMove(dx, dy),
        onWheel: (deltaY) => this.module?.inputHandler.onWheel(deltaY) ?? false,
        onMouseDown: (button) => this.module?.inputHandler.onMouseDown(button),
        onMouseUp: (button) => this.module?.inputHandler.onMouseUp(button),
      },
      options.inputBindings,
    );

    window.addEventListener('resize', this.resizeHandler);
  }

  /** 启动前一次性挂载完整模块；不允许运行中替换世界。 */
  public mount(module: EngineModule): void {
    if (this.disposed) throw new Error('GameEngine: cannot mount after dispose');
    if (this.running) throw new Error('GameEngine: cannot replace module while running');
    if (this.module) throw new Error('GameEngine: a module is already mounted');
    this.module = module;
  }

  public start(): void {
    if (this.disposed) throw new Error('GameEngine: cannot start after dispose');
    if (!this.module) throw new Error('GameEngine: mount a module before start');
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  private loop = () => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.loop);

    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    if (this.module) {
      for (const system of this.module.systems.tickables()) {
        system.update(dt, elapsed);
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);

    // 先销毁玩法模块：最后的自动存档仍需读取完整场景状态。
    if (this.module) {
      for (const system of this.module.systems.disposables()) {
        system.dispose();
      }
      this.module = null;
    }

    window.removeEventListener('resize', this.resizeHandler);
    this.input.dispose();
    this.renderer.dispose();
  }
}
