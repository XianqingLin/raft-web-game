import React, { useState } from 'react';
import { InventorySlot, HotbarSlot, ResourceId } from '../../types/game';

interface CompactorModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventory: InventorySlot[];
  hotbar: HotbarSlot[];
  onFeedJunk: (type: ResourceId, count: number) => boolean;
  onForgeBlock: () => boolean;
}

export const CompactorModal: React.FC<CompactorModalProps> = ({
  isOpen,
  onClose,
  inventory,
  hotbar,
  onFeedJunk,
  onForgeBlock,
}) => {
  const [loadedCount, setLoadedCount] = useState(0);
  const [isPressing, setIsPressing] = useState(false);

  if (!isOpen) return null;

  // Calculate available ocean junk
  const getResourceCount = (id: ResourceId): number => {
    let total = 0;
    hotbar.forEach((s) => {
      if (s.itemId === id) total += s.count;
    });
    inventory.forEach((s) => {
      if (s.itemId === id) total += s.count;
    });
    return total;
  };

  const woodCount = getResourceCount('wood');
  const plasticCount = getResourceCount('plastic');
  const leafCount = getResourceCount('leaf');
  const scrapCount = getResourceCount('scrap');
  const blockCount = getResourceCount('salvaged_scrap_block');

  const totalJunk = woodCount + plasticCount + leafCount + scrapCount;

  const handleDeposit = (res: ResourceId) => {
    if (loadedCount >= 10) return;
    const ok = onFeedJunk(res, 1);
    if (ok) {
      setLoadedCount((prev) => Math.min(10, prev + 1));
    }
  };

  const handleDepositBulk = () => {
    let needed = 10 - loadedCount;
    if (needed <= 0) return;

    const resources: ResourceId[] = ['plastic', 'leaf', 'wood', 'scrap'];
    for (const res of resources) {
      const avail = getResourceCount(res);
      const toTake = Math.min(needed, avail);
      if (toTake > 0) {
        const ok = onFeedJunk(res, toTake);
        if (ok) {
          needed -= toTake;
          setLoadedCount((prev) => prev + toTake);
        }
      }
      if (needed <= 0) break;
    }
  };

  const handleCompress = () => {
    if (loadedCount < 10 || isPressing) return;
    setIsPressing(true);
    setTimeout(() => {
      const ok = onForgeBlock();
      if (ok) {
        setLoadedCount(0);
      }
      setIsPressing(false);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans select-none animate-in fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border-2 border-amber-600/50 rounded-2xl shadow-2xl p-6 text-slate-100 flex flex-col gap-5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🗜️</span>
            <div>
              <h2 className="text-lg font-black tracking-wide text-amber-400">DEBRIS COMPACTOR</h2>
              <p className="text-xs text-slate-400">Survive the Ocean Economy by Forging Salvaged Scrap Blocks</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Compression Chamber Visualizer */}
        <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-300">Hopper Compression Capacity:</span>
            <span className={`font-mono text-sm ${loadedCount >= 10 ? 'text-emerald-400 font-bold' : 'text-amber-400'}`}>
              {loadedCount} / 10 Raw Junk
            </span>
          </div>

          {/* Progress gauge bar */}
          <div className="w-full h-4 bg-slate-800 rounded-full overflow-hidden border border-slate-700 p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                loadedCount >= 10
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_10px_#10b981]'
                  : 'bg-gradient-to-r from-amber-500 to-orange-500'
              }`}
              style={{ width: `${(loadedCount / 10) * 100}%` }}
            />
          </div>

          {/* Animated Hydraulic Piston Status */}
          <div className="flex items-center justify-center p-3 rounded-lg bg-slate-900/60 border border-slate-800/80">
            {isPressing ? (
              <div className="flex items-center gap-2 text-amber-400 font-mono text-xs font-bold animate-pulse">
                <span>⚙️ HYDRAULIC RAM FORGING BLOCK...</span>
              </div>
            ) : loadedCount >= 10 ? (
              <div className="text-emerald-400 font-mono text-xs font-bold">
                ✓ CHAMBER FULL & READY FOR COMPACTION
              </div>
            ) : (
              <div className="text-slate-400 text-xs">
                Load {10 - loadedCount} more ocean junk pieces into the hopper chute.
              </div>
            )}
          </div>
        </div>

        {/* Feed Raw Junk Buttons */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-slate-300 font-bold">
            <span>Deposit Raw Ocean Junk:</span>
            <button
              onClick={handleDepositBulk}
              disabled={loadedCount >= 10 || totalJunk === 0}
              className="text-[11px] text-amber-400 hover:text-amber-300 disabled:opacity-40 underline cursor-pointer"
            >
              Deposit Fill (Up to 10)
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[
              { id: 'wood' as ResourceId, name: 'Plank', icon: '🪵', count: woodCount, color: 'text-amber-500' },
              { id: 'plastic' as ResourceId, name: 'Plastic', icon: '🥤', count: plasticCount, color: 'text-sky-400' },
              { id: 'leaf' as ResourceId, name: 'Leaf', icon: '🌿', count: leafCount, color: 'text-emerald-400' },
              { id: 'scrap' as ResourceId, name: 'Scrap', icon: '🔩', count: scrapCount, color: 'text-slate-400' },
            ].map((j) => (
              <button
                key={j.id}
                onClick={() => handleDeposit(j.id)}
                disabled={j.count === 0 || loadedCount >= 10 || isPressing}
                className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 disabled:opacity-35 border border-slate-700 hover:border-amber-500/50 transition-all cursor-pointer group"
              >
                <span className="text-2xl group-hover:scale-110 transition-transform">{j.icon}</span>
                <span className="text-xs font-bold mt-1 text-slate-200">{j.name}</span>
                <span className={`text-[10px] font-mono ${j.color}`}>Avail: {j.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Forge / Pull Lever Action */}
        <button
          onClick={handleCompress}
          disabled={loadedCount < 10 || isPressing}
          className={`w-full py-3.5 px-4 rounded-xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg ${
            loadedCount >= 10 && !isPressing
              ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 cursor-pointer shadow-orange-500/20 active:scale-[0.98]'
              : 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed opacity-60'
          }`}
        >
          <span>⚡</span>
          <span>{isPressing ? 'Forging Block...' : 'Pull Lever & Compress (Forge 1 Block)'}</span>
        </button>

        {/* Currency Summary */}
        <div className="flex items-center justify-between text-xs bg-slate-950 p-3 rounded-xl border border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧱</span>
            <span className="text-slate-300">Salvaged Scrap Blocks in Inventory:</span>
          </div>
          <span className="font-mono text-base font-bold text-emerald-400">{blockCount} Blocks</span>
        </div>
      </div>
    </div>
  );
};
