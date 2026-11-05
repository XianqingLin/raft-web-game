/**
 * playerSurface —— 玩家支撑/碰撞查询（拆分自 build.ts）。
 *
 * 职责：checkOnRaft / checkHorizontalCollision / calculateSurfaceHeight
 * 三个纯查询。不持有状态，structures 与 deckYAt 由 BuildSystem 注入，
 * 所有 y 判定都基于 deckYAt（含筏体倾斜的甲板平面），与浮力渲染一致。
 */

import * as THREE from 'three';
import type { PlacedStructure } from '../../../types/game';
import { BLOCK_SIZE, BLOCK_HEIGHT, WALL_HEIGHT } from '../../visuals/shared';

export interface PlayerSurfaceDeps {
  structures: Map<string, PlacedStructure>;
  hasFoundationAt(gx: number, gz: number): boolean;
  /** 含倾斜的甲板平面高度（RaftBuoyancy.deckYAt） */
  deckYAt(px: number, pz: number): number;
}

/** 玩家是否站在木筏基础甲板上（含 0.4 边距，边缘不算落水） */
export function checkOnRaft(deps: PlayerSurfaceDeps, x: number, z: number): boolean {
  const gx = Math.round(x / BLOCK_SIZE);
  const gz = Math.round(z / BLOCK_SIZE);
  if (deps.hasFoundationAt(gx, gz)) return true;

  // Buffer margin
  const m = 0.4;
  const checks = [
    [x + m, z],
    [x - m, z],
    [x, z + m],
    [x, z - m],
  ];
  return checks.some(([cx, cz]) => {
    const cgx = Math.round(cx / BLOCK_SIZE);
    const cgz = Math.round(cz / BLOCK_SIZE);
    return deps.hasFoundationAt(cgx, cgz);
  });
}

/**
 * Horizontal obstacle collision detection (Walls, Window Walls, Fences, Pillars, Stairs underside).
 * Prevents walking through walls and solid architecture.
 */
export function checkHorizontalCollision(
  deps: PlayerSurfaceDeps,
  newX: number,
  newZ: number,
  playerY: number,
  radius = 0.28
): boolean {
  const feetY = playerY - 1.7;
  const headY = playerY + 0.1;

  for (const s of deps.structures.values()) {
    if (s.type === 'wall' || s.type === 'window_wall' || s.type === 'fence') {
      const obsH = s.type === 'fence' ? 0.95 : WALL_HEIGHT;
      const obsBottom = deps.deckYAt(s.mesh.position.x, s.mesh.position.z) + s.mesh.position.y;
      const obsTop = obsBottom + obsH;

      if (headY > obsBottom && feetY < obsTop) {
        const wx = s.mesh.position.x;
        const wz = s.mesh.position.z;
        const rot = s.rotation % 2; // 0 = horizontal (along X), 1 = vertical (along Z)

        if (rot === 0) {
          const halfW = BLOCK_SIZE / 2;
          const halfT = 0.16;
          if (
            newX >= wx - halfW - radius &&
            newX <= wx + halfW + radius &&
            newZ >= wz - halfT - radius &&
            newZ <= wz + halfT + radius
          ) {
            return true;
          }
        } else {
          const halfW = BLOCK_SIZE / 2;
          const halfT = 0.16;
          if (
            newX >= wx - halfT - radius &&
            newX <= wx + halfT + radius &&
            newZ >= wz - halfW - radius &&
            newZ <= wz + halfW + radius
          ) {
            return true;
          }
        }
      }
    } else if (s.type === 'pillar') {
      const obsBottom = deps.deckYAt(s.mesh.position.x, s.mesh.position.z) + s.mesh.position.y;
      const obsTop = obsBottom + WALL_HEIGHT;
      if (headY > obsBottom && feetY < obsTop) {
        const dx = Math.abs(newX - s.mesh.position.x);
        const dz = Math.abs(newZ - s.mesh.position.z);
        if (dx < 0.14 + radius && dz < 0.14 + radius) {
          return true;
        }
      }
    } else if (s.type === 'stairs') {
      const sx = s.gx * BLOCK_SIZE;
      const sz = s.gz * BLOCK_SIZE;
      const dx = newX - sx;
      const dz = newZ - sz;
      const rotAngle = (s.rotation % 4) * (Math.PI / 2);
      const lx = dx * Math.cos(rotAngle) - dz * Math.sin(rotAngle);
      const lz = dx * Math.sin(rotAngle) + dz * Math.cos(rotAngle);

      // Underside wall of high steps: cannot walk through back underside of stairs
      if (lz > 0.25 && lz <= BLOCK_SIZE * 0.52 && feetY < deps.deckYAt(sx, sz) + BLOCK_HEIGHT / 2 + 0.6) {
        if (Math.abs(lx) <= BLOCK_SIZE * 0.44 + radius) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Exact surface height calculator for Player feet.
 * Seamlessly calculates height across base raft foundations, stairs incline, and second-story upper deck floor.
 */
export function calculateSurfaceHeight(
  deps: PlayerSurfaceDeps,
  px: number,
  py: number,
  pz: number
): number {
  let supportY = -Infinity;
  const feetY = py - 1.7;
  // 甲板高度随木筏浮力起伏 + 倾斜修正（浮力每帧更新 raftGroup 变换）
  const raftY = deps.deckYAt(px, pz);

  // 1. Check Foundation / Base Raft
  if (checkOnRaft(deps, px, pz)) {
    supportY = raftY + BLOCK_HEIGHT / 2;
  }

  // 2. Check Upper Deck Floor (floor)
  for (const s of deps.structures.values()) {
    if (s.type === 'floor') {
      const fx = s.gx * BLOCK_SIZE;
      const fz = s.gz * BLOCK_SIZE;
      const halfSize = BLOCK_SIZE / 2;
      if (Math.abs(px - fx) <= halfSize + 0.15 && Math.abs(pz - fz) <= halfSize + 0.15) {
        const floorTop = raftY + BLOCK_HEIGHT / 2 + WALL_HEIGHT + 0.12;
        if (feetY >= floorTop - 0.75) {
          supportY = Math.max(supportY, floorTop);
        }
      }
    }
  }

  // 3. Check Stairs Incline
  for (const s of deps.structures.values()) {
    if (s.type === 'stairs') {
      const sx = s.gx * BLOCK_SIZE;
      const sz = s.gz * BLOCK_SIZE;
      const dx = px - sx;
      const dz = pz - sz;
      const rotAngle = (s.rotation % 4) * (Math.PI / 2);
      const cosA = Math.cos(rotAngle);
      const sinA = Math.sin(rotAngle);

      const lx = dx * cosA - dz * sinA;
      const lz = dx * sinA + dz * cosA;

      if (Math.abs(lx) <= BLOCK_SIZE * 0.48 && Math.abs(lz) <= BLOCK_SIZE * 0.55) {
        const progress = (lz + BLOCK_SIZE / 2) / BLOCK_SIZE;
        const t = Math.max(0, Math.min(1, progress));
        const stairSurface = raftY + BLOCK_HEIGHT / 2 + t * WALL_HEIGHT;

        if (feetY >= stairSurface - 0.65) {
          supportY = Math.max(supportY, stairSurface);
        }
      }
    }
  }

  if (supportY !== -Infinity) {
    return supportY + 1.7;
  }

  // No solid surface in open ocean water - player sinks into water and swims!
  return -Infinity;
}
