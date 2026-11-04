import * as THREE from 'three';
import type { WorldView } from '../../worldView';

/** 海面漂流基准速度（木筏/漂浮物随波漂移；BuildSystem 的帆 multiplier 在此基础上缩放） */
export const OCEAN_DRIFT_BASE = 1.9;

/** 单组波的参数：高度贡献 = amp * sin(x*xFreq + z*zFreq + t*speed + phase) */
export interface WaveComponentParams {
  xFreq: number;
  zFreq: number;
  speed: number;
  amp: number;
  phase: number;
}

/**
 * 海面波形调参（调参面板运行时读写）。
 * GPU 顶点位移与 CPU 采样（getWaveHeightAt）共用同一份数据，两边逐项一致。
 */
export interface OceanTuning {
  /** 四组方向波：前两组为原短浪，第三组为碎浪，第四组为低频长涌 */
  waves: WaveComponentParams[];
  /** 整体高度缩放（最终再乘以天气波高倍率） */
  heightScale: number;
  /** 整体时间流速缩放（最终再乘以天气波速倍率） */
  timeScale: number;
  /** 基准水面偏移 */
  baseOffset: number;
  /** 调试网格线显隐（面板开关） */
  gridVisible: boolean;
}

export const DEFAULT_OCEAN_TUNING: OceanTuning = {
  waves: [
    { xFreq: 0.08, zFreq: 0.0, speed: 1.6, amp: 0.12, phase: 0 },
    { xFreq: 0.0, zFreq: 0.07, speed: 1.3, amp: 0.14, phase: Math.PI / 2 },
    { xFreq: 0.12, zFreq: 0.12, speed: 2.1, amp: 0.05, phase: 0 },
    { xFreq: 0.024, zFreq: 0.041, speed: 0.55, amp: 0.38, phase: 1.7 },
  ],
  heightScale: 2.0,
  timeScale: 1.0,
  baseOffset: -0.1,
  gridVisible: false,
};

/**
 * CPU 侧波形采样 —— GPU shader（OCEAN_WAVE_GLSL）的逐项镜像。
 * 改波形公式必须两处同步：渲染位移与浮力/采样高度才会一致。
 */
function sampleWaveHeight(
  x: number,
  z: number,
  waveTime: number,
  tuning: OceanTuning,
  heightScale: number
): number {
  let h = 0;
  for (const wv of tuning.waves) {
    h += wv.amp * Math.sin(x * wv.xFreq + z * wv.zFreq + waveTime * wv.speed + wv.phase);
  }
  return h * heightScale + tuning.baseOffset;
}

/**
 * 海面波形 GLSL（注入 MeshStandardMaterial 顶点着色器）。
 * 与 sampleWaveHeight 逐项一致：同样四组 sin、同样先乘 uHeightScale 再加 uBaseOffset。
 */
const OCEAN_WAVE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uHeightScale;
uniform float uBaseOffset;
uniform vec4 uWaveXF;
uniform vec4 uWaveZF;
uniform vec4 uWaveSpeed;
uniform vec4 uWaveAmp;
uniform vec4 uWavePhase;

float oceanWave(vec2 p) {
  float h =
    uWaveAmp.x * sin(p.x * uWaveXF.x + p.y * uWaveZF.x + uTime * uWaveSpeed.x + uWavePhase.x) +
    uWaveAmp.y * sin(p.x * uWaveXF.y + p.y * uWaveZF.y + uTime * uWaveSpeed.y + uWavePhase.y) +
    uWaveAmp.z * sin(p.x * uWaveXF.z + p.y * uWaveZF.z + uTime * uWaveSpeed.z + uWavePhase.z) +
    uWaveAmp.w * sin(p.x * uWaveXF.w + p.y * uWaveZF.w + uTime * uWaveSpeed.w + uWavePhase.w);
  return h * uHeightScale + uBaseOffset;
}

// 解析梯度：法线由导数直接算出，免去逐帧 computeVertexNormals
vec2 oceanWaveGradient(vec2 p) {
  float dx =
    uWaveAmp.x * uWaveXF.x * cos(p.x * uWaveXF.x + p.y * uWaveZF.x + uTime * uWaveSpeed.x + uWavePhase.x) +
    uWaveAmp.y * uWaveXF.y * cos(p.x * uWaveXF.y + p.y * uWaveZF.y + uTime * uWaveSpeed.y + uWavePhase.y) +
    uWaveAmp.z * uWaveXF.z * cos(p.x * uWaveXF.z + p.y * uWaveZF.z + uTime * uWaveSpeed.z + uWavePhase.z) +
    uWaveAmp.w * uWaveXF.w * cos(p.x * uWaveXF.w + p.y * uWaveZF.w + uTime * uWaveSpeed.w + uWavePhase.w);
  float dz =
    uWaveAmp.x * uWaveZF.x * cos(p.x * uWaveXF.x + p.y * uWaveZF.x + uTime * uWaveSpeed.x + uWavePhase.x) +
    uWaveAmp.y * uWaveZF.y * cos(p.x * uWaveXF.y + p.y * uWaveZF.y + uTime * uWaveSpeed.y + uWavePhase.y) +
    uWaveAmp.z * uWaveZF.z * cos(p.x * uWaveXF.z + p.y * uWaveZF.z + uTime * uWaveSpeed.z + uWavePhase.z) +
    uWaveAmp.w * uWaveZF.w * cos(p.x * uWaveXF.w + p.y * uWaveZF.w + uTime * uWaveSpeed.w + uWavePhase.w);
  return vec2(dx, dz) * uHeightScale;
}
`;

export interface OceanEnvironment {
  oceanMesh: THREE.Mesh;
  oceanGrid: THREE.GridHelper;
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  ambientLight: THREE.AmbientLight;
  starField: THREE.Points;
  /** 每帧 tick（Tickable）：昼夜光照 + 天气颜色/粗糙度过渡 + 波形 uniform 更新 */
  update: (dt: number, elapsed: number) => void;
  updateTimeOfDay: (normalizedDayProgress: number) => void;
  /** 读取调参副本（调参面板展示用，改它不影响海面） */
  getTuning: () => OceanTuning;
  /** 合并写入调参（waves 数组整体替换，长度必须与默认一致） */
  setTuning: (partial: Partial<OceanTuning>) => void;
  resetTuning: () => void;
  /** CPU 侧波形采样（与 GPU shader 同一公式；供浮力/漂浮物等玩法使用） */
  getWaveHeightAt: (x: number, z: number) => number;
}

export function createOceanEnvironment(w: WorldView): OceanEnvironment {
  const scene = w.scene;
  // 1. Dynamic Ocean Plane —— 顶点位移在 GPU shader 完成（见 onBeforeCompile）
  const oceanSize = 400;
  const oceanSegments = 220; // GPU 位移后顶点不再是 CPU 瓶颈，密度足够表现长涌
  const oceanGeo = new THREE.PlaneGeometry(oceanSize, oceanSize, oceanSegments, oceanSegments);
  oceanGeo.rotateX(-Math.PI / 2);

  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7, // Tropical azure blue
    roughness: 0.15,
    metalness: 0.2,
    transparent: true,
    opacity: 0.92,
  });

  // 波形 uniforms：每帧由 updateWaves 从 tuning 打包写入
  const waveUniforms = {
    uTime: { value: 0 },
    uHeightScale: { value: DEFAULT_OCEAN_TUNING.heightScale },
    uBaseOffset: { value: DEFAULT_OCEAN_TUNING.baseOffset },
    uWaveXF: { value: new THREE.Vector4() },
    uWaveZF: { value: new THREE.Vector4() },
    uWaveSpeed: { value: new THREE.Vector4() },
    uWaveAmp: { value: new THREE.Vector4() },
    uWavePhase: { value: new THREE.Vector4() },
  };

  oceanMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waveUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `${OCEAN_WAVE_GLSL}\n#include <common>`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
  vec2 oceanP = vec2(position.x, position.z);
  float oceanH = oceanWave(oceanP);
  vec2 oceanG = oceanWaveGradient(oceanP);
  objectNormal = normalize(vec3(-oceanG.x, 1.0, -oceanG.y));`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  transformed.y += oceanH;`
      );
  };
  // 注入版 shader 单独建缓存键，避免与未注入的同材质共享程序
  oceanMat.customProgramCacheKey = () => 'ocean-wave-displacement';

  const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  oceanMesh.receiveShadow = true;
  scene.add(oceanMesh);

  // Debug reference grid：默认隐藏，调参面板开关（默认值 gridVisible: false）
  const oceanGrid = new THREE.GridHelper(oceanSize, 160, 0x38bdf8, 0x0284c7);
  oceanGrid.position.y = 0.02;
  (oceanGrid.material as THREE.Material).transparent = true;
  (oceanGrid.material as THREE.Material).opacity = 0.25;
  oceanGrid.visible = DEFAULT_OCEAN_TUNING.gridVisible;
  scene.add(oceanGrid);

  // 2. Starfield for starry nights
  const starCount = 800;
  const starGeo = new THREE.BufferGeometry();
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    const r = 250;
    const sinPhi = Math.sin(phi);
    starPositions[i * 3] = r * sinPhi * Math.cos(theta);
    starPositions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 15; // Above horizon
    starPositions[i * 3 + 2] = r * sinPhi * Math.sin(theta);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.8,
    transparent: true,
    opacity: 0,
  });
  const starField = new THREE.Points(starGeo, starMat);
  scene.add(starField);

  // 3. Lighting Rig
  const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.4);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x0369a1, 0.55);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfffbeb, 1.1);
  sunLight.position.set(45, 70, 30);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 160;
  const d = 40;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);

  // Default daylight fog & background
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.FogExp2(0x87ceeb, 0.009);

  // 4. Wave clock & tuning
  // 波形时间独立累加（而非 elapsed * timeScale）：拖动流速滑杆不会造成时间跳变
  let tuning: OceanTuning = {
    ...DEFAULT_OCEAN_TUNING,
    waves: DEFAULT_OCEAN_TUNING.waves.map((wv) => ({ ...wv })),
  };
  let waveTime = 0;
  let effectiveHeightScale = DEFAULT_OCEAN_TUNING.heightScale;

  const updateWaves = (dt: number, weatherHeightMult = 1.0, weatherSpeedMult = 1.0) => {
    waveTime += dt * tuning.timeScale * weatherSpeedMult;
    effectiveHeightScale = tuning.heightScale * weatherHeightMult;

    const waves = tuning.waves;
    waveUniforms.uTime.value = waveTime;
    waveUniforms.uHeightScale.value = effectiveHeightScale;
    waveUniforms.uBaseOffset.value = tuning.baseOffset;
    waveUniforms.uWaveXF.value.set(waves[0].xFreq, waves[1].xFreq, waves[2].xFreq, waves[3].xFreq);
    waveUniforms.uWaveZF.value.set(waves[0].zFreq, waves[1].zFreq, waves[2].zFreq, waves[3].zFreq);
    waveUniforms.uWaveSpeed.value.set(waves[0].speed, waves[1].speed, waves[2].speed, waves[3].speed);
    waveUniforms.uWaveAmp.value.set(waves[0].amp, waves[1].amp, waves[2].amp, waves[3].amp);
    waveUniforms.uWavePhase.value.set(waves[0].phase, waves[1].phase, waves[2].phase, waves[3].phase);

    oceanGrid.visible = tuning.gridVisible;
  };

  const getTuning = (): OceanTuning => ({
    ...tuning,
    waves: tuning.waves.map((wv) => ({ ...wv })),
  });

  const setTuning = (partial: Partial<OceanTuning>) => {
    if (partial.waves) tuning.waves = partial.waves.map((wv) => ({ ...wv }));
    if (partial.heightScale !== undefined) tuning.heightScale = partial.heightScale;
    if (partial.timeScale !== undefined) tuning.timeScale = partial.timeScale;
    if (partial.baseOffset !== undefined) tuning.baseOffset = partial.baseOffset;
    if (partial.gridVisible !== undefined) tuning.gridVisible = partial.gridVisible;
  };

  const resetTuning = () => {
    tuning = {
      ...DEFAULT_OCEAN_TUNING,
      waves: DEFAULT_OCEAN_TUNING.waves.map((wv) => ({ ...wv })),
    };
  };

  // 5. Update Time of Day (0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight)
  const daySkyColor = new THREE.Color(0x87ceeb);
  const sunsetSkyColor = new THREE.Color(0xfb923c);
  const nightSkyColor = new THREE.Color(0x090d16);

  const updateTimeOfDay = (t: number) => {
    // Angle of sun in sky
    const sunAngle = t * Math.PI * 2 - Math.PI / 2;
    const sunDist = 90;
    const sunY = Math.sin(sunAngle) * sunDist;
    const sunX = Math.cos(sunAngle) * sunDist;

    sunLight.position.set(sunX, Math.max(-20, sunY), 30);

    const isDay = sunY > 0;
    let targetSky = new THREE.Color();
    let targetSunColor = new THREE.Color();
    let sunIntensity = 1.0;
    let starOpacity = 0;

    if (sunY > 20) {
      // High noon
      targetSky.copy(daySkyColor);
      targetSunColor.setHex(0xfffbeb);
      sunIntensity = 1.1;
      starOpacity = 0;
    } else if (sunY > -5) {
      // Golden hour / sunset / sunrise
      const blend = (sunY + 5) / 25;
      targetSky.lerpColors(sunsetSkyColor, daySkyColor, blend);
      targetSunColor.setHex(0xf97316);
      sunIntensity = 0.8;
      starOpacity = 0.1;
    } else {
      // Night time
      targetSky.copy(nightSkyColor);
      targetSunColor.setHex(0x93c5fd); // Moon light
      sunIntensity = 0.25;
      starOpacity = 0.9;
    }

    if (scene.background instanceof THREE.Color) {
      scene.background.lerp(targetSky, 0.05);
      if (scene.fog) {
        scene.fog.color.lerp(targetSky, 0.05);
      }
    }

    sunLight.color.lerp(targetSunColor, 0.05);
    sunLight.intensity = THREE.MathUtils.lerp(sunLight.intensity, sunIntensity, 0.05);
    starMat.opacity = THREE.MathUtils.lerp(starMat.opacity, starOpacity, 0.05);
    ambientLight.intensity = isDay ? 0.45 : 0.18;
  };

  return {
    oceanMesh,
    oceanGrid,
    sunLight,
    hemiLight,
    ambientLight,
    starField,
    update: (dt, _elapsed) => {
      updateTimeOfDay(w.time().dayTime);
      const weather = w.weather();
      if (weather.getOceanColor()) {
        oceanMat.color.lerp(weather.getOceanColor(), 0.05);
      }
      oceanMat.roughness = THREE.MathUtils.lerp(oceanMat.roughness, weather.getOceanRoughness(), 0.05);
      updateWaves(dt, weather.getWaveHeightMultiplier(), weather.getWaveSpeedMultiplier());
    },
    updateTimeOfDay,
    getTuning,
    setTuning,
    resetTuning,
    getWaveHeightAt: (x, z) => sampleWaveHeight(x, z, waveTime, tuning, effectiveHeightScale),
  };
}
