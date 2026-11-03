/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RaftEngine } from './game/engine';
import { PlayerStats, HotbarSlot, InventorySlot, BuildingType, PlacedStructure, SharkData, WeatherType, RemotePlayer } from './types/game';
import { HUD } from './components/HUD';
import { InventoryCraftingModal } from './components/InventoryCraftingModal';
import { PauseMenu } from './components/PauseMenu';
import { CompactorModal } from './components/CompactorModal';
import { MerchantModal } from './components/MerchantModal';

interface Toast {
  id: number;
  text: string;
  color: string;
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RaftEngine | null>(null);

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

  const [multiplayerStatus, setMultiplayerStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'offline'>('connecting');
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayer[]>([]);
  const [localPlayerName, setLocalPlayerName] = useState('Survivor');
  const [localPlayerColor, setLocalPlayerColor] = useState('#38bdf8');
  const [sharkDefeatedOnce, setSharkDefeatedOnce] = useState(false);
  const [roomId, setRoomId] = useState('ocean-world-1');

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((text: string, color: string = '#38bdf8') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-4), { id, text, color }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2400);
  }, []);

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

    const engine = new RaftEngine(canvasMountRef.current, {
      onStatsChange: (newStats) => setStats(newStats),
      onHotbarChange: (newHotbar, activeIdx) => {
        setHotbar(newHotbar);
        setActiveHotbarIdx(activeIdx);
      },
      onInventoryChange: (newInv) => setInventory(newInv),
      onToast: (text, color) => addToast(text, color),
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
      onBuildingSelect: (b) => setSelectedBuilding(b),
      onToggleInventory: () => toggleInventory(),
      onMultiplayerStatusChange: (status) => setMultiplayerStatus(status),
      onMultiplayerPlayersChange: (players) => setRemotePlayers(players),
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
    if (engine.multiplayer) {
      setLocalPlayerName(engine.multiplayer.localName);
      setLocalPlayerColor(engine.multiplayer.localColor);
    }

    // Pointer lock listener
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === canvasMountRef.current || document.pointerLockElement === document.body;
      setIsPointerLocked(locked);
      if (engineRef.current) {
        engineRef.current.isPointerLocked = locked;
      }
    };

    document.addEventListener('pointerlockchange', onPointerLockChange);

    // Periodic state poller for hook charging bar and build mode
    const pollInterval = window.setInterval(() => {
      if (engineRef.current) {
        setHookState(engineRef.current.hookState);
        setHookPower(engineRef.current.hookPower);
        setIsBuildMode(engineRef.current.isBuildMode);
        setIsDemolishMode(engineRef.current.isDemolishMode);
        setSelectedBuilding(engineRef.current.selectedBuildingType);
        setSharkDefeatedOnce(engineRef.current.sharkDefeatedOnce);
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
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('keydown', onKeyDown);
      engine.dispose();
    };
  }, [addToast, toggleInventory]);

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
      engineRef.current?.consumeSlot(false, idx);
      return;
    }

    engineRef.current?.setActiveHotbarSlot(idx);
    setActiveHotbarIdx(idx);
  };

  const handleSelectBuilding = (b: BuildingType) => {
    setSelectedBuilding(b);
    if (engineRef.current) {
      engineRef.current.selectBuildingType(b);
      setIsBuildMode(true);
      setIsDemolishMode(false);
    }
  };

  const handleToggleBuildMode = () => {
    if (!engineRef.current) return;
    engineRef.current.isBuildMode = !engineRef.current.isBuildMode;
    setIsBuildMode(engineRef.current.isBuildMode);
  };

  const handleCraftRecipe = (recipeId: string) => {
    engineRef.current?.craftRecipe(recipeId);
  };

  const handleRespawn = () => {
    engineRef.current?.respawnPlayer();
    requestLock();
  };

  const handleSaveWorld = () => {
    engineRef.current?.saveWorld(true);
  };

  const handleResetWorld = () => {
    engineRef.current?.resetWorld();
  };

  const handleUpdatePlayerName = (name: string) => {
    setLocalPlayerName(name);
    engineRef.current?.multiplayer?.setPlayerName(name);
  };

  const handleSwitchRoom = (newRoom: string) => {
    setRoomId(newRoom);
    engineRef.current?.switchRoom(newRoom);
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
        multiplayerStatus={multiplayerStatus}
        remotePlayers={remotePlayers}
        localPlayerName={localPlayerName}
        localPlayerColor={localPlayerColor}
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
          engineRef.current?.consumeSlot(isInv, idx);
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
          return engineRef.current ? engineRef.current.feedCompactorJunk(res, count) : false;
        }}
        onForgeBlock={() => {
          return engineRef.current ? engineRef.current.forgeCompactorBlock() : false;
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
          return engineRef.current ? engineRef.current.buyMerchantItem(item) : false;
        }}
      />

      {/* Pause & Start Splash Screen */}
      <PauseMenu
        isOpen={!isPointerLocked && !isInventoryOpen && !activeChest && !isCompactorOpen && !isMerchantOpen}
        onResume={requestLock}
        onRespawn={handleRespawn}
        onSaveWorld={handleSaveWorld}
        onResetWorld={handleResetWorld}
        multiplayerStatus={multiplayerStatus}
        remotePlayersCount={remotePlayers.length}
        playerName={localPlayerName}
        onUpdatePlayerName={handleUpdatePlayerName}
        roomId={roomId}
        onSwitchRoom={handleSwitchRoom}
      />
    </div>
  );
}
