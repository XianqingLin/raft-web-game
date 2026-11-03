/**
 * PlayerSystem —— 玩家系统（拆分自 engine.ts，split step 4）。
 *
 * 职责：player 状态对象的所有权、移动物理（行走/跳跃/游泳/爬上岸/重力/浮力）、
 * 二层天花板碰撞、生存数值衰减（口渴/饥饿/回血/死亡）、重生。
 *
 * 通信约定：死亡/重生提示走事件总线 core/events.ts；UI 数值刷新通过
 * ctx.onStatsChange（后续迁 zustand 时移除）。
 */

import * as THREE from 'three';
import { PlayerStats } from '../types/game';
import { BLOCK_SIZE, BLOCK_HEIGHT, WALL_HEIGHT } from './models';
import { soundManager } from '../audio/soundManager';
import { events } from '../core/events';
import { BuildSystem } from './build';

export interface PlayerSystemContext {
  camera: THREE.PerspectiveCamera;
  build: () => BuildSystem;
  /** 岛屿地形高度（脚下高度判定用） */
  getIslandHeight: (x: number, z: number) => number;
  keys: Record<string, boolean>;
  getPointerLocked: () => boolean;
  onStatsChange: (stats: PlayerStats) => void;
}

export class PlayerSystem {
  public player = {
    pos: new THREE.Vector3(0, BLOCK_HEIGHT / 2 + 1.7, 0),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    speed: 6.2,
    onGround: true,
    inWater: false,
    /** 玩家在水中持续时长（shark 系统用于水中袭击判定） */
    waterTime: 0,
    stats: {
      health: 100,
      maxHealth: 100,
      hunger: 90,
      maxHunger: 100,
      thirst: 90,
      maxThirst: 100,
      isDead: false,
    } as PlayerStats,
  };

  private ctx: PlayerSystemContext;
  private spaceKeyHandled = false;
  private statsPushTimer = 0;

  constructor(ctx: PlayerSystemContext) {
    this.ctx = ctx;
  }

  // ==================== Movement & Physics ====================

  /**
   * 每帧调用：视角同步、WASD 移动与碰撞、跳跃/游泳/爬岸、重力与浮力、
   * 二层天花板碰撞，最后把相机对齐到玩家眼睛位置。
   */
  public update(dt: number, elapsed: number) {
    const player = this.player;

    // Input-driven movement (only while pointer locked & alive)
    if (this.ctx.getPointerLocked() && !player.stats.isDead) {
      this.ctx.camera.rotation.order = 'YXZ';
      this.ctx.camera.rotation.y = player.yaw;
      this.ctx.camera.rotation.x = player.pitch;

      const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);

      const move = new THREE.Vector3();
      if (this.ctx.keys.KeyW) move.add(fwd);
      if (this.ctx.keys.KeyS) move.sub(fwd);
      if (this.ctx.keys.KeyD) move.add(right);
      if (this.ctx.keys.KeyA) move.sub(right);
      if (move.lengthSq() > 0) move.normalize();

      const standingOnRaft = this.ctx.build().checkOnRaft(player.pos.x, player.pos.z);
      const islandH = this.ctx.getIslandHeight(player.pos.x, player.pos.z);
      const onIsland = islandH > 0.15;
      const targetEyeY = this.ctx.build().calculateSurfaceHeight(player.pos.x, player.pos.y, player.pos.z, elapsed);
      const isSolidGround = targetEyeY !== -Infinity;
      const waterSurfaceEyeY = 0.65 + Math.sin(elapsed * 2.5) * 0.08;

      // Physically in water ONLY when not on solid ground/island and near or below water surface
      player.inWater = !isSolidGround && !onIsland && player.pos.y <= waterSurfaceEyeY + 0.25;

      const speed = player.inWater ? player.speed * 0.42 : player.speed;
      const nextX = player.pos.x + move.x * speed * dt;
      const nextZ = player.pos.z + move.z * speed * dt;

      // Obstacle collision against walls, window walls, pillars, and architecture
      if (!this.ctx.build().checkHorizontalCollision(nextX, player.pos.z, player.pos.y)) {
        player.pos.x = nextX;
      }
      if (!this.ctx.build().checkHorizontalCollision(player.pos.x, nextZ, player.pos.y)) {
        player.pos.z = nextZ;
      }

      // Jump (when on solid ground) or swim up/climb onto raft (when in water)
      if (this.ctx.keys.Space && player.onGround && isSolidGround) {
        if (!this.spaceKeyHandled) {
          player.vel.y = 5.8;
          player.onGround = false;
          this.spaceKeyHandled = true;
        }
      } else if (player.inWater) {
        // In ocean: holding Space swims upwards towards the surface (capped at water surface, never into the air!)
        if (this.ctx.keys.Space) {
          if (player.pos.y < waterSurfaceEyeY - 0.05) {
            player.vel.y = Math.min(2.6, player.vel.y + 14 * dt);
            if (Math.random() < 0.06) soundManager.playWaterSplash(0.35);
          } else {
            // At water surface: clamp upward velocity so player bobs at surface and cannot fly into the air
            player.vel.y = Math.min(0.4, player.vel.y);
          }
        }
        // Climb smoothly out of water onto raft or island (ONLY allowed when player is at the waterline near the edge)
        const canClimb = (standingOnRaft || onIsland) && player.pos.y >= 0.15 && player.pos.y <= 1.25;
        if (canClimb && (this.ctx.keys.Space || move.lengthSq() > 0)) {
          player.vel.y = 4.8;
          player.inWater = false;
          soundManager.playWaterSplash(0.6);
        }
      }
    }

    // Gravity & Ground Height (Foundations, Stairs, Upper Deck)
    const targetFloorY = this.ctx.build().calculateSurfaceHeight(player.pos.x, player.pos.y, player.pos.z, elapsed);
    const waterSurfaceEyeY = 0.65 + Math.sin(elapsed * 2.5) * 0.08;

    // Ceiling bump check when jumping under second-story upper deck floor
    for (const s of this.ctx.build().structures.values()) {
      if (s.type === 'floor') {
        const fx = s.gx * BLOCK_SIZE;
        const fz = s.gz * BLOCK_SIZE;
        if (Math.abs(player.pos.x - fx) <= BLOCK_SIZE / 2 && Math.abs(player.pos.z - fz) <= BLOCK_SIZE / 2) {
          const ceilingY = BLOCK_HEIGHT / 2 + WALL_HEIGHT;
          if (player.pos.y + 0.15 > ceilingY && player.pos.y - 1.7 < ceilingY - 0.4) {
            player.pos.y = ceilingY - 0.15;
            player.vel.y = 0;
          }
        }
      }
    }

    if (targetFloorY !== -Infinity) {
      // Solid ground physics (on raft foundation, stairs, upper floor, or island)
      player.inWater = false;
      player.vel.y -= 18.0 * dt;
      player.pos.y += player.vel.y * dt;

      if (player.pos.y <= targetFloorY) {
        player.pos.y = targetFloorY;
        player.vel.y = 0;
        player.onGround = true;
      } else if (player.pos.y > targetFloorY + 0.1) {
        player.onGround = false;
      }
    } else {
      // Not on solid ground
      if (player.pos.y > waterSurfaceEyeY + 0.25) {
        // Airborne in freefall: full gravity pulling down, no water drag, no swim upward acceleration
        player.onGround = false;
        player.inWater = false;
        player.vel.y -= 18.0 * dt;
        player.pos.y += player.vel.y * dt;
      } else {
        // IN OCEAN WATER - SWIMMING (CANNOT WALK ON WATER)
        player.onGround = false;
        player.inWater = true;

        // Realistic water buoyancy:
        // Player bobs naturally at water surface (eye level ~0.65 with wave motion)
        const depth = waterSurfaceEyeY - player.pos.y;

        if (depth > 0) {
          // Submerged: buoyant force pushes player up towards surface
          player.vel.y += (depth * 22 - player.vel.y * 5.5) * dt;
        } else {
          // Floating at surface or dropping in: gravity with water drag
          player.vel.y -= 9 * dt;
          player.vel.y *= Math.max(0, 1 - dt * 3.5);
        }
        player.pos.y += player.vel.y * dt;
      }
    }

    this.ctx.camera.position.copy(player.pos);
  }

  // ==================== Survival ====================

  /** 生存数值衰减：口渴/饥饿递减、营养良好时回血、归零掉血、死亡触发 */
  public updateSurvival(dt: number) {
    const stats = this.player.stats;
    if (stats.isDead) return;

    // Thirst decays ~1 every 6s, Hunger decays ~1 every 9s
    stats.thirst = Math.max(0, stats.thirst - dt * 0.16);
    stats.hunger = Math.max(0, stats.hunger - dt * 0.11);

    // Natural regeneration if well nourished
    if (stats.thirst > 80 && stats.hunger > 80 && stats.health < 100) {
      stats.health = Math.min(100, stats.health + dt * 0.8);
    }

    // Starvation / Dehydration damage
    if (stats.thirst <= 0 || stats.hunger <= 0) {
      stats.health = Math.max(0, stats.health - dt * 1.5);
    }

    if (stats.health <= 0) {
      stats.isDead = true;
      events.emit('toast', { text: 'YOU DIED. Respawning on Raft...', color: '#ef4444' });
      setTimeout(() => {
        this.respawnPlayer();
      }, 3000);
    }

    // Push stats to UI at most 4x/sec (event-driven pushes elsewhere stay immediate)
    this.statsPushTimer -= dt;
    if (this.statsPushTimer <= 0) {
      this.statsPushTimer = 0.25;
      this.ctx.onStatsChange({ ...stats });
    }
  }

  public respawnPlayer() {
    const stats = this.player.stats;
    this.player.pos.set(0, BLOCK_HEIGHT / 2 + 1.7, 0);
    this.player.vel.set(0, 0, 0);
    stats.health = 100;
    stats.hunger = 70;
    stats.thirst = 70;
    stats.isDead = false;
    this.ctx.onStatsChange({ ...stats });
    events.emit('toast', { text: 'Respawned safely!', color: '#22c55e' });
  }

  /** Space 键松开（engine 的 keyup 监听转发），用于跳起去重 */
  public releaseSpace() {
    this.spaceKeyHandled = false;
  }
}
