import type { WorldView } from '../../worldView';
import type { OceanEnvironment } from './ocean';
import type { WindState } from './wind';
import * as THREE from 'three';
import { WeatherType } from '../../../types/game';
import { soundManager } from '../../../audio/soundManager';
import { events } from '../../../core/events';
import { createRainVisual } from './rain';

/**
 * 天气不是自主系统：由风+湿度派生（风是唯一源头，见 wind.ts 头注释）。
 * 派生判据全部带迟滞（进入/退出阈值分离 + 持续时间要求），防止在阈值
 * 边缘抖动；调试面板的"选天气"= 强制工况（拨动风与湿度）+ 覆盖保持期。
 */

export interface WindDependency {
  getWindState: () => WindState;
  getWindVector: () => { x: number; z: number };
  forceCondition: (type: WeatherType) => void;
}

export interface WeatherSystem {
  currentWeather: WeatherType;
  update: (dt: number, elapsed: number) => void;
  setWeather: (type: WeatherType) => void;
  /** 【仅调试】天气自调节开关：关闭后天气冻结在手动选择 */
  setAuto: (on: boolean) => void;
  getWaveHeightMultiplier: () => number;
  getWaveSpeedMultiplier: () => number;
  getOceanColor: () => THREE.Color;
  getOceanRoughness: () => number;
  dispose: () => void;
}

export function createWeatherSystem(
  scene: THREE.Scene,
  sunLight: THREE.DirectionalLight,
  ambientLight: THREE.AmbientLight,
  hemiLight: THREE.HemisphereLight,
  /** 相机位置（雨幕跟随），逐帧惰性拉取 */
  getCameraPos: () => THREE.Vector3,
  /** 水面高度采样（水花圆环贴合波形；来自 OceanEnvironment.getWaveHeightAt） */
  getWaveHeightAt: (x: number, z: number) => number,
  /** 风依赖（天气派生的唯一上游） */
  wind: WindDependency,
  onWeatherChange?: (weather: WeatherType) => void
): WeatherSystem {
  let currentWeather: WeatherType = 'CLEAR';
  let targetWeather: WeatherType = 'CLEAR';
  let transitionProgress = 1.0; // 0..1 blend

  // —— 风→天气派生状态（迟滞判据）——
  let weatherAuto = true; // 关闭后天气冻结在手动选择，派生暂停
  let overrideHold = 0; // 强制天气的保持期（秒），期间暂停派生
  let stormIn = 0;
  let stormOut = 0;
  let fogIn = 0;
  let fogOut = 0;

  // 雨的视觉层（雨丝/水花在 rain.ts）：weather 只决策雨量，渲染参数逐帧喂给它
  const rainVisual = createRainVisual(scene, getWaveHeightAt);

  // Lightning system
  let lightningTimer = 15 + Math.random() * 10;
  let isFlashing = false;
  let flashDuration = 0;

  // Colors & targets
  const clearFogDensity = 0.007;
  const mistyFogDensity = 0.027;
  const rainyFogDensity = 0.021;

  const clearSkyColor = new THREE.Color(0x87ceeb);
  const mistySkyColor = new THREE.Color(0x9caec2);
  const stormSkyColor = new THREE.Color(0x2d3a4d);

  const clearOceanColor = new THREE.Color(0x0284c7);
  const mistyOceanColor = new THREE.Color(0x387a99);
  const stormOceanColor = new THREE.Color(0x0f2c3d);

  let currentOceanColor = new THREE.Color().copy(clearOceanColor);
  let currentOceanRoughness = 0.15;
  let waveHeightMult = 1.0;
  let waveSpeedMult = 1.0;

  /** 内部唯一切换点：平滑过渡 + 事件广播 */
  const applyWeather = (type: WeatherType) => {
    if (type === currentWeather) return;
    targetWeather = type;
    currentWeather = type;
    transitionProgress = 0.0;
    onWeatherChange?.(type);
  };

  /**
   * 外部设置天气。自调节开启 = 强制工况（拨风与湿度，25s 后交还派生）；
   * 自调节关闭 = 天气冻结在手动选择，直接切换、不碰风。
   */
  const setWeather = (type: WeatherType) => {
    if (weatherAuto) {
      wind.forceCondition(type);
      overrideHold = 25;
    }
    applyWeather(type);
  };

  const setAuto = (on: boolean) => {
    weatherAuto = on;
    if (on) overrideHold = 0; // 立即交还派生（判据的持续时间要求天然防跳变）
  };

  /** 风→天气派生：判据全带迟滞（进入/退出阈值分离 + 持续时间） */
  const deriveFromWind = (dt: number) => {
    if (!weatherAuto || overrideHold > 0) {
      if (overrideHold > 0) overrideHold -= dt;
      return;
    }
    const ws = wind.getWindState();

    const enterStorm = ws.speed > 4.4 && ws.humidity > 0.45;
    stormIn = enterStorm ? stormIn + dt : 0;
    stormOut = !enterStorm && ws.speed < 3.6 ? stormOut + dt : 0;

    const enterFog = ws.speed < 1.3 && ws.humidity > 0.55;
    fogIn = enterFog ? fogIn + dt : 0;
    fogOut = !enterFog && (ws.speed > 1.8 || ws.humidity < 0.4) ? fogOut + dt : 0;

    // 强风低湿 → 大风晴天（无雨但浪涌流急），是这套派生的多样性的来源
    if (currentWeather === 'HEAVY_RAIN' && stormOut >= 15) {
      applyWeather('CLEAR');
    } else if (currentWeather !== 'HEAVY_RAIN' && stormIn >= 8) {
      applyWeather('HEAVY_RAIN');
    } else if (currentWeather === 'LIGHT_FOG' && fogOut >= 12) {
      applyWeather('CLEAR');
    } else if (currentWeather === 'CLEAR' && fogIn >= 10) {
      applyWeather('LIGHT_FOG');
    }
  };

  const update = (dt: number) => {
    const cameraPos = getCameraPos();

    // 1. 天气派生：风是唯一上游（强风高湿→暴雨，静风高湿→雾，其余晴）
    deriveFromWind(dt);

    // 2. Smooth weather transitions
    if (transitionProgress < 1.0) {
      transitionProgress = Math.min(1.0, transitionProgress + dt * 0.35);
    }

    // Determine target parameters
    let targetFogDensity = clearFogDensity;
    let targetSkyColor = clearSkyColor;
    let targetOcean = clearOceanColor;
    let targetRoughness = 0.15;
    let targetWaveHeight = 1.0;
    let targetWaveSpeed = 1.0;
    let targetSunDim = 1.0;
    let targetRainOpacity = 0.0;
    let targetRainAudioVol = 0.0;

    if (currentWeather === 'LIGHT_FOG') {
      targetFogDensity = mistyFogDensity;
      targetSkyColor = mistySkyColor;
      targetOcean = mistyOceanColor;
      targetRoughness = 0.28;
      targetWaveHeight = 0.85;
      targetWaveSpeed = 0.9;
      targetSunDim = 0.45;
      targetRainOpacity = 0.0;
      targetRainAudioVol = 0.0;
    } else if (currentWeather === 'HEAVY_RAIN') {
      targetFogDensity = rainyFogDensity;
      targetSkyColor = stormSkyColor;
      targetOcean = stormOceanColor;
      targetRoughness = 0.22;
      targetWaveHeight = 2.4;
      targetWaveSpeed = 1.65;
      targetSunDim = 0.28;
      targetRainOpacity = 0.5;
      targetRainAudioVol = 0.48;
    }

    // Smooth lerps
    currentOceanColor.lerp(targetOcean, dt * 1.5);
    currentOceanRoughness = THREE.MathUtils.lerp(currentOceanRoughness, targetRoughness, dt * 1.5);
    waveHeightMult = THREE.MathUtils.lerp(waveHeightMult, targetWaveHeight, dt * 1.5);
    waveSpeedMult = THREE.MathUtils.lerp(waveSpeedMult, targetWaveSpeed, dt * 1.5);

    // Fog & Sky
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.density = THREE.MathUtils.lerp(scene.fog.density, targetFogDensity, dt * 1.2);
      scene.fog.color.lerp(targetSkyColor, dt * 1.2);
    }
    if (scene.background instanceof THREE.Color) {
      scene.background.lerp(targetSkyColor, dt * 1.2);
    }

    // Rain sound
    soundManager.setRainVolume(THREE.MathUtils.lerp(0, targetRainAudioVol, transitionProgress));

    // 3. Rain simulation：渲染细节在 rain.ts，这里只喂参数（相机/风/目标雨量）
    const windVec = wind.getWindVector();
    rainVisual.update(dt, {
      cameraPos,
      windVec,
      opacityTarget: targetRainOpacity,
    });

    // 4. Heavy Rain Lightning and Thunder
    if (currentWeather === 'HEAVY_RAIN') {
      lightningTimer -= dt;
      if (lightningTimer <= 0) {
        lightningTimer = 14 + Math.random() * 16;
        isFlashing = true;
        flashDuration = 0.09;
        soundManager.playThunder();
      }

      if (isFlashing) {
        flashDuration -= dt;
        if (flashDuration <= 0) {
          isFlashing = false;
        } else {
          // Intense flash
          sunLight.intensity = 2.6;
          ambientLight.intensity = 1.2;
          hemiLight.intensity = 1.4;
          if (scene.background instanceof THREE.Color) {
            scene.background.setHex(0xe2e8f0);
          }
        }
      }
    } else {
      isFlashing = false;
    }
  };

  const dispose = () => {
    rainVisual.dispose();
  };

  return {
    get currentWeather() {
      return currentWeather;
    },
    update,
    setWeather,
    setAuto,
    getWaveHeightMultiplier: () => waveHeightMult,
    getWaveSpeedMultiplier: () => waveSpeedMult,
    getOceanColor: () => currentOceanColor,
    getOceanRoughness: () => currentOceanRoughness,
    dispose,
  };
}

// ==================== Factory（由 Raft 组合根统一接线） ====================

export function createWeather(w: WorldView, ocean: OceanEnvironment): WeatherSystem {
  return createWeatherSystem(
    w.scene,
    ocean.sunLight,
    ocean.ambientLight,
    ocean.hemiLight,
    () => w.camera.position,
    ocean.getWaveHeightAt,
    {
      getWindState: () => w.wind().getWindState(),
      getWindVector: () => w.wind().getWindVector(),
      forceCondition: (type) => w.wind().forceCondition(type),
    },
    (newWeather) => {
      events.emit('weatherChanged', newWeather);
      const toast =
        newWeather === 'LIGHT_FOG'
          ? { text: '🌫️ A thick sea mist rolls across the ocean waters...', color: '#94a3b8' }
          : newWeather === 'HEAVY_RAIN'
          ? { text: '🌧️ A tropical storm strikes! Rough waves and rain!', color: '#38bdf8' }
          : { text: '☀️ The skies clear over the open sea.', color: '#fde047' };
      events.emit('toast', toast);
    }
  );
}
