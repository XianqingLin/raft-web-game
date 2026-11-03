/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Game } from './game/game';
import { PlayerStats, HotbarSlot, InventorySlot, BuildingType, PlacedStructure, SharkData, WeatherType } from './types/game';
import { HUD } from './components/HUD';
import { InventoryCraftingModal } from './components/InventoryCraftingModal';
import { PauseMenu } from './components/PauseMenu';
import { CompactorModal } from './components/CompactorModal';
import { MerchantModal } from './components/MerchantModal';
import { useUiStore } from './state/uiStore';
import { events } from './core/events';

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Game | null>(null);

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
  const [isMerchantOpen, setIsMerchantOpen] = useState(false);
  const [isBuildMode, setIsBuildMode] = useState(false);
  const [isDemolishMode, setIsDemolishMode] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingType>('foundation');

  // Time / Day & Weather
  const [dayCount, setDayCount] = useState(1);
  const [timeStr, setTimeStr] = useState('06:00');
  const [dayProgress, setDayProgress] = useState(0.25);
  const [weather, setWeather] = useState<WeatherType>('CLEAR');

  const [sharkDefeatedOnce, setSharkDefeatedOnce] = useState(false);

  // Toasts 由事件总线 (core/events.ts) 驱动，store 见 state/uiStore.ts
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

    const engine = new Game(canvasMountRef.current, {
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
      onOpenMerchant: () => {
        setIsMerchantOpen(true);
        document.exitPointerLock?.();
      },
    });

    engineRef.current = engine;

    // Pointer lock listener
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === canvasMountRef.current || document.pointerLockElement === document.body;
      setIsPointerLocked(locked);
      if (engineRef.current) {
        engineRef.current.isPointerLocked = locked;
      }
    };

    document.addEventListener('pointerlockchange', onPointerLockChange);

    // Build selection now arrives via the event bus (core/events.ts)
    const offBuildingSelect = events.on('buildingSelected', ({ type }) => setSelectedBuilding(type));

    // Periodic state poller for hook charging bar and build mode
    const pollInterval = window.setInterval(() => {
      if (engineRef.current) {
        setHookState(engineRef.current.hookSystem.hookState);
        setHookPower(engineRef.current.hookSystem.hookPower);
        setIsBuildMode(engineRef.current.build.isBuildMode);
        setIsDemolishMode(engineRef.current.build.isDemolishMode);
        setSelectedBuilding(engineRef.current.build.selectedBuildingType);
        setSharkDefeatedOnce(engineRef.current.sharkSystem.sharkDefeatedOnce);
      }
    }, 50);

    // Keyboard shortcut for I or Tab (Inventory)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyI' || e.code === 'Tab') {
        e.preventDefault();
        toggleInventory();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearInterval(pollInterval);
      offBuildingSelect();
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('keydown', onKeyDown);
      engine.dispose();
    };
  }, [toggleInventory]);

  const requestLock = () => {
    setIsInventoryOpen(false);
    setActiveChest(null);
    setIsCompactorOpen(false);
    setIsMerchantOpen(false);
    setActiveChest(null);
    document.body.requestPointerLock?.();
  };

  const handleSelectSlot = (idx: number) => {
    const slot = hotbar[idx];
    const isFood = slot?.itemId && ['cooked_fish', 'cooked_potato', 'coconut', 'raw_potato', 'raw_fish'].includes(slot.itemId);
    const isDrink = slot?.itemId && ['cup_freshwater', 'coconut'].includes(slot.itemId);

    // If clicking already active food/drink slot while hungry/thirsty, auto-consume!
    if (activeHotbarIdx === idx && ((isFood && stats.hunger < 98) || (isDrink && stats.thirst < 98))) {
      engineRef.current?.inventorySystem.consumeSlot(false, idx);
      return;
    }

    engineRef.current?.inventorySystem.setActiveHotbarSlot(idx);
    setActiveHotbarIdx(idx);
  };

  const handleSelectBuilding = (b: BuildingType) => {
    setSelectedBuilding(b);
    if (engineRef.current) {
      engineRef.current.build.selectBuildingType(b);
      setIsBuildMode(true);
      setIsDemolishMode(false);
    }
  };

  const handleToggleBuildMode = () => {
    if (!engineRef.current) return;
    engineRef.current.build.isBuildMode = !engineRef.current.build.isBuildMode;
    setIsBuildMode(engineRef.current.build.isBuildMode);
  };

  const handleCraftRecipe = (recipeId: string) => {
    engineRef.current?.inventorySystem.craftRecipe(recipeId);
  };

  const handleRespawn = () => {
    engineRef.current?.playerSystem.respawnPlayer();
    requestLock();
  };

  const handleSaveWorld = () => {
    engineRef.current?.saveWorld(true);
  };

  const handleResetWorld = () => {
    engineRef.current?.resetWorld();
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
        onOpenMerchant={() => {
          setIsMerchantOpen(true);
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
          engineRef.current?.inventorySystem.consumeSlot(isInv, idx);
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
          return engineRef.current ? engineRef.current.stations.feedCompactorJunk(res, count) : false;
        }}
        onForgeBlock={() => {
          return engineRef.current ? engineRef.current.stations.forgeCompactorBlock() : false;
        }}
      />

      {/* Drifting Survivor Outpost Barter Stall */}
      <MerchantModal
        isOpen={isMerchantOpen}
        onClose={() => {
          setIsMerchantOpen(false);
          document.body.requestPointerLock?.();
        }}
        salvagedBlockCount={[...hotbar, ...inventory].reduce(
          (sum, s) => sum + (s.itemId === 'salvaged_scrap_block' ? s.count : 0),
          0
        )}
        onBuyItem={(item) => {
          return engineRef.current ? engineRef.current.stations.buyMerchantItem(item) : false;
        }}
      />

      {/* Pause & Start Splash Screen */}
      <PauseMenu
        isOpen={!isPointerLocked && !isInventoryOpen && !activeChest && !isCompactorOpen && !isMerchantOpen}
        onResume={requestLock}
        onRespawn={handleRespawn}
        onSaveWorld={handleSaveWorld}
        onResetWorld={handleResetWorld}
      />
    </div>
  );
}
