/**
 * 海面调参面板（开发调试用，Backquote 开关）。
 *
 * 通过 RaftGame 门面读写 OceanTuning，不接触具体系统；
 * 每次修改立即生效（uniform 下一帧更新），「重置」恢复默认波形。
 */

import { useCallback, useState } from 'react';
import type { RaftGame } from '../../game/raftGame';
import type { OceanTuning, WaveComponentParams } from '../../game/systems/environment/ocean';
import type { WeatherType } from '../../types/game';

const WEATHER_OPTIONS: Array<{ type: WeatherType; label: string }> = [
  { type: 'CLEAR', label: '☀️ 晴朗' },
  { type: 'LIGHT_FOG', label: '🌫️ 薄雾' },
  { type: 'HEAVY_RAIN', label: '🌧️ 暴风雨' },
];

interface OceanDebugPanelProps {
  game: RaftGame;
  onClose: () => void;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-slate-300">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-sky-400"
      />
      <span className="w-12 text-right font-mono text-slate-400">{value.toFixed(2)}</span>
    </label>
  );
}

export function OceanDebugPanel({ game, onClose }: OceanDebugPanelProps) {
  const [tuning, setTuning] = useState<OceanTuning>(() => game.commands.getOceanTuning());
  const [weather, setWeather] = useState<WeatherType>(() => game.commands.getWeather());

  const apply = useCallback(
    (patch: Partial<OceanTuning>) => {
      game.commands.setOceanTuning(patch);
      setTuning(game.commands.getOceanTuning());
    },
    [game]
  );

  const applyWave = (idx: number, patch: Partial<WaveComponentParams>) => {
    apply({ waves: tuning.waves.map((wv, i) => (i === idx ? { ...wv, ...patch } : { ...wv })) });
  };

  return (
    <div className="absolute top-4 right-4 z-40 w-80 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-slate-900/90 p-4 shadow-2xl border border-slate-700 backdrop-blur-sm pointer-events-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-sky-300">🌊 海面调参</h3>
        <div className="flex gap-2">
          <button
            onClick={() => {
              game.commands.resetOceanTuning();
              setTuning(game.commands.getOceanTuning());
            }}
            className="rounded-lg bg-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-600 transition-colors"
          >
            重置
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-600 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>

      {/* 全局参数 */}
      <div className="space-y-1.5 mb-3">
        <SliderRow
          label="整体波高"
          value={tuning.heightScale}
          min={0}
          max={5}
          step={0.05}
          onChange={(v) => apply({ heightScale: v })}
        />
        <SliderRow
          label="整体流速"
          value={tuning.timeScale}
          min={0}
          max={3}
          step={0.05}
          onChange={(v) => apply({ timeScale: v })}
        />
        <SliderRow
          label="水面偏移"
          value={tuning.baseOffset}
          min={-3}
          max={2}
          step={0.05}
          onChange={(v) => apply({ baseOffset: v })}
        />
        <SliderRow
          label="细节波光"
          value={tuning.detailStrength}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => apply({ detailStrength: v })}
        />
        <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={tuning.gridVisible}
            onChange={(e) => apply({ gridVisible: e.target.checked })}
            className="accent-sky-400"
          />
          网格线（调试参考，默认关）
        </label>
      </div>

      {/* 天气切换（立即生效，平滑过渡） */}
      <div className="mb-3">
        <div className="text-[11px] font-semibold text-slate-200 mb-1.5">天气</div>
        <div className="flex gap-1.5">
          {WEATHER_OPTIONS.map(({ type, label }) => (
            <button
              key={type}
              onClick={() => {
                game.commands.setWeather(type);
                setWeather(game.commands.getWeather());
              }}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                weather === type
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mt-1">
          提示：自然天气每 ~2 分钟随机切换，手动选择只是覆盖当前状态。
        </p>
      </div>

      {/* 分波参数 */}
      {tuning.waves.map((wv, idx) => (
        <div key={idx} className="mb-3 rounded-xl bg-slate-800/60 p-2.5">
          <div className="text-[11px] font-semibold text-slate-200 mb-1.5">
            波 {idx + 1}
            {idx === 3 && <span className="ml-1.5 text-slate-500">(长涌)</span>}
          </div>
          <div className="space-y-1.5">
            <SliderRow label="振幅" value={wv.amp} min={0} max={1} step={0.01} onChange={(v) => applyWave(idx, { amp: v })} />
            <SliderRow label="X 频率" value={wv.xFreq} min={0} max={0.3} step={0.002} onChange={(v) => applyWave(idx, { xFreq: v })} />
            <SliderRow label="Z 频率" value={wv.zFreq} min={0} max={0.3} step={0.002} onChange={(v) => applyWave(idx, { zFreq: v })} />
            <SliderRow label="相速" value={wv.speed} min={0} max={3} step={0.05} onChange={(v) => applyWave(idx, { speed: v })} />
          </div>
        </div>
      ))}

      <p className="text-[10px] text-slate-500">
        提示：天气（暴风雨）会在整体波高/流速上再乘自己的倍率。
      </p>
    </div>
  );
}
