/**
 * UI 侧全局状态（zustand）。
 *
 * 约定：游戏逻辑系统不 import 本文件，只 emit 事件（见 core/events.ts）；
 * 每个事件到 store 的桥接写在文件底部。React 组件用 useUiStore 订阅。
 */

import { create } from 'zustand';
import { events } from '../core/events';

export interface Toast {
  id: number;
  text: string;
  color: string;
}

interface UiState {
  toasts: Toast[];
  pushToast: (text: string, color?: string) => void;
  dismissToast: (id: number) => void;
}

const TOAST_LIFETIME_MS = 2400;
const MAX_TOASTS = 5;
let nextToastId = 1;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  pushToast: (text, color = '#38bdf8') => {
    const id = nextToastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), { id, text, color }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, TOAST_LIFETIME_MS);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// 事件总线 → store 桥接：import 本模块即完成接线
events.on('toast', ({ text, color }) => useUiStore.getState().pushToast(text, color));
