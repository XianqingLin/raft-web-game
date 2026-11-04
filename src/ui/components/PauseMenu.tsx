import React, { useState } from 'react';
import { Play, Volume2, VolumeX, RotateCcw, Compass, Save, RefreshCw } from 'lucide-react';
import { soundManager } from '../../audio/soundManager';

interface PauseMenuProps {
  isOpen: boolean;
  onResume: () => void;
  onRespawn: () => void;
  onSaveWorld?: () => void;
  onResetWorld?: () => void;
}

export const PauseMenu: React.FC<PauseMenuProps> = ({
  isOpen,
  onResume,
  onRespawn,
  onSaveWorld,
  onResetWorld,
}) => {
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 select-none">
      <div className="bg-slate-900 border border-white/20 rounded-3xl shadow-2xl w-full max-w-xl p-7 text-center flex flex-col items-center max-h-[95vh] overflow-y-auto">
        {/* Title */}
        <div className="flex items-center gap-2.5 mb-1.5">
          <Compass className="w-8 h-8 text-sky-400" />
          <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-amber-300 to-amber-500 tracking-wider">
            OCEANIC RAFT 3D
          </h1>
        </div>
        <p className="text-xs text-slate-300 max-w-md mb-4 leading-relaxed">
          Survive the open sea, salvage ocean drift with your hook, defend against Bruce, craft survival stations, and build your raft!
        </p>

        {/* Controls Grid */}
        <div className="w-full bg-slate-950/80 border border-white/10 rounded-2xl p-3.5 text-left mb-4 text-xs text-slate-300 flex flex-col gap-1.5">
          <div className="flex justify-between items-center py-0.5 border-b border-white/5">
            <span className="text-slate-400">Movement & Swimming</span>
            <span className="font-mono font-bold text-amber-300 bg-slate-800 px-2 py-0.5 rounded">W A S D + SPACE (Swim/Climb)</span>
          </div>
          <div className="flex justify-between items-center py-0.5 border-b border-white/5">
            <span className="text-slate-400">Scrap Hook</span>
            <span className="font-mono font-bold text-amber-300 bg-slate-800 px-2 py-0.5 rounded">Hold Left-Click (Throw) / Click (Reel)</span>
          </div>
          <div className="flex justify-between items-center py-0.5 border-b border-white/5">
            <span className="text-slate-400">Raft Construction Planks</span>
            <span className="font-mono font-bold text-amber-300 bg-slate-800 px-2 py-0.5 rounded">[B] Build (Planks snap to lower & upper decks)</span>
          </div>
          <div className="flex justify-between items-center py-0.5 border-b border-white/5">
            <span className="text-slate-400">Station Auto-Cook & Auto-Eat</span>
            <span className="font-mono font-bold text-amber-300 bg-slate-800 px-2 py-0.5 rounded">[E] or [Left-Click] on Grill / Purifier</span>
          </div>
          <div className="flex justify-between items-center py-0.5">
            <span className="text-slate-400">Survivor Notebook & Storage</span>
            <span className="font-mono font-bold text-amber-300 bg-slate-800 px-2 py-0.5 rounded">[I] / [Tab] Key</span>
          </div>
        </div>

        {/* Primary CTA */}
        <button
          onClick={onResume}
          className="w-full flex items-center justify-center gap-2 py-3 px-6 bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white font-bold rounded-2xl shadow-xl shadow-sky-900/30 text-base cursor-pointer transition-all hover:scale-[1.01] mb-3"
        >
          <Play className="w-5 h-5 fill-current" />
          <span>RESUME SURVIVAL</span>
        </button>

        {/* World Saving & Reset Buttons */}
        <div className="w-full flex items-center gap-2.5 mb-2">
          <button
            onClick={() => onSaveWorld?.()}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 bg-emerald-600/90 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl border border-emerald-400/30 transition-all cursor-pointer shadow-md"
          >
            <Save className="w-4 h-4" />
            <span>Save World</span>
          </button>

          {!showResetConfirm ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-800 hover:bg-red-950/60 text-slate-300 hover:text-red-300 font-medium text-xs rounded-xl border border-white/10 hover:border-red-500/30 transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset World</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 bg-red-950/80 px-2.5 py-1.5 rounded-xl border border-red-500/50">
              <span className="text-[11px] text-red-200 font-semibold">Confirm Reset?</span>
              <button
                onClick={() => {
                  setShowResetConfirm(false);
                  onResetWorld?.();
                }}
                className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold rounded cursor-pointer"
              >
                Yes
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-2 py-0.5 bg-slate-800 text-slate-300 text-[11px] rounded cursor-pointer"
              >
                No
              </button>
            </div>
          )}
        </div>

        {/* Audio & Respawn Footer */}
        <div className="flex items-center gap-4 mt-2 text-xs">
          <button
            onClick={() => soundManager.toggleMute()}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            {soundManager.getIsMuted() ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-sky-400" />}
            <span>{soundManager.getIsMuted() ? 'Unmute Audio' : 'Mute Audio'}</span>
          </button>
          <span className="text-slate-600">&bull;</span>
          <button
            onClick={onRespawn}
            className="flex items-center gap-1.5 text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Respawn On Raft</span>
          </button>
        </div>
      </div>
    </div>
  );
};
