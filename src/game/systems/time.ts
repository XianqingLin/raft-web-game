import type { WorldView } from '../worldView';
import type { WorldDefinition } from '../../data/worldDefinition';

/**
 * TimeSystem —— 昼夜时间系统（拆分自 engine.ts，split step 7）。
 *
 * 职责：拥有并推进 dayTime/dayCount、
 * 格式化时钟并节流推送 UI、夜晚判定、睡觉跳到次日清晨。
 *
 * 消费方：weather/ocean 的 tick 读 dayTime，存档读写走 restore/dayTime，
 * stations 的夜间与睡觉逻辑走 isNight/advanceToMorning。
 */

export interface TimeSystemCallbacks {
  onTimeChange: (day: number, timeStr: string, progress: number) => void;
}

export class TimeSystem {
  /** 一整天 = 6 分钟 */
  private dayDurationSeconds = 360;
  /** 睡觉跳到的时间点（清晨） */
  private morningTime = 0.15;
  private _dayTime: number;
  private _dayCount: number;
  private callbacks: TimeSystemCallbacks;
  private lastPushedTimeStr = '';

  constructor(start: WorldDefinition['start'], callbacks: TimeSystemCallbacks) {
    this._dayTime = start.dayTime;
    this._dayCount = start.dayCount;
    this.callbacks = callbacks;
  }

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
      this.callbacks.onTimeChange(this._dayCount, timeStr, this._dayTime);
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
  public resetTo(start: WorldDefinition['start']) {
    this._dayTime = start.dayTime;
    this._dayCount = start.dayCount;
  }
}

// ==================== Factory（依赖接线集中于此，GameWorld 一行调用） ====================

export function createTimeSystem(w: WorldView): TimeSystem {
  return new TimeSystem(w.definition.start, {
    onTimeChange: (day, timeStr, progress) => w.ui.onTimeChange(day, timeStr, progress),
  });
}
