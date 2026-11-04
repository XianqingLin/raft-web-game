import {
  PlayerStats,
  HotbarSlot,
  InventorySlot,
  PlacedStructure,
  WeatherType,
} from '../types/game';
import { SharkData } from './entities/shark';

/** Raft 玩法层向 React/UI 适配器发布的回调契约。 */
export interface GameCallbacks {
  onStatsChange: (stats: PlayerStats) => void;
  onHotbarChange: (hotbar: HotbarSlot[], activeIdx: number) => void;
  onInventoryChange: (inventory: InventorySlot[]) => void;
  /** @deprecated 新代码使用 core/events.ts 的 `toast` 事件。 */
  onToast?: (text: string, color?: string) => void;
  onInteractPrompt: (prompt: string | null) => void;
  onSharkAlert: (alerting: boolean) => void;
  onSharkDataChange?: (shark: SharkData) => void;
  onOpenChest: (chest: PlacedStructure | null) => void;
  onTimeChange: (day: number, timeStr: string, progress: number) => void;
  onWeatherChange?: (weather: WeatherType) => void;
  onToggleInventory?: () => void;
}

/** 组合根会接入事件总线的 toast，因此玩法层内部可将其视为必选。 */
export type WorldCallbacks = GameCallbacks & Required<Pick<GameCallbacks, 'onToast'>>;
