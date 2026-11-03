import React, { useState } from 'react';
import { PlayerStats, HotbarSlot, BuildingType, SharkData, WeatherType, RemotePlayer } from '../types/game';
import { ITEM_DEFINITIONS, BUILDING_DEFINITIONS } from '../data/itemsAndRecipes';
import { Heart, Utensils, Droplets, Sun, Moon, AlertTriangle, Hammer, Backpack, Volume2, VolumeX, ShieldAlert, CloudRain, CloudFog, Save, Users, ChevronDown, Store, SlidersHorizontal } from 'lucide-react';
import { soundManager } from '../audio/soundManager';

interface HUDProps {
  stats: PlayerStats;
  hotbar: HotbarSlot[];
  activeHotbarIdx: number;
  onSelectSlot: (idx: number) => void;
  interactPrompt: string | null;
  sharkAlert: boolean;
  shark: SharkData;
  hookState: string;
  hookPower: number;
  isBuildMode: boolean;
  isDemolishMode: boolean;
  selectedBuilding: BuildingType;
  onSelectBuilding: (b: BuildingType) => void;
  onToggleBuildMode: () => void;
  onToggleInventory: () => void;
  onOpenPause: () => void;
  onSaveWorld?: () => void;
  dayCount: number;
  timeStr: string;
  dayProgress: number;
  weather: WeatherType;
  multiplayerStatus?: string;
  remotePlayers?: RemotePlayer[];
  localPlayerName?: string;
  localPlayerColor?: string;
  sharkDefeatedOnce?: boolean;
  onOpenCompactor?: () => void;
  onOpenMerchant?: () => void;
}

export const HUD: React.FC<HUDProps> = ({
  stats,
  hotbar,
  activeHotbarIdx,
  onSelectSlot,
  interactPrompt,
  sharkAlert,
  shark,
  hookState,
  hookPower,
  isBuildMode,
  isDemolishMode,
  selectedBuilding,
  onSelectBuilding,
  onToggleBuildMode,
  onToggleInventory,
  onOpenPause,
  onSaveWorld,
  dayCount,
  timeStr,
  dayProgress,
  weather,
  multiplayerStatus = 'connected',
  remotePlayers = [],
  localPlayerName = 'Survivor',
  localPlayerColor = '#38bdf8',
  sharkDefeatedOnce = false,
  onOpenCompactor,
  onOpenMerchant,
}) => {
  const [showPlayersList, setShowPlayersList] = useState(false);
  const isNight = dayProgress > 0.55 || dayProgress < 0.05;

  const buildingOptions: BuildingType[] = [
    'foundation',
    'tri_foundation',
    'collection_net',
    'pillar',
    'floor',
    'stairs',
    'wall',
    'window_wall',
    'fence',
    'purifier',
    'grill',
    'crop_plot',
    'chest',
    'sail',
    'bed',
    'debris_compactor',
  ];

  const selectedBuildingDef = BUILDING_DEFINITIONS[selectedBuilding];

  // Shark Health Bar state
  const sharkHpRatio = Math.max(0, Math.min(1, shark.health / shark.maxHealth));
  let sharkStatusLabel = sharkDefeatedOnce ? '🩸 STALKING SURVIVORS' : 'CIRCLING RAFT';
  let sharkStatusColor = sharkDefeatedOnce ? 'text-red-300 font-bold' : 'text-slate-300';
  let sharkBarBg = sharkDefeatedOnce ? 'bg-red-600' : 'bg-emerald-500';

  if (shark.state === 'FLEEING') {
    sharkStatusLabel = `FLEEING UNDERWATER (${Math.ceil(shark.fleeTimer)}s)`;
    sharkStatusColor = 'text-sky-400 font-bold';
    sharkBarBg = 'bg-sky-500';
  } else if (shark.state === 'ATTACKING_RAFT') {
    sharkStatusLabel = sharkDefeatedOnce ? '🩸 BLOOD BRUCE BITING RAFT!' : 'ATTACKING RAFT PLANK! (JAB WITH SPEAR)';
    sharkStatusColor = 'text-red-300 font-bold animate-pulse';
    sharkBarBg = 'bg-red-600';
  } else if (shark.state === 'ATTACKING_PLAYER') {
    sharkStatusLabel = sharkDefeatedOnce ? '🩸 BLOOD BRUCE DEVOURING SWIMMER!' : 'HUNTING YOU! CLIMB ON RAFT!';
    sharkStatusColor = 'text-red-400 font-bold animate-pulse';
    sharkBarBg = 'bg-red-700';
  } else {
    if (sharkDefeatedOnce) {
      sharkBarBg = 'bg-red-600';
    } else {
      if (sharkHpRatio < 0.35) sharkBarBg = 'bg-red-500';
      else if (sharkHpRatio < 0.7) sharkBarBg = 'bg-amber-500';
    }
  }

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
      {/* 1. Top Bar: Day / Clock & Action Buttons */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-auto gap-2">
        {/* Left: Day/Time Badge, Weather & Multiplayer Status */}
        <div className="flex items-center gap-2">
          {/* Day & Time Badge */}
          <div className="flex items-center gap-2.5 bg-slate-900/85 backdrop-blur-md px-3.5 py-2 rounded-xl border border-white/10 shadow-lg text-white">
            {isNight ? <Moon className="w-4 h-4 text-indigo-400" /> : <Sun className="w-4 h-4 text-amber-400" />}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Day {dayCount}</div>
              <div className="text-xs font-bold font-mono tracking-wide">{timeStr}</div>
            </div>
          </div>

          {/* Dynamic Weather Badge */}
          <div className="hidden sm:flex items-center gap-2 bg-slate-900/85 backdrop-blur-md px-3 py-2 rounded-xl border border-white/10 shadow-lg text-white">
            {weather === 'CLEAR' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : weather === 'LIGHT_FOG' ? (
              <CloudFog className="w-4 h-4 text-slate-300 animate-pulse" />
            ) : (
              <CloudRain className="w-4 h-4 text-sky-400 animate-bounce" />
            )}
            <div>
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Sky</div>
              <div className="text-[11px] font-bold tracking-wide">
                {weather === 'CLEAR' ? 'Clear' : weather === 'LIGHT_FOG' ? 'Fog' : 'Storm'}
              </div>
            </div>
          </div>

          {/* Multiplayer Survivors Status Badge with Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowPlayersList((p) => !p)}
              className="flex items-center gap-2 bg-slate-900/85 hover:bg-slate-800 backdrop-blur-md px-3 py-2 rounded-xl border border-white/10 shadow-lg text-white text-xs font-medium cursor-pointer transition-all"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <Users className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-bold">{remotePlayers.length + 1}</span>
              <span className="hidden md:inline text-slate-300">Survivors</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {/* Survivors Dropdown Card */}
            {showPlayersList && (
              <div className="absolute top-12 left-0 w-64 bg-slate-950/95 backdrop-blur-md border border-white/15 rounded-2xl p-3 shadow-2xl z-50 flex flex-col gap-2">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider pb-1 border-b border-white/10 flex justify-between">
                  <span>Connected Survivors</span>
                  <span className="text-emerald-400">Live Sync</span>
                </div>

                {/* Local player */}
                <div className="flex items-center justify-between text-xs p-1.5 rounded-lg bg-slate-900 border border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: localPlayerColor }} />
                    <span className="font-bold text-white">{localPlayerName} (You)</span>
                  </div>
                  <span className="font-mono text-emerald-400 text-[11px]">{Math.round(stats.health)} HP</span>
                </div>

                {/* Remote players */}
                {remotePlayers.map((rp) => (
                  <div key={rp.id} className="flex items-center justify-between text-xs p-1.5 rounded-lg bg-slate-900/60 border border-white/5">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: rp.color }} />
                      <span className="text-slate-200 font-medium">{rp.name}</span>
                    </div>
                    <span className="font-mono text-sky-400 text-[11px]">{Math.round(rp.health)} HP</span>
                  </div>
                ))}

                {remotePlayers.length === 0 && (
                  <div className="text-[11px] text-slate-400 italic text-center py-1">
                    Waiting for fellow castaways to join...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center: Bruce the Shark / Blood Bruce Boss Bar */}
        <div className={`flex flex-col items-center backdrop-blur-md px-4 py-2 rounded-2xl shadow-2xl min-w-[240px] max-w-sm ${
          sharkDefeatedOnce ? 'bg-red-950/90 border-2 border-red-500/60' : 'bg-slate-950/85 border border-red-500/30'
        }`}>
          <div className="flex items-center justify-between w-full mb-1">
            <span className="text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
              <span>{sharkDefeatedOnce ? '🩸' : '🦈'}</span>
              <span className={sharkDefeatedOnce ? 'text-red-400 font-black animate-pulse' : 'text-red-400'}>
                {sharkDefeatedOnce ? 'Enraged Blood Bruce' : 'Bruce the Shark'}
              </span>
            </span>
            <span className="text-xs font-mono font-bold text-slate-200">
              {shark.state === 'FLEEING' ? 'Diving' : `${Math.round(shark.health)} / ${shark.maxHealth} HP`}
            </span>
          </div>

          {/* Health fill */}
          <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-white/10 relative">
            <div
              className={`h-full transition-all duration-300 ${sharkBarBg}`}
              style={{ width: `${Math.round(sharkHpRatio * 100)}%` }}
            />
          </div>

          <div className={`text-[10px] uppercase tracking-wider mt-0.5 ${sharkStatusColor}`}>
            {sharkStatusLabel}
          </div>
        </div>

        {/* Top Right Buttons: Audio, Save, Notebook, Build */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => soundManager.toggleMute()}
            className="p-2 bg-slate-900/85 hover:bg-slate-800 backdrop-blur-md text-white rounded-xl border border-white/10 shadow-lg transition-all cursor-pointer"
            title="Toggle Audio"
          >
            {soundManager.getIsMuted() ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-sky-400" />}
          </button>

          {onOpenMerchant && (
            <button
              onClick={onOpenMerchant}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-800 hover:bg-amber-700 text-amber-100 font-medium text-xs rounded-xl shadow-lg border border-amber-400/30 transition-all cursor-pointer"
              title="Trade with Drifting Scavenger Merchant"
            >
              <Store className="w-3.5 h-3.5 text-amber-300" />
              <span className="hidden sm:inline">Merchant</span>
            </button>
          )}


          {onSaveWorld && (
            <button
              onClick={onSaveWorld}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white font-medium text-xs rounded-xl shadow-lg border border-emerald-400/40 transition-all cursor-pointer"
              title="Save World to Browser and Server"
            >
              <Save className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Save</span>
            </button>
          )}

          <button
            onClick={onToggleInventory}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs rounded-xl shadow-lg border border-amber-400/30 transition-all cursor-pointer"
          >
            <Backpack className="w-3.5 h-3.5" />
            <span>Inv [I]</span>
          </button>

          <button
            onClick={onToggleBuildMode}
            className={`flex items-center gap-1.5 px-3 py-2 text-white font-medium text-xs rounded-xl shadow-lg border transition-all cursor-pointer ${
              isBuildMode ? 'bg-emerald-600 border-emerald-400/40' : 'bg-slate-900/85 hover:bg-slate-800 border-white/10'
            }`}
          >
            <Hammer className="w-3.5 h-3.5 text-emerald-300" />
            <span>Build [B]</span>
          </button>
        </div>
      </div>

      {/* 2. Shark Danger Alert Banner */}
      {sharkAlert && shark.state !== 'FLEEING' && (
        <div className="absolute top-22 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-red-600/95 text-white font-bold px-5 py-2 rounded-full shadow-2xl border-2 border-red-300 pointer-events-auto">
          <AlertTriangle className="w-4 h-4 animate-bounce" />
          <span className="text-xs tracking-wide uppercase">
            {shark.state === 'ATTACKING_RAFT'
              ? 'Bruce is biting your raft! Thrust spear to defend!'
              : 'Shark stalking swimmer in water! Return to raft!'}
          </span>
        </div>
      )}

      {/* 3. Center Crosshair & Interaction Prompts */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none">
        <div className="w-2.5 h-2.5 rounded-full bg-white/80 border border-black/70 shadow-sm" />

        {/* Hook Charge Bar */}
        {hookState === 'CHARGING' && (
          <div className="mt-3 w-28 h-2 bg-black/60 rounded-full overflow-hidden border border-white/40 shadow">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-red-500 transition-all duration-75"
              style={{ width: `${Math.round(hookPower * 100)}%` }}
            />
          </div>
        )}

        {/* Contextual Interaction Hint */}
        {interactPrompt && (
          <div className="mt-4 px-3 py-1.5 bg-slate-950/85 text-amber-300 text-xs font-semibold tracking-wide rounded-lg border border-amber-500/30 shadow-md">
            {interactPrompt}
          </div>
        )}
      </div>

      {/* 4. Bottom Left: Survival Need Bars */}
      <div className="absolute bottom-6 left-6 flex flex-col gap-2.5 bg-slate-900/85 backdrop-blur-md p-3.5 rounded-2xl border border-white/10 shadow-xl pointer-events-auto min-w-[210px]">
        {/* Health */}
        <div className="flex items-center gap-2.5">
          <Heart className="w-4 h-4 text-red-500 shrink-0" />
          <div className="flex-1">
            <div className="flex justify-between text-[11px] font-bold text-slate-300 mb-0.5">
              <span>HEALTH</span>
              <span>{Math.round(stats.health)}%</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-white/5">
              <div
                className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-300"
                style={{ width: `${Math.max(0, stats.health)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Hunger */}
        <div className="flex items-center gap-2.5">
          <Utensils className="w-4 h-4 text-amber-500 shrink-0" />
          <div className="flex-1">
            <div className="flex justify-between text-[11px] font-bold text-slate-300 mb-0.5">
              <span>HUNGER</span>
              <span>{Math.round(stats.hunger)}%</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-white/5">
              <div
                className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-300"
                style={{ width: `${Math.max(0, stats.hunger)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Thirst */}
        <div className="flex items-center gap-2.5">
          <Droplets className="w-4 h-4 text-sky-400 shrink-0" />
          <div className="flex-1">
            <div className="flex justify-between text-[11px] font-bold text-slate-300 mb-0.5">
              <span>THIRST</span>
              <span>{Math.round(stats.thirst)}%</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-white/5">
              <div
                className="h-full bg-gradient-to-r from-sky-600 to-sky-400 transition-all duration-300"
                style={{ width: `${Math.max(0, stats.thirst)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 5. Bottom Center: 8-Slot Hotbar & Build Palette */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-auto">
        {/* Build Mode Quick Palette & Scroll Hint */}
        {isBuildMode && (
          <div className="flex flex-col items-center gap-1.5 bg-slate-900/95 backdrop-blur-md px-4 py-2 rounded-2xl border border-emerald-500/30 shadow-2xl max-w-[94vw]">
            <div className="flex items-center gap-3 text-xs text-slate-300">
              <span className="font-bold uppercase tracking-wider text-emerald-400">
                {isDemolishMode ? 'DEMOLISH TOOL ACTIVE [X]' : 'BUILD MODE'}
              </span>
              <span className="text-slate-500">&bull;</span>
              <span className="text-amber-300 font-semibold">
                [Mouse Wheel] Scroll Pieces
              </span>
              <span className="text-slate-500">&bull;</span>
              <span>[R] Rotate (90°)</span>
              <span className="text-slate-500">&bull;</span>
              <span>[X] Toggle Demolish</span>
              {selectedBuildingDef && (
                <>
                  <span className="text-slate-500">&bull;</span>
                  <span className="text-slate-300 font-medium">
                    Cost:{' '}
                    {Object.entries(selectedBuildingDef.cost)
                      .map(([res, count]) => `${count} ${res}`)
                      .join(', ')}
                  </span>
                </>
              )}
            </div>

            {/* Carousel / Buttons */}
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pt-1 pb-0.5">
              {buildingOptions.map((bKey) => {
                const def = BUILDING_DEFINITIONS[bKey];
                const isSelected = selectedBuilding === bKey && !isDemolishMode;
                return (
                  <button
                    key={bKey}
                    onClick={() => onSelectBuilding(bKey)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium whitespace-nowrap transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-600 text-white font-bold shadow ring-2 ring-emerald-300'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <span className="mr-1">{def.icon}</span>
                    {def.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Hotbar Slots 1-8 */}
        <div className="flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-md p-2 rounded-2xl border border-white/15 shadow-2xl">
          {hotbar.map((slot, idx) => {
            const isActive = activeHotbarIdx === idx;
            const itemDef = slot.itemId ? ITEM_DEFINITIONS[slot.itemId] : null;
            const isFood =
              slot.itemId &&
              [
                'cooked_fish',
                'cooked_potato',
                'coconut',
                'raw_potato',
                'raw_fish',
                'shark_meat',
                'cooked_shark_meat',
                'berry',
                'egg',
              ].includes(slot.itemId);
            const isDrink = slot.itemId && ['cup_freshwater', 'coconut'].includes(slot.itemId);
            const canEat = isFood && stats.hunger < 98;
            const canDrink = isDrink && stats.thirst < 98;

            return (
              <div
                key={idx}
                onClick={() => onSelectSlot(idx)}
                title={
                  itemDef
                    ? `${itemDef.name}\n${itemDef.description}${
                        isActive && (canEat || canDrink) ? '\n[Click again to Consume]' : ''
                      }`
                    : `Slot ${idx + 1}`
                }
                className={`relative w-13 h-13 rounded-xl flex items-center justify-center cursor-pointer transition-all border ${
                  isActive
                    ? 'bg-amber-500/25 border-amber-400 shadow-md scale-105'
                    : canEat
                    ? 'bg-emerald-950/40 border-emerald-500/60 hover:border-emerald-400'
                    : canDrink
                    ? 'bg-sky-950/40 border-sky-500/60 hover:border-sky-400'
                    : 'bg-slate-900/80 border-white/10 hover:border-white/30'
                }`}
              >
                {/* Slot index badge */}
                <span className="absolute top-1 left-1.5 text-[9px] font-bold text-slate-400">
                  {idx + 1}
                </span>

                {itemDef ? (
                  <>
                    <span className="text-xl">{itemDef.icon}</span>
                    {slot.count > 1 && (
                      <span className="absolute bottom-1 right-1.5 text-[11px] font-bold text-white bg-slate-950/70 px-1 rounded">
                        {slot.count}
                      </span>
                    )}
                    {isActive && canEat && (
                      <span className="absolute -top-1.5 right-0.5 text-[7px] font-extrabold bg-emerald-500 text-white px-1 rounded-full shadow animate-pulse">
                        EAT
                      </span>
                    )}
                    {isActive && canDrink && !canEat && (
                      <span className="absolute -top-1.5 right-0.5 text-[7px] font-extrabold bg-sky-500 text-white px-1 rounded-full shadow animate-pulse">
                        DRINK
                      </span>
                    )}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
