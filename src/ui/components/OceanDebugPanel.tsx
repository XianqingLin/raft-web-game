/**
 * 海面/风调参面板（开发调试用，Backquote 开关）。
 *
 * 通过 RaftGame 门面读写，不接触具体系统；波形滑杆立即生效（uniform 下一帧
 * 更新）。风区含雷达图：自调节开启时只读镜像，关闭后拖拽箭头同步风向、
 * 滑杆设风速。天气自调节关闭后，天气按钮直接切换（不再强制工况）。
 */

import { useEffect, useRef, useState } from 'react';
import type { RaftGame } from '../../game/raftGame';
import type { OceanTuning } from '../../game/systems/environment/ocean';
import type { WindDebugState } from '../../game/systems/environment/wind';
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

function SliderRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-slate-300">
      <span className="w-16 shrink-0">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        className="flex-1 accent-sky-400"
      />
      <span className="w-12 text-right font-mono text-slate-400">{props.value.toFixed(2)}</span>
    </label>
  );
}

const R = 52; // 雷达半径（px）

/**
 * 风雷达：圆形刻度盘 + 风箭头（自调节关闭时可拖拽）+ 海流细箭头（只读）。
 * 拖拽 = 箭头实时指向指针方向（0° = 正北，顺时针）。
 */
function WindRadar({
  wind,
  onManual,
}: {
  wind: WindDebugState;
  onManual: (dirDeg: number, speed: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);

  const angleFromPointer = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    if (rect.width === 0) return wind.windDirDeg;
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    // 屏幕坐标 y 向下；atan2(dx, -dy) 使 0° 指向正上（北），顺时针为正
    return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  };

  const handleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    setDragging(true);
    onManual(angleFromPointer(e), wind.windSpeed);
  };
  const handleMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    onManual(angleFromPointer(e), wind.windSpeed);
  };
  const handleUp = () => setDragging(false);

  const polar = (dirDeg: number, len: number) => ({
    x: 60 + Math.sin((dirDeg * Math.PI) / 180) * len,
    y: 60 - Math.cos((dirDeg * Math.PI) / 180) * len,
  });
  const windEnd = polar(wind.windDirDeg, Math.min(R, 10 + wind.windSpeed * 7));
  const curEnd = polar(wind.currentDirDeg, Math.min(R, 10 + wind.currentSpeed * 7));

  return (
    <svg
      ref={svgRef}
      width={120}
      height={120}
      className={`shrink-0 select-none ${wind.auto ? 'cursor-default' : 'cursor-crosshair'}`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
    >
      <circle cx={60} cy={60} r={R} fill="rgba(2,6,23,0.5)" stroke="#475569" />
      {[0, 90, 180, 270].map((d) => {
        const a = polar(d, R - 8);
        const b = polar(d, R - 1);
        return <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#64748b" />;
      })}
      {/* 风箭头（蓝色，自调节关闭时可拖拽） */}
      <line x1={60} y1={60} x2={windEnd.x} y2={windEnd.y} stroke="#7dd3fc" strokeWidth={3} />
      <circle cx={windEnd.x} cy={windEnd.y} r={4} fill="#7dd3fc" />
      {/* 海流细箭头（青色，只读；与风箭头的夹角 = 海流滞后） */}
      <line x1={60} y1={60} x2={curEnd.x} y2={curEnd.y} stroke="#22d3ee" strokeWidth={1.5} />
      <circle cx={curEnd.x} cy={curEnd.y} r={3} fill="#22d3ee" />
      <text x={60} y={14} textAnchor="middle" fontSize={9} fill="#94a3b8">N</text>
      <text x={112} y={63} textAnchor="middle" fontSize={9} fill="#94a3b8">E</text>
      <text x={60} y={114} textAnchor="middle" fontSize={9} fill="#94a3b8">S</text>
      <text x={8} y={63} textAnchor="middle" fontSize={9} fill="#94a3b8">W</text>
    </svg>
  );
}

export function OceanDebugPanel({ game, onClose }: OceanDebugPanelProps) {
  const [tuning, setTuning] = useState<OceanTuning>(() => game.debug.getOceanTuning());
  const [weather, setWeather] = useState<WeatherType>(() => game.debug.getWeather());
  const [wind, setWind] = useState<WindDebugState>(() => game.debug.getWindDebug());
  const [weatherAuto, setWeatherAutoState] = useState(true);

  useEffect(() => {
    const timer = window.setInterval(() => setWind(game.debug.getWindDebug()), 300);
    return () => window.clearInterval(timer);
  }, [game]);

  const apply = (patch: Partial<OceanTuning>) => {
    game.debug.setOceanTuning(patch);
    setTuning(game.debug.getOceanTuning());
  };

  /** 拖雷达/拖风速滑杆：自调节开启则先关闭，再写入手动值（本地乐观更新 + 300ms 轮询兜底） */
  const manualWind = (dirDeg: number, speed: number) => {
    if (wind.auto) {
      game.debug.setWindAuto(false);
      setWind({ ...wind, auto: false });
    }
    game.debug.setManualWind(dirDeg, speed);
    setWind({ ...wind, auto: false, windDirDeg: dirDeg, windSpeed: speed });
  };

  return (
    <div className="absolute top-4 right-4 z-40 w-80 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-slate-900/90 p-4 shadow-2xl border border-slate-700 backdrop-blur-sm pointer-events-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-sky-300">🌊 海面调参</h3>
        <div className="flex gap-2">
          <button
            onClick={() => {
              game.debug.resetOceanTuning();
              setTuning(game.debug.getOceanTuning());
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

      {/* 风（雷达 + 手动控制；自调节关闭后生效） */}
      <div className="mb-3 rounded-xl bg-slate-800/60 p-2.5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-semibold text-slate-200">🌬️ 风与海流</div>
          <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={wind.auto}
              onChange={(e) => game.debug.setWindAuto(e.target.checked)}
              className="accent-sky-400"
            />
            风自调节
          </label>
        </div>
        <div className="flex items-center gap-3">
          <WindRadar wind={wind} onManual={manualWind} />
          <div className="flex-1 space-y-1.5">
            <SliderRow
              label="风速"
              value={wind.windSpeed}
              min={0}
              max={6}
              step={0.1}
              onChange={(v) => manualWind(wind.windDirDeg, v)}
            />
            <p className="text-[10px] text-slate-500">
              {wind.auto ? '自调节中：雷达只读镜像' : '手动模式：拖箭头转风向'}
            </p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-300 font-mono">
          <span>风向 {wind.windDirDeg.toFixed(0)}°</span>
          <span>风速 {wind.windSpeed.toFixed(2)} m/s</span>
          <span>流向 {wind.currentDirDeg.toFixed(0)}°</span>
          <span>流速 {wind.currentSpeed.toFixed(2)} m/s</span>
          <span>航程 {wind.distanceM.toFixed(1)} m</span>
          <span>筏速 {wind.flowSpeed.toFixed(2)} m/s</span>
          <span>
            {wind.regimeLabel} / 湿度 {(wind.humidity * 100).toFixed(0)}%
          </span>
          <span>开帆 {wind.openSails}</span>
          <span>划桨 {wind.paddling ? '是' : '否'}</span>
        </div>
      </div>

      {/* 天气（自调节关闭后按钮直接切换并冻结） */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] font-semibold text-slate-200">天气</div>
          <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={weatherAuto}
              onChange={(e) => {
                game.debug.setWeatherAuto(e.target.checked);
                setWeatherAutoState(e.target.checked);
              }}
              className="accent-sky-400"
            />
            天气自调节
          </label>
        </div>
        <div className="flex gap-1.5">
          {WEATHER_OPTIONS.map(({ type, label }) => (
            <button
              key={type}
              onClick={() => {
                game.debug.setWeather(type);
                setWeather(game.debug.getWeather());
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
          自调节开：按钮强制工况（25 秒后交还演化）；关：直接切换并冻结。
        </p>
      </div>

      {/* 全局波形参数（分波参数已移除） */}
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

      <p className="text-[10px] text-slate-500">
        提示：天气在整体波高/流速上乘自己的倍率；风是天气与海流的唯一上游。
      </p>
    </div>
  );
}
