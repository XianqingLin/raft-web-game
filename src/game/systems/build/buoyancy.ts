/**
 * RaftBuoyancy —— 木筏浮力（拆分自 build.ts）。
 *
 * 职责：每帧根据海面波形更新 raftGroup 的位置与俯仰/横摇，并提供
 * deckYAt（含倾斜的甲板平面高度）供玩家支撑/碰撞查询换算。
 *
 * 与 ocean.ts 的约定：getWaveHeight 是 GPU shader 波形的 CPU 镜像采样，
 * 浮力与渲染共用同一公式，木筏才不会和水面错位。
 */

import * as THREE from 'three';

export class RaftBuoyancy {
  /** 浮力采样点距筏心距离（前后/左右各一点，估算水面坡度） */
  private static readonly BUOY_SAMPLE_DIST = 3;
  /** 基础吃水：甲板基面沉入水面以下的深度（木筏半浸更真实） */
  private static readonly RAFT_SUBMERGE = 0.12;
  /**
   * 倾斜上限（弧度）。放宽到 ~17°：暴风雨坡度可达 ~0.22rad，钳太紧会让
   * 筏体在海面汹涌时显得异常平静（倾斜是筏上唯一的"浪感"视觉信号）。
   * 玩家脚下高度用 deckYAt 精确补偿倾斜，不再依赖小角度近似。
   */
  private static readonly MAX_TILT = 0.3;

  constructor(
    private raftGroup: THREE.Group,
    private getWaveHeight: (x: number, z: number) => number
  ) {}

  /**
   * 含倾斜的甲板平面高度：本地甲板点 (px, 0, pz) 经 Rz→Rx（three Euler 'XYZ'）
   * 后的世界 y。玩家支撑/碰撞按此取值，与筏体实际渲染的倾斜面一致。
   */
  public deckYAt(px: number, pz: number): number {
    const g = this.raftGroup;
    const rx = g.rotation.x;
    const rz = g.rotation.z;
    return g.position.y + px * Math.sin(rz) * Math.cos(rx) - pz * Math.sin(rx);
  }

  /**
   * 每帧：木筏随波起伏与倾斜（浮力）。
   * 高度取筏心水面值，俯仰/横摇由前后/左右采样点高度差推得。
   * 波形是解析函数、天然连续——直接赋值即可；任何平滑都会滞后，
   * 波峰垂直速度可达 ~3m/s，damp(λ=6) 的 0.5m 滞后足以让木筏被波峰淹没。
   */
  public update(_dt: number) {
    const wh = this.getWaveHeight;
    const dist = RaftBuoyancy.BUOY_SAMPLE_DIST;
    const hC = wh(0, 0);
    const hN = wh(0, -dist);
    const hS = wh(0, dist);
    const hW = wh(-dist, 0);
    const hE = wh(dist, 0);

    const g = this.raftGroup;
    g.position.y = hC - RaftBuoyancy.RAFT_SUBMERGE;
    g.rotation.x = THREE.MathUtils.clamp(
      Math.atan2(hN - hS, dist * 2),
      -RaftBuoyancy.MAX_TILT,
      RaftBuoyancy.MAX_TILT
    );
    g.rotation.z = THREE.MathUtils.clamp(
      Math.atan2(hE - hW, dist * 2),
      -RaftBuoyancy.MAX_TILT,
      RaftBuoyancy.MAX_TILT
    );
  }
}
