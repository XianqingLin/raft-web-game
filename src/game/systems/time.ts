import type { NewGameDefinition } from '../../data/gameDefinition';
import { events } from '../../core/events';

/**
 * TimeSystem —— 昼夜时间系统（拆分自 engine.ts，split step 7）。
 *
 * 职责：拥有并推进 dayTime/dayCount、
 * 格式化时钟并节流推送 UI、夜晚判定、睡觉跳到次日清晨。
 */

import { Tickable } from '../lifecycle';

export class TimeSystem implements Tickable {
  /** 一整天 = 6 分钟 */
  private dayDurationSeconds = 360;
  /** 睡觉跳到的时间点（清晨） */
  private morningTime = 0.15;
  private _dayTime = 0;
  private _dayCount = 1;
  private lastPushedTimeStr = '';

  /** 一天中的时间 0..1（0.25 = 正午） */
  public get dayTime(): number {
    return this._dayTime;
  }

  /** 存活天数 */
  public get dayCount(): number {
    return this._dayCount;
  }

  /** 每帧推进时间；仅在显示用时钟字符串变化时推送 UI（避免每帧重渲染） */
  public update(dt: number) {
    this._dayTime = (this._dayTime + dt / this.dayDurationSeconds) % 1.0;

    const hours = Math.floor(this._dayTime * 24);
    const mins = Math.floor(((this._dayTime * 24) % 1) * 60);
    const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    if (timeStr !== this.lastPushedTimeStr) {
      this.lastPushedTimeStr = timeStr;
      events.emit('timeChanged', { day: this._dayCount, timeStr, progress: this._dayTime });
    }
  }

  /** 夜晚判定（床睡觉、 stations 的夜间逻辑用） */
  public get isNight(): boolean {
    return this._dayTime > 0.55 || this._dayTime < 0.05;
  }

  /** 推进到次日清晨，返回新的天数（用于提示文案） */
  public advanceToMorning(): number {
    this._dayTime = this.morningTime;
    this._dayCount++;
    return this._dayCount;
  }

  /** 从存档恢复时间（字段缺省时保留当前值，与原 load 逻辑一致） */
  public restore(dayTime: number | undefined, dayCount: number | undefined) {
    if (dayCount) this._dayCount = dayCount;
    if (dayTime !== undefined) this._dayTime = dayTime;
  }

  /** 世界重置：回到定义的起始时间 */
  public resetTo(start: NewGameDefinition['start']) {
    this._dayTime = start.dayTime;
    this._dayCount = start.dayCount;
  }
}

// ==================== Factory（由 Raft 组合根统一接线） ====================

export function createTimeSystem(): TimeSystem {
  return new TimeSystem();
}
