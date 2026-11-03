import type { WorldView } from '../worldView';
import type { WorldState } from '../gameWorld';

/**
 * TimeSystem —— 昼夜时间系统（拆分自 engine.ts，split step 7）。
 *
 * 职责：推进 world.dayTime/dayCount、格式化时钟并节流推送 UI、
 * 夜晚判定、睡觉跳到次日清晨。
 *
 * 时间数值本身存放在 WorldState（存档与 stations 需要读写），
 * 本系统只拥有"一天多长"、"清晨是几点"这些时间策略。
 */

export interface TimeSystemCallbacks {
  onTimeChange: (day: number, timeStr: string, progress: number) => void;
}

export class TimeSystem {
  /** 一整天 = 6 分钟 */
  private dayDurationSeconds = 360;
  /** 睡觉跳到的时间点（清晨） */
  private morningTime = 0.15;
  private world: WorldState;
  private callbacks: TimeSystemCallbacks;
  private lastPushedTimeStr = '';

  constructor(world: WorldState, callbacks: TimeSystemCallbacks) {
    this.world = world;
    this.callbacks = callbacks;
  }

  /** 每帧推进时间；仅在显示用时钟字符串变化时推送 UI（避免每帧重渲染） */
  public update(dt: number) {
    this.world.dayTime = (this.world.dayTime + dt / this.dayDurationSeconds) % 1.0;

    const hours = Math.floor(this.world.dayTime * 24);
    const mins = Math.floor(((this.world.dayTime * 24) % 1) * 60);
    const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    if (timeStr !== this.lastPushedTimeStr) {
      this.lastPushedTimeStr = timeStr;
      this.callbacks.onTimeChange(this.world.dayCount, timeStr, this.world.dayTime);
    }
  }

  /** 夜晚判定（床睡觉、 stations 的夜间逻辑用） */
  public get isNight(): boolean {
    return this.world.dayTime > 0.55 || this.world.dayTime < 0.05;
  }

  /** 推进到次日清晨，返回新的天数（用于提示文案） */
  public advanceToMorning(): number {
    this.world.dayTime = this.morningTime;
    this.world.dayCount++;
    return this.world.dayCount;
  }
}

// ==================== Factory（依赖接线集中于此，GameWorld 一行调用） ====================

export function createTimeSystem(w: WorldView): TimeSystem {
  return new TimeSystem(w.state, {
    onTimeChange: (day, timeStr, progress) => w.ui.onTimeChange(day, timeStr, progress),
  });
}
