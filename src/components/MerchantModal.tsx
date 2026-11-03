import React from 'react';
import { MERCHANT_ITEMS } from '../data/merchant';
import { MerchantItem } from '../types/game';

interface MerchantModalProps {
  isOpen: boolean;
  onClose: () => void;
  salvagedBlockCount: number;
  onBuyItem: (item: MerchantItem) => boolean;
}

export const MerchantModal: React.FC<MerchantModalProps> = ({
  isOpen,
  onClose,
  salvagedBlockCount,
  onBuyItem,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 font-sans select-none animate-in fade-in">
      <div className="relative w-full max-w-2xl bg-slate-900 border-2 border-emerald-500/50 rounded-2xl shadow-2xl p-6 text-slate-100 flex flex-col gap-5 max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">⚖️</span>
            <div>
              <h2 className="text-xl font-black tracking-wide text-emerald-400">SURVIVOR OUTPOST BARTER</h2>
              <p className="text-xs text-slate-400">Trade Salvaged Scrap Blocks for High-Tier Equipment & Rare Tech</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Player Currency Header */}
        <div className="flex items-center justify-between bg-slate-950/80 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🧱</span>
            <div>
              <div className="text-xs text-slate-400">Available Currency</div>
              <div className="text-xs font-bold text-slate-200">Salvaged Scrap Blocks</div>
            </div>
          </div>
          <div className="text-xl font-mono font-bold text-emerald-400 bg-emerald-950/60 px-3 py-1 rounded-lg border border-emerald-500/40">
            {salvagedBlockCount} Blocks
          </div>
        </div>

        {/* Merchant Catalog Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto pr-1 max-h-[50vh] scrollbar-thin">
          {MERCHANT_ITEMS.map((item) => {
            const canAfford = salvagedBlockCount >= item.costBlocks;
            return (
              <div
                key={item.id}
                className="flex flex-col justify-between p-3.5 rounded-xl bg-slate-800/80 border border-slate-700/80 hover:border-emerald-500/50 transition-all gap-2"
              >
                <div className="flex items-start gap-3">
                  <div className="text-3xl p-2 rounded-xl bg-slate-900 border border-slate-700/60 shrink-0">
                    {item.icon}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-100">{item.name}</span>
                    <span className="text-[11px] text-slate-400 leading-tight mt-0.5">{item.description}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-700/50 pt-2.5 mt-1">
                  <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-amber-300">
                    <span>🧱</span>
                    <span>{item.costBlocks} Blocks</span>
                  </div>
                  <button
                    onClick={() => onBuyItem(item)}
                    disabled={!canAfford}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-1 ${
                      canAfford
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer active:scale-95 shadow-md shadow-emerald-700/30'
                        : 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-50'
                    }`}
                  >
                    <span>Barter</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Prompt */}
        <div className="text-center text-[11px] text-slate-400 pt-1 border-t border-slate-800">
          Feed plastic, planks, leaves, and scrap into your <span className="text-amber-400 font-bold">Debris Compactor</span> to forge more Salvaged Scrap Blocks.
        </div>
      </div>
    </div>
  );
};
