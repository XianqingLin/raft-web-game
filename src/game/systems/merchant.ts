import type { WorldView } from '../worldView';
import * as THREE from 'three';
import { MerchantSpawnDef } from '../../data/worldDefinition';
import { createMerchantRaftMesh } from '../visuals/models';
import { MerchantEntity } from '../entities/merchant';

/**
 * MerchantSystem —— 漂流商人筏管理器（entity-manager 模式）。
 *
 * 实体：MerchantEntity（entities/merchant.ts，场景网格即位置载体）。
 * 基数由 WorldDefinition.merchants 决定——代码不断言"恰好有一艘"。
 * 当前没有每帧行为：商人筏是静态场景实体，因此不进 tick 注册表；
 * 若未来加漂浮/摇摆动画，加 update() 遍历实体集合并 register 即可。
 */
export class MerchantSystem {
  /** 已生成的商人筏实体（InteractionSystem 的近距离判定消费它） */
  public merchants: MerchantEntity[] = [];

  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** 生成一艘商人筏（def 来自 WorldDefinition） */
  public spawn(def: MerchantSpawnDef): MerchantEntity {
    const group = createMerchantRaftMesh();
    group.position.set(...def.position);
    this.scene.add(group);
    const entity: MerchantEntity = { group };
    this.merchants.push(entity);
    return entity;
  }
}

// ==================== Factory（依赖接线集中于此，GameWorld 一行调用） ====================

export function createMerchantSystem(w: WorldView): MerchantSystem {
  const system = new MerchantSystem(w.scene);
  for (const def of w.definition.merchants) {
    system.spawn(def);
  }
  return system;
}
