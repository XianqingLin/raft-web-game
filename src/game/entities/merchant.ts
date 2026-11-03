import type * as THREE from 'three';

/**
 * 漂流商人筏实体（entity-manager 模式中的 Entity）——场景网格即位置载体。
 * 由 MerchantSystem 持有集合，基数与位置由 WorldDefinition.merchants 决定。
 */
export interface MerchantEntity {
  group: THREE.Group;
}
