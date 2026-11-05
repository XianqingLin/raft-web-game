/**
 * 共享视觉资产：网格尺寸常量与跨模型的通用材质。
 * 各 visuals/*.ts 的构建函数从这里取材，避免每个文件重复定义。
 */
import * as THREE from 'three';

// Standard grid size
export const BLOCK_SIZE = 2.0;
export const BLOCK_HEIGHT = 0.35;
export const WALL_HEIGHT = 2.4;

// Common Shared Materials
const woodColor = 0x9c6631;
const woodDarkColor = 0x5c3a1e;
export const woodPlankMaterial = new THREE.MeshStandardMaterial({
  color: woodColor,
  roughness: 0.85,
  metalness: 0.05,
});

export const darkWoodMaterial = new THREE.MeshStandardMaterial({
  color: woodDarkColor,
  roughness: 0.9,
  metalness: 0.05,
});

export const ironMaterial = new THREE.MeshStandardMaterial({
  color: 0x475569,
  roughness: 0.4,
  metalness: 0.8,
});

export const ropeMaterial = new THREE.MeshStandardMaterial({
  color: 0xd97706,
  roughness: 0.95,
  metalness: 0.0,
});

export const plasticMaterial = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  roughness: 0.3,
  metalness: 0.1,
  transparent: true,
  opacity: 0.85,
});

export const leafMaterial = new THREE.MeshStandardMaterial({
  color: 0x16a34a,
  roughness: 0.6,
  metalness: 0.05,
});

/**
 * 1. RAFT STRUCTURE MODELS
 */

// Foundation Plank Block (4 composite planks + cross tie + side ropes)
