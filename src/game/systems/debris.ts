import type { WorldView } from '../worldView';
import * as THREE from 'three';
import { ResourceId } from '../../types/game';
import { DebrisObject } from '../entities/debris';
import { createDebrisMesh } from '../visuals/debris';
import { OCEAN_DRIFT_BASE } from '../environment/ocean';
import { Tickable } from '../lifecycle';

/**
 * DebrisSystem —— 漂浮物系统（拆分自 engine.ts，split step 8）。
 *
 * 职责：拥有漂浮物集合、生成
 * （类型/产量/网格）、漂浮漂移与自转、越界回收。
 *
 * 消费方：hook（钩取）与 stations（收集网）通过 items 拿到**同一个活数组**
 * 直接读写（标记 caught、splice 移除）——这是有意的共享可变集合，不是
 * 封装泄漏；如未来要加网络同步，在此处替换为正式的增删 API。
 */

export interface DebrisSystemContext {
  scene: THREE.Scene;
  /** 洋流有效漂移速度（与 hook/shark 同源） */
  getDrift: () => number;
}

const SPAWN_INTERVAL = 3.4;
const MAX_DEBRIS = 15;
const DESPAWN_Z = 58;

export class DebrisSystem implements Tickable {
  private ctx: DebrisSystemContext;
  private spawnTimer = 0;

  /** 漂浮物集合（活数组：hook/stations 直接读写）与自增 id */
  private debris: DebrisObject[] = [];
  private nextDebrisId = 1;

  constructor(ctx: DebrisSystemContext) {
    this.ctx = ctx;
  }

  /** 漂浮物活数组（消费方直接读写：标记 caught / splice 移除） */
  public get items(): DebrisObject[] {
    return this.debris;
  }

  /** 生成一个漂浮物（customZ 为null时在上游远处随机生成） */
  public spawn(customZ: number | null = null) {
    const types: Array<DebrisObject['type']> = ['wood', 'plastic', 'leaf', 'barrel', 'crate', 'scrap', 'stone'];
    const r = Math.random();
    let type: DebrisObject['type'] = 'wood';
    if (r > 0.88) type = 'barrel';
    else if (r > 0.76) type = 'crate';
    else if (r > 0.58) type = 'leaf';
    else if (r > 0.38) type = 'plastic';
    else if (r > 0.22) type = 'scrap';
    else if (r > 0.12) type = 'stone';

    const mesh = createDebrisMesh(type);
    const x = (Math.random() - 0.5) * 44;
    const z = customZ !== null ? customZ : -65 - Math.random() * 30;
    mesh.position.set(x, 0.05, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    this.ctx.scene.add(mesh);

    const yields: Partial<Record<ResourceId, number>> = {};
    if (type === 'wood') yields.wood = 1 + Math.floor(Math.random() * 2);
    else if (type === 'plastic') yields.plastic = 1 + Math.floor(Math.random() * 2);
    else if (type === 'leaf') yields.leaf = 1 + Math.floor(Math.random() * 3);
    else if (type === 'barrel') {
      yields.wood = 1 + Math.floor(Math.random() * 2);
      yields.plastic = 1 + Math.floor(Math.random() * 2);
      yields.scrap = 1;
      if (Math.random() > 0.5) yields.raw_potato = 1;
    } else if (type === 'crate') {
      yields.wood = 2;
      yields.rope = 1;
      yields.stone = 1;
    } else if (type === 'scrap') yields.scrap = 1;
    else if (type === 'stone') yields.stone = 1;

    this.debris.push({
      id: this.nextDebrisId++,
      mesh,
      type,
      caught: false,
      pos: { x, y: 0.05, z },
      bobPhase: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.7,
      yields,
    });
  }

  /** 每帧：按节奏补充漂浮物（上限15），漂移/浮动/自转，越界回收 */
  public update(dt: number, elapsed: number) {
    const debris = this.debris;
    const drift = this.ctx.getDrift();

    this.spawnTimer += dt;
    if (this.spawnTimer > SPAWN_INTERVAL && debris.length < MAX_DEBRIS) {
      this.spawnTimer = 0;
      this.spawn();
    }

    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      if (d.caught) continue;

      d.mesh.position.z += drift * dt;
      d.mesh.position.y = Math.sin(elapsed * 2.2 + d.bobPhase) * 0.05 + 0.02;
      d.mesh.rotation.y += d.rotSpeed * dt;

      if (d.mesh.position.z > DESPAWN_Z) {
        this.ctx.scene.remove(d.mesh);
        debris.splice(i, 1);
      }
    }
  }

  /** 清空所有漂浮物（世界重置/销毁用） */
  public dispose() {
    this.debris.forEach((d) => this.ctx.scene.remove(d.mesh));
    this.debris = [];
  }
}

// ==================== Factory（由 Raft 组合根统一接线） ====================

export function createDebrisSystem(w: WorldView): DebrisSystem {
  return new DebrisSystem({
    scene: w.scene,
    getDrift: () => OCEAN_DRIFT_BASE * w.build().driftSpeedMultiplier,
  });
}
