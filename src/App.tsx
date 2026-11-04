/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRaftGame, RaftGame } from './game/raftGame';
import { PlayerStats, HotbarSlot, InventorySlot, BuildingType, PlacedStructure, WeatherType } from './types/game';
import { SharkData } from './game/entities/shark';
import { HUD } from './ui/components/HUD';
import { InventoryCraftingModal } from './ui/components/InventoryCraftingModal';
import { PauseMenu } from './ui/components/PauseMenu';
import { CompactorModal } from './ui/components/CompactorModal';
import { useUiStore } from './ui/uiStore';
import { events } from './core/events';

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<RaftGame | null>(null);

  // React State mirrored from engine
  const [stats, setStats] = useState<PlayerStats>({
    health: 100,
    maxHealth: 100,
    hunger: 90,
    maxHunger: 100,
    thirst: 90,
    maxThirst: 100,
    isDead: false,
  });

  const [hotbar, setHotbar] = useState<HotbarSlot[]>([
    { itemId: 'hook', count: 1, durability: 50 },
    { itemId: 'hammer', count: 1, durability: 100 },
    { itemId: 'spear', count: 1, durability: 40 },
    { itemId: 'cup_empty', count: 1 },
    { itemId: 'wood', count: 6 },
    { itemId: 'plastic', count: 6 },
    { itemId: 'leaf', count: 4 },
    { itemId: null, count: 0 },
  ]);
  const [activeHotbarIdx, setActiveHotbarIdx] = useState(0);

  const [inventory, setInventory] = useState<InventorySlot[]>(
    Array.from({ length: 16 }, () => ({ itemId: null, count: 0 }))
  );

  const [sharkData, setSharkData] = useState<SharkData>({
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
  });

  const [interactPrompt, setInteractPrompt] = useState<string | null>(null);
  const [sharkAlert, setSharkAlert] = useState(false);
  const [hookState, setHookState] = useState<string>('IDLE');
  const [hookPower, setHookPower] = useState(0);

  // UI Modals & Overlays
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const [activeChest, setActiveChest] = useState<PlacedStructure | null>(null);
  const [isCompactorOpen, setIsCompactorOpen] = useState(false);
  const [isBuildMode, setIsBuildMode] = useState(false);
  const [isDemolishMode, setIsDemolishMode] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingType>('foundation');

  // Time / Day & Weather
  const [dayCount, setDayCount] = useState(1);
  const [timeStr, setTimeStr] = useState('06:00');
  const [dayProgress, setDayProgress] = useState(0.25);
  const [weather, setWeather] = useState<WeatherType>('CLEAR');

  const [sharkDefeatedOnce, setSharkDefeatedOnce] = useState(false);

  // Toasts 由事件总线 (core/events.ts) 驱动，store 见 ui/uiStore.ts
  const toasts = useUiStore((s) => s.toasts);

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

  // Initialize Three.js Engine
  useEffect(() => {
    if (!canvasMountRef.current) return;

    const game = createRaftGame(canvasMountRef.current, {
      onStatsChange: (newStats) => setStats(newStats),
      onHotbarChange: (newHotbar, activeIdx) => {
        setHotbar(newHotbar);
        setActiveHotbarIdx(activeIdx);
      },
      onInventoryChange: (newInv) => setInventory(newInv),
      onInteractPrompt: (prompt) => setInteractPrompt(prompt),
      onSharkAlert: (alerting) => setSharkAlert(alerting),
      onSharkDataChange: (newShark) => setSharkData(newShark),
      onOpenChest: (chest) => {
        setActiveChest(chest);
        document.exitPointerLock?.();
      },
      onTimeChange: (day, time, prog) => {
        setDayCount(day);
        setTimeStr(time);
        setDayProgress(prog);
      },
      onWeatherChange: (newWeather) => setWeather(newWeather),
      onToggleInventory: () => toggleInventory(),
      onOpenCompactor: () => {
        setIsCompactorOpen(true);
        document.exitPointerLock?.();
      },
    });

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

    // 背包快捷键（I / Tab）统一由 RaftInputHandler 经 engine/inputMap.ts
    // 分发到 onToggleInventory 回调——此处不再挂全局 keydown，避免双触发。

    return () => {
      window.clearInterval(pollInterval);
      offBuildingSelect();
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      game.dispose();
    };
  }, [toggleInventory]);

  const requestLock = () => {
    setIsInventoryOpen(false);
    setActiveChest(null);
    setIsCompactorOpen(false);
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
    setActiveHotbarIdx(idx);
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
        shark={sharkData}
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
        onOpenCompactor={() => {
          setIsCompactorOpen(true);
          document.exitPointerLock?.();
        }}
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

      {/* Debris Compactor Hydraulic Press Modal */}
      <CompactorModal
        isOpen={isCompactorOpen}
        onClose={() => {
          setIsCompactorOpen(false);
          document.body.requestPointerLock?.();
        }}
        inventory={inventory}
        hotbar={hotbar}
        onFeedJunk={(res, count) => {
          return gameRef.current ? gameRef.current.commands.feedCompactorJunk(res, count) : false;
        }}
        onForgeBlock={() => {
          return gameRef.current ? gameRef.current.commands.forgeCompactorBlock() : false;
        }}
      />

      {/* Pause & Start Splash Screen */}
      <PauseMenu
        isOpen={!isPointerLocked && !isInventoryOpen && !activeChest && !isCompactorOpen}
        onResume={requestLock}
        onRespawn={handleRespawn}
        onSaveWorld={handleSaveWorld}
        onResetWorld={handleResetWorld}
      />
    </div>
  );
}
