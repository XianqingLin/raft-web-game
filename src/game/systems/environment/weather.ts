import type { WorldView } from '../../worldView';
import type { OceanEnvironment } from './ocean';
import type { WindState } from './wind';
import * as THREE from 'three';
import { WeatherType } from '../../../types/game';
import { soundManager } from '../../../audio/soundManager';
import { events } from '../../../core/events';

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

  // ==================== GPU 雨丝（LineSegments，细长半透明 streak，下落/风漂/相机环绕全在 shader 内） ====================
  const rainCount = 7000;
  const rainArea = 56; // 相机周围 XZ 覆盖范围（世界单位）
  const rainTop = 30; // 雨幕顶部高度

  const rainGeo = new THREE.BufferGeometry();
  // position 仅用于确定绘制数量，真实位置在顶点着色器里由种子推导
  rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rainCount * 6), 3));
  // 每滴雨 2 个顶点，两个顶点必须共享同一份种子，否则线段两端落到不同位置、乱成网
  const rainSeeds = new Float32Array(rainCount * 6);
  const rainTips = new Float32Array(rainCount * 2);
  for (let i = 0; i < rainCount; i++) {
    const sx = Math.random();
    const sy = Math.random();
    const sz = Math.random();
    for (let k = 0; k < 2; k++) {
      rainSeeds[(i * 2 + k) * 3] = sx;
      rainSeeds[(i * 2 + k) * 3 + 1] = sy;
      rainSeeds[(i * 2 + k) * 3 + 2] = sz;
    }
    rainTips[i * 2] = 0;
    rainTips[i * 2 + 1] = 1;
  }
  rainGeo.setAttribute('aSeed', new THREE.BufferAttribute(rainSeeds, 3));
  rainGeo.setAttribute('aTip', new THREE.BufferAttribute(rainTips, 1));

  const rainUniforms = {
    uTime: { value: 0 },
    uArea: { value: rainArea },
    uTop: { value: rainTop },
    // 雨丝水平风漂：每帧同步真实风向量（WindSystem），雨的倾斜方向与风一致
    uWind: { value: new THREE.Vector2(-2.5, 1.6) },
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color(0xf5faff) },
  };

  const rainVert = /* glsl */ `
uniform float uTime;
uniform float uArea;
uniform float uTop;
uniform vec2 uWind;
uniform float uOpacity;
attribute vec3 aSeed;
attribute float aTip;
varying float vAlpha;
varying float vTip;

void main() {
  // 下落速度按种子错开（26~40），相位独立使雨丝彼此脱节
  float speed = mix(26.0, 40.0, fract(aSeed.x * 7.31 + aSeed.z * 3.17));
  // XZ：世界固定雨场 + 相机跟随取模环绕（GLSL mod 恒为正，窗口始终套住相机）
  vec2 xz = mod(aSeed.xy * uArea + uWind * uTime - cameraPosition.xz, vec2(uArea))
          + cameraPosition.xz - uArea * 0.5;
  float y = uTop - mod(aSeed.z * uTop + uTime * speed, uTop);
  vec3 pos = vec3(xz.x, y, xz.y);
  // 雨丝沿速度方向拉伸；长短差异大（0.6~2.4m，偏向短丝），才有自然雨的层次感
  vec3 dir = normalize(vec3(uWind.x, -speed, uWind.y));
  float lenRand = fract(aSeed.y * 9.73 + aSeed.z * 5.11);
  float len = mix(0.6, 2.4, lenRand * lenRand);
  pos += dir * len * aTip;
  // 每根雨丝固有亮度差异：一部分几乎透明，模拟远近虚实
  float bright = mix(0.25, 1.0, fract(aSeed.x * 5.39 + aSeed.y * 2.71));
  // 淡出：水平远离相机、贴近水面（入水即消失）、顶部落点、贴脸
  float camDistXZ = length(pos.xz - cameraPosition.xz);
  vAlpha = uOpacity * bright
    * (1.0 - smoothstep(uArea * 0.28, uArea * 0.5, camDistXZ))
    * smoothstep(0.0, 1.5, y)
    * (1.0 - smoothstep(uTop - 5.0, uTop, y))
    * smoothstep(1.5, 4.0, length(pos - cameraPosition));
  vTip = aTip;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

  const rainFrag = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
varying float vTip;

void main() {
  // 沿雨丝渐变：头端亮、尾端淡，避免实心线段的生硬感
  gl_FragColor = vec4(uColor, vAlpha * mix(0.15, 1.0, vTip));
}
`;

  const rainMat = new THREE.ShaderMaterial({
    uniforms: rainUniforms,
    vertexShader: rainVert,
    fragmentShader: rainFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const rainParticles = new THREE.LineSegments(rainGeo, rainMat);
  rainParticles.frustumCulled = false; // 真实顶点在 shader 内，包围球无效
  scene.add(rainParticles);

  // ==================== 雨点水花（水面扩散圆环池，CPU 仅做生命周期，Y 贴合波形） ====================
  const splashCount = 140;
  const splashArea = 34;

  interface SplashRing {
    x: number;
    z: number;
    t: number;
    dur: number;
    rand: number;
  }
  const splashes: SplashRing[] = [];
  for (let i = 0; i < splashCount; i++) {
    splashes.push({ x: 0, z: 0, t: 0, dur: 0.7, rand: Math.random() });
  }
  const respawnSplash = (s: SplashRing, cam: THREE.Vector3) => {
    s.x = cam.x + (Math.random() - 0.5) * splashArea;
    s.z = cam.z + (Math.random() - 0.5) * splashArea;
    s.t = Math.random() * 0.1;
    s.dur = 0.6 + Math.random() * 0.6;
    s.rand = Math.random();
  };
  // 首次激活前未播种：初始坐标 (0,0) 会被下方的 awayXZ 检查立即重生成相机附近

  const splashBase = new THREE.PlaneGeometry(1, 1);
  splashBase.rotateX(-Math.PI / 2); // 平铺水面
  const splashGeo = new THREE.InstancedBufferGeometry();
  splashGeo.index = splashBase.index;
  splashGeo.setAttribute('position', splashBase.getAttribute('position'));
  splashGeo.setAttribute('uv', splashBase.getAttribute('uv'));
  splashGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array(splashCount * 3), 3));
  splashGeo.setAttribute('aLife', new THREE.InstancedBufferAttribute(new Float32Array(splashCount), 1));
  splashGeo.setAttribute('aRand', new THREE.InstancedBufferAttribute(new Float32Array(splashCount), 1));
  splashGeo.instanceCount = splashCount;

  const splashUniforms = {
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color(0xd8efff) },
  };

  const splashVert = /* glsl */ `
uniform float uOpacity;
attribute vec3 aOffset;
attribute float aLife;
attribute float aRand;
varying vec2 vUv;
varying float vAlpha;
varying float vRand;

void main() {
  vUv = uv;
  vRand = aRand;
  // 生命周期内扩散、整体淡入淡出；尺寸收敛小巧
  float grow = 0.06 + aLife * (0.30 + aRand * 0.20);
  vec3 pos = aOffset + vec3(position.x * grow, 0.0, position.z * grow);
  vAlpha = uOpacity * sin(aLife * 3.14159);
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

  const splashFrag = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
varying float vRand;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float ang = atan(p.y, p.x);
  // 轮廓带轻微不规则扰动，避免完美圆环的塑料感
  float wobble = 0.035 * sin(ang * 7.0 + vRand * 40.0) + 0.02 * sin(ang * 13.0 - vRand * 60.0);
  float d = length(p) + wobble;
  // 主环：细高斯轮廓，清晰但边缘柔；内圈微弱二次涟漪 + 落点小水花点
  float ring = exp(-pow((d - 0.72) * 11.0, 2.0));
  float inner = exp(-pow((d - 0.38) * 16.0, 2.0)) * 0.35;
  float center = exp(-d * d * 18.0) * 0.3;
  gl_FragColor = vec4(uColor, (ring + inner + center) * vAlpha * 0.8);
}
`;

  const splashMat = new THREE.ShaderMaterial({
    uniforms: splashUniforms,
    vertexShader: splashVert,
    fragmentShader: splashFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const splashMesh = new THREE.Mesh(splashGeo, splashMat);
  splashMesh.frustumCulled = false;
  splashMesh.visible = false;
  scene.add(splashMesh);

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

    // 3. Rain simulation —— GPU 雨丝只推进时间和淡入淡出，CPU 零逐粒子开销
    rainUniforms.uTime.value += dt;
    const windVec = wind.getWindVector();
    rainUniforms.uWind.value.set(windVec.x, windVec.z);
    rainUniforms.uOpacity.value = THREE.MathUtils.lerp(
      rainUniforms.uOpacity.value,
      targetRainOpacity,
      dt * 2.0
    );
    rainParticles.visible = rainUniforms.uOpacity.value > 0.02;

    // 水花圆环：密度随雨量缩放，Y 逐帧贴合海面波形
    const rainFactor = THREE.MathUtils.clamp(rainUniforms.uOpacity.value / 0.5, 0, 1);
    splashUniforms.uOpacity.value = rainUniforms.uOpacity.value;
    splashMesh.visible = rainFactor > 0.03;
    if (splashMesh.visible) {
      splashGeo.instanceCount = Math.max(1, Math.floor(splashCount * rainFactor));
      const iOffset = splashGeo.getAttribute('aOffset').array as Float32Array;
      const iLife = splashGeo.getAttribute('aLife').array as Float32Array;
      const iRand = splashGeo.getAttribute('aRand').array as Float32Array;
      for (let i = 0; i < splashGeo.instanceCount; i++) {
        const s = splashes[i];
        s.t += dt;
        // 生命周期结束，或相机走远导致圆环脱离雨幕窗口（含首次激活的未播种状态）时重生
        const awayXZ =
          Math.abs(s.x - cameraPos.x) > splashArea * 0.6 ||
          Math.abs(s.z - cameraPos.z) > splashArea * 0.6;
        if (s.t >= s.dur || awayXZ) {
          respawnSplash(s, cameraPos);
        }
        iOffset[i * 3] = s.x;
        iOffset[i * 3 + 1] = getWaveHeightAt(s.x, s.z) + 0.05;
        iOffset[i * 3 + 2] = s.z;
        iLife[i] = s.t / s.dur;
        iRand[i] = s.rand;
      }
      splashGeo.getAttribute('aOffset').needsUpdate = true;
      splashGeo.getAttribute('aLife').needsUpdate = true;
      splashGeo.getAttribute('aRand').needsUpdate = true;
    }

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
    scene.remove(rainParticles);
    rainGeo.dispose();
    rainMat.dispose();
    scene.remove(splashMesh);
    splashGeo.dispose();
    splashMat.dispose();
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
