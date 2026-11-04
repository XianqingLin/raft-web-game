/**
 * UI 侧全局状态（zustand）。
 *
 * 约定：游戏逻辑系统不 import 本文件，只 emit 事件（见 core/events.ts）；
 * 每个事件到 store 的桥接写在文件底部。React 组件用 useUiStore 订阅。
 */

import { create } from 'zustand';
import { events } from '../core/events';
import {
  PlayerStats,
  HotbarSlot,
  InventorySlot,
  PlacedStructure,
  WeatherType,
} from '../types/game';
import { SharkData } from '../game/entities/shark';

export interface Toast {
  id: number;
  text: string;
  color: string;
}

interface UiState {
  // 游戏数据快照（由事件桥接写入，React 只读）
  stats: PlayerStats;
  hotbar: HotbarSlot[];
  activeHotbarIdx: number;
  inventory: InventorySlot[];
  shark: SharkData;
  interactPrompt: string | null;
  sharkAlert: boolean;
  dayCount: number;
  timeStr: string;
  dayProgress: number;
  weather: WeatherType;
  activeChest: PlacedStructure | null;
  // toast 队列
  toasts: Toast[];
  pushToast: (text: string, color?: string) => void;
  dismissToast: (id: number) => void;
  setActiveChest: (chest: PlacedStructure | null) => void;
}

const TOAST_LIFETIME_MS = 2400;
const MAX_TOASTS = 5;
let nextToastId = 1;

export const useUiStore = create<UiState>((set) => ({
  stats: {
    health: 100,
    maxHealth: 100,
    hunger: 90,
    maxHunger: 100,
    thirst: 90,
    maxThirst: 100,
    isDead: false,
  },
  hotbar: [
    { itemId: 'hook', count: 1, durability: 50 },
    { itemId: 'hammer', count: 1, durability: 100 },
    { itemId: 'spear', count: 1, durability: 40 },
    { itemId: 'cup_empty', count: 1 },
    { itemId: 'wood', count: 6 },
    { itemId: 'plastic', count: 6 },
    { itemId: 'leaf', count: 4 },
    { itemId: null, count: 0 },
  ],
  activeHotbarIdx: 0,
  inventory: Array.from({ length: 16 }, () => ({ itemId: null, count: 0 })),
  shark: {
    health: 100,
    maxHealth: 100,
    state: 'CIRCLING',
    pos: { x: 20, y: -0.4, z: 0 },
    targetPos: { x: 20, y: -0.4, z: 0 },
    angle: 0,
    circleRadius: 18,
    speed: 3.5,
    targetPlankKey: null,
    biteTimer: 0,
    fleeTimer: 0,
    inWaterAttackTimer: 0,
  },
  interactPrompt: null,
  sharkAlert: false,
  dayCount: 1,
  timeStr: '06:00',
  dayProgress: 0.25,
  weather: 'CLEAR',
  activeChest: null,
  toasts: [],
  pushToast: (text, color = '#38bdf8') => {
    const id = nextToastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), { id, text, color }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, TOAST_LIFETIME_MS);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setActiveChest: (chest) => set({ activeChest: chest }),
}));

// 事件总线 → store 桥接：import 本模块即完成接线
events.on('toast', ({ text, color }) => useUiStore.getState().pushToast(text, color));
events.on('statsChanged', (stats) => useUiStore.setState({ stats }));
events.on('hotbarChanged', ({ hotbar, activeIdx }) =>
  useUiStore.setState({ hotbar, activeHotbarIdx: activeIdx })
);
events.on('inventoryChanged', (inventory) => useUiStore.setState({ inventory }));
events.on('interactPromptChanged', (interactPrompt) => useUiStore.setState({ interactPrompt }));
events.on('sharkAlertChanged', (sharkAlert) => useUiStore.setState({ sharkAlert }));
events.on('sharkDataChanged', (shark) => useUiStore.setState({ shark }));
events.on('timeChanged', ({ day, timeStr, progress }) =>
  useUiStore.setState({ dayCount: day, timeStr, dayProgress: progress })
);
events.on('weatherChanged', (weather) => useUiStore.setState({ weather }));
events.on('openChestRequested', (chest) => useUiStore.getState().setActiveChest(chest));
