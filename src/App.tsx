/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { createRaftGame, RaftGame } from './game/raftGame';
import { BuildingType } from './types/game';
import { HUD } from './ui/components/HUD';
import { InventoryCraftingModal } from './ui/components/InventoryCraftingModal';
import { PauseMenu } from './ui/components/PauseMenu';
import { useUiStore } from './ui/uiStore';
import { events } from './core/events';

// 调试面板仅开发期存在：DEV=false 的生产构建会摇掉整个分支与动态导入，
// 面板代码不进产物（摘除清单见 RaftGameDebugCommands 注释）。
const OceanDebugPanel = import.meta.env.DEV
  ? React.lazy(() =>
      import('./ui/components/OceanDebugPanel').then((m) => ({ default: m.OceanDebugPanel }))
    )
  : null;

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<RaftGame | null>(null);

  // 游戏数据快照：由事件桥接进 uiStore，React 只订阅不镜像
  const stats = useUiStore((s) => s.stats);
  const hotbar = useUiStore((s) => s.hotbar);
  const activeHotbarIdx = useUiStore((s) => s.activeHotbarIdx);
  const inventory = useUiStore((s) => s.inventory);
  const shark = useUiStore((s) => s.shark);
  const interactPrompt = useUiStore((s) => s.interactPrompt);
  const sharkAlert = useUiStore((s) => s.sharkAlert);
  const dayCount = useUiStore((s) => s.dayCount);
  const timeStr = useUiStore((s) => s.timeStr);
  const dayProgress = useUiStore((s) => s.dayProgress);
  const weather = useUiStore((s) => s.weather);
  const activeChest = useUiStore((s) => s.activeChest);

  // Toasts 由事件总线 (core/events.ts) 驱动，桥接见 ui/uiStore.ts
  const toasts = useUiStore((s) => s.toasts);

  // UI Modals & Overlays（弹窗开关是 UI 自己的状态；指针锁副作用留在 App）
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const [isOceanDebugOpen, setIsOceanDebugOpen] = useState(false);
  const [hookState, setHookState] = useState<string>('IDLE');
  const [hookPower, setHookPower] = useState(0);
  const [isBuildMode, setIsBuildMode] = useState(false);
  const [isDemolishMode, setIsDemolishMode] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingType>('foundation');
  const [sharkDefeatedOnce, setSharkDefeatedOnce] = useState(false);

  const setActiveChest = useUiStore((s) => s.setActiveChest);

  const toggleInventory = useCallback(() => {
    setIsInventoryOpen((prev) => {
      const next = !prev;
      if (next) {
        document.exitPointerLock?.();
      } else {
        document.body.requestPointerLock?.();
      }
      return next;
    });
  }, []);

  // 海面调参面板（Backquote）：打开退出指针锁以便拖滑杆，关闭恢复
  const toggleOceanDebug = useCallback(() => {
    setIsOceanDebugOpen((prev) => {
      const next = !prev;
      if (next) {
        document.exitPointerLock?.();
      } else {
        document.body.requestPointerLock?.();
      }
      return next;
    });
  }, []);

  // Initialize Three.js Engine
  useEffect(() => {
    if (!canvasMountRef.current) return;

    const game = createRaftGame(canvasMountRef.current);

    gameRef.current = game;

    // Pointer lock listener
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === canvasMountRef.current || document.pointerLockElement === document.body;
      setIsPointerLocked(locked);
      if (gameRef.current) {
        gameRef.current.isPointerLocked = locked;
      }
    };

    document.addEventListener('pointerlockchange', onPointerLockChange);

    // Build selection now arrives via the event bus (core/events.ts)
    const offBuildingSelect = events.on('buildingSelected', ({ type }) => setSelectedBuilding(type));

    // 请求类事件：开箱需要退出指针锁（数据写入由 uiStore 桥接完成）
    const offOpenChest = events.on('openChestRequested', () => {
      document.exitPointerLock?.();
    });

    // 背包快捷键（I / Tab）经 inputActions 发出 toggleInventoryRequested
    const offToggleInventory = events.on('toggleInventoryRequested', () => toggleInventory());

    // 海面调参面板快捷键（`）经 inputActions 发出 toggleOceanDebugRequested
    const offToggleOceanDebug = events.on('toggleOceanDebugRequested', () => toggleOceanDebug());

    // 高频 HUD 值由 Raft 门面统一采样，React 不接触具体系统。
    const pollInterval = window.setInterval(() => {
      const current = gameRef.current;
      if (!current) return;
      const hud = current.sampleHud();
      setHookState(hud.hookState);
      setHookPower(hud.hookPower);
      setIsBuildMode(hud.isBuildMode);
      setIsDemolishMode(hud.isDemolishMode);
      setSelectedBuilding(hud.selectedBuilding);
      setSharkDefeatedOnce(hud.sharkDefeatedOnce);
    }, 50);

    return () => {
      window.clearInterval(pollInterval);
      offBuildingSelect();
      offOpenChest();
      offToggleInventory();
      offToggleOceanDebug();
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      game.dispose();
    };
  }, [toggleInventory]);

  const requestLock = () => {
    setIsInventoryOpen(false);
    setActiveChest(null);
    document.body.requestPointerLock?.();
  };

  const handleSelectSlot = (idx: number) => {
    const slot = hotbar[idx];
    const isFood = slot?.itemId && ['cooked_fish', 'cooked_potato', 'coconut', 'raw_potato', 'raw_fish'].includes(slot.itemId);
    const isDrink = slot?.itemId && ['cup_freshwater', 'coconut'].includes(slot.itemId);

    // If clicking already active food/drink slot while hungry/thirsty, auto-consume!
    if (activeHotbarIdx === idx && ((isFood && stats.hunger < 98) || (isDrink && stats.thirst < 98))) {
      gameRef.current?.commands.consumeSlot(false, idx);
      return;
    }

    gameRef.current?.commands.selectHotbarSlot(idx);
  };

  const handleSelectBuilding = (b: BuildingType) => {
    setSelectedBuilding(b);
    if (gameRef.current) {
      gameRef.current.commands.selectBuilding(b);
      setIsBuildMode(true);
      setIsDemolishMode(false);
    }
  };

  const handleToggleBuildMode = () => {
    const game = gameRef.current;
    if (!game) return;
    game.commands.toggleBuildMode();
    setIsBuildMode(game.sampleHud().isBuildMode);
  };

  const handleCraftRecipe = (recipeId: string) => {
    gameRef.current?.commands.craftRecipe(recipeId);
  };

  const handleRespawn = () => {
    gameRef.current?.commands.respawn();
    requestLock();
  };

  const handleSaveWorld = () => {
    gameRef.current?.commands.saveWorld(true);
  };

  const handleResetWorld = () => {
    gameRef.current?.commands.resetWorld();
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-sky-300 font-sans">
      {/* Three.js Isolated Canvas Container */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full cursor-crosshair" />

      {/* In-Game HUD Overlay */}
      <HUD
        stats={stats}
        hotbar={hotbar}
        activeHotbarIdx={activeHotbarIdx}
        onSelectSlot={handleSelectSlot}
        interactPrompt={interactPrompt}
        sharkAlert={sharkAlert}
        shark={shark}
        hookState={hookState}
        hookPower={hookPower}
        isBuildMode={isBuildMode}
        isDemolishMode={isDemolishMode}
        selectedBuilding={selectedBuilding}
        onSelectBuilding={handleSelectBuilding}
        onToggleBuildMode={handleToggleBuildMode}
        onToggleInventory={toggleInventory}
        onOpenPause={() => {
          document.exitPointerLock?.();
        }}
        onSaveWorld={handleSaveWorld}
        dayCount={dayCount}
        timeStr={timeStr}
        dayProgress={dayProgress}
        weather={weather}
        sharkDefeatedOnce={sharkDefeatedOnce}
      />

      {/* Floating Notifications / Toasts */}
      <div className="absolute top-20 right-6 flex flex-col items-end gap-2 pointer-events-none z-30">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="bg-slate-900/90 text-white font-semibold text-xs px-3.5 py-2 rounded-xl shadow-lg border-l-4 transition-all animate-in fade-in slide-in-from-right-4"
            style={{ borderLeftColor: toast.color }}
          >
            {toast.text}
          </div>
        ))}
      </div>

      {/* Survivor Notebook / Crafting & Chest Modal */}
      <InventoryCraftingModal
        isOpen={isInventoryOpen}
        onClose={() => {
          setIsInventoryOpen(false);
          document.body.requestPointerLock?.();
        }}
        inventory={inventory}
        hotbar={hotbar}
        activeChest={activeChest}
        onCloseChest={() => {
          setActiveChest(null);
          document.body.requestPointerLock?.();
        }}
        onCraftRecipe={handleCraftRecipe}
        onConsumeSlot={(isInv, idx) => {
          gameRef.current?.commands.consumeSlot(isInv, idx);
        }}
        stats={stats}
      />

      {/* 海面调参面板（Backquote 开关；打开期间抑制暂停菜单；仅开发构建挂载） */}
      {import.meta.env.DEV && OceanDebugPanel && isOceanDebugOpen && gameRef.current && (
        <Suspense fallback={null}>
          <OceanDebugPanel game={gameRef.current} onClose={toggleOceanDebug} />
        </Suspense>
      )}

      {/* Pause & Start Splash Screen */}
      <PauseMenu
        isOpen={!isPointerLocked && !isInventoryOpen && !activeChest && !isOceanDebugOpen}
        onResume={requestLock}
        onRespawn={handleRespawn}
        onSaveWorld={handleSaveWorld}
        onResetWorld={handleResetWorld}
      />
    </div>
  );
}
