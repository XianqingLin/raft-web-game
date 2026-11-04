import * as THREE from 'three';
import type { WorldView } from '../../worldView';

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
  /** 细节法线强度（波光粼粼程度；0 = 关闭） */
  detailStrength: number;
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
  detailStrength: 1.0,
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
uniform vec2 uScrollOffset;
uniform float uHeightScale;
uniform float uBaseOffset;
uniform vec4 uWaveXF;
uniform vec4 uWaveZF;
uniform vec4 uWaveSpeed;
uniform vec4 uWaveAmp;
uniform vec4 uWavePhase;

// 传给片元阶段：波面高度用于波峰提亮，世界坐标用于细节法线与 Fresnel
varying vec2 vOceanXZ;
varying vec3 vOceanWorld;
varying float vOceanH;

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

/**
 * 片元阶段注入：程序化水色（Fresnel 双色 + 波峰天色提亮）、微法线扰动。
 * viewMatrix/cameraPosition 由 three 的片元前缀自带；网格无变换，法线世界空间可逆变换。
 */
const OCEAN_FRAGMENT_GLSL = /* glsl */ `
uniform float uTime;
uniform float uDetailStrength;
uniform vec3 uColorDeep;
uniform vec3 uColorShallow;
uniform vec3 uSkyColor;
varying vec2 vOceanXZ;
varying vec3 vOceanWorld;
varying float vOceanH;

float oceanHash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float oceanNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // quintic 插值：梯度连续，消除 smoothstep 版的块状粗糙感
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = oceanHash(i);
  float b = oceanHash(i + vec2(1.0, 0.0));
  float c = oceanHash(i + vec2(0.0, 1.0));
  float d = oceanHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float oceanFbm(vec2 p) {
  return oceanNoise(p) * 0.55
    + oceanNoise(p * 2.02 + 11.3) * 0.28
    + oceanNoise(p * 4.31 + 23.7) * 0.17;
}

// 高频细节法线的世界空间梯度：三层不同尺度/方向/速度的滚动噪声，
// 近处特征 ~0.3m（碎闪），避免之前单尺度 ~1m 的粗糙斑块
vec2 oceanDetailGrad(vec2 xz, float t) {
  float e = 0.08;
  vec2 p1 = xz * 2.2 + vec2(t * 0.26, t * 0.19);
  vec2 g1 = vec2(
    oceanFbm(p1 + vec2(e, 0.0)) - oceanFbm(p1),
    oceanFbm(p1 + vec2(0.0, e)) - oceanFbm(p1)
  ) / e;
  vec2 p2 = xz * 5.5 + vec2(7.1 - t * 0.37, 2.9 + t * 0.31);
  vec2 g2 = vec2(
    oceanFbm(p2 + vec2(e, 0.0)) - oceanFbm(p2),
    oceanFbm(p2 + vec2(0.0, e)) - oceanFbm(p2)
  ) / e;
  vec2 p3 = xz * 11.0 + vec2(1.7 + t * 0.52, 8.4 - t * 0.44);
  vec2 g3 = vec2(
    oceanFbm(p3 + vec2(e, 0.0)) - oceanFbm(p3),
    oceanFbm(p3 + vec2(0.0, e)) - oceanFbm(p3)
  ) / e;
  return g1 * 0.5 + g2 * 0.33 + g3 * 0.17;
}
`;

export interface OceanEnvironment {
  oceanMesh: THREE.Mesh;
  oceanGrid: THREE.GridHelper;
  /** 每帧 tick（Tickable）：天气颜色/粗糙度过渡 + 波形 uniform 更新（昼夜光照在 sky.ts） */
  update: (dt: number, elapsed: number) => void;
  /** 【仅调试】读取调参副本（调参面板展示用，改它不影响海面） */
  getTuning: () => OceanTuning;
  /** 【仅调试】合并写入调参（waves 数组整体替换，长度必须与默认一致） */
  setTuning: (partial: Partial<OceanTuning>) => void;
  /** 【仅调试】恢复默认调参 */
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
    // 跑步机滚动偏移（WindSystem 累计航程）：GPU/CPU 同加，波形才会流过木筏
    uScrollOffset: { value: new THREE.Vector2(0, 0) },
    uHeightScale: { value: DEFAULT_OCEAN_TUNING.heightScale },
    uBaseOffset: { value: DEFAULT_OCEAN_TUNING.baseOffset },
    uWaveXF: { value: new THREE.Vector4() },
    uWaveZF: { value: new THREE.Vector4() },
    uWaveSpeed: { value: new THREE.Vector4() },
    uWaveAmp: { value: new THREE.Vector4() },
    uWavePhase: { value: new THREE.Vector4() },
    // 水色/细节（片元）：Deep/Shallow 每帧从天气驱动的材质色派生，Sky 跟随天空色
    uColorDeep: { value: new THREE.Color(0x02516b) },
    uColorShallow: { value: new THREE.Color(0x0284c7) },
    uSkyColor: { value: new THREE.Color(0x87ceeb) },
    uDetailStrength: { value: DEFAULT_OCEAN_TUNING.detailStrength },
  };

  oceanMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waveUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `${OCEAN_WAVE_GLSL}\n#include <common>`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
  vec2 oceanP = vec2(position.x, position.z) + uScrollOffset;
  float oceanH = oceanWave(oceanP);
  vec2 oceanG = oceanWaveGradient(oceanP);
  objectNormal = normalize(vec3(-oceanG.x, 1.0, -oceanG.y));`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  transformed.y += oceanH;
  vOceanXZ = oceanP;
  vOceanWorld = transformed;
  vOceanH = oceanH;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${OCEAN_FRAGMENT_GLSL}\n#include <common>`)
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
  // 网格无变换（modelMatrix = I），法线可在世界空间重建/扰动后再转回视空间
  mat3 oceanV = mat3(viewMatrix);
  vec3 oceanWN = transpose(oceanV) * normal;
  vec3 oceanVdir = normalize(cameraPosition - vOceanWorld);
  // 距离衰减：远处高频噪声会走样成闪烁噪点，随距离淡出
  float oceanFade = clamp(1.0 - (length(cameraPosition - vOceanWorld) - 18.0) / 55.0, 0.2, 1.0);
  // 微法线扰动：三层滚动噪声梯度 -> 波光粼粼（PBR 镜面高光随之碎闪）
  vec2 oceanGd = oceanDetailGrad(vOceanXZ, uTime);
  oceanWN = normalize(oceanWN + vec3(-oceanGd.x, 0.0, -oceanGd.y) * 0.11 * uDetailStrength * oceanFade);
  normal = oceanV * oceanWN;
  // Fresnel 双色：正视看深水色，掠射角混天色（假反射）；波峰向天色提亮
  float oceanFres = pow(1.0 - clamp(dot(oceanWN, oceanVdir), 0.0, 1.0), 3.0);
  vec3 oceanWater = mix(uColorDeep, uColorShallow, oceanFres);
  oceanWater += uSkyColor * clamp(vOceanH, 0.0, 1.0) * 0.1;
  diffuseColor.rgb = mix(diffuseColor.rgb, oceanWater, 0.92);`
      );
  };
  // 注入版 shader 单独建缓存键，避免与未注入的同材质共享程序
  oceanMat.customProgramCacheKey = () => 'ocean-wave-displacement-v3';

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

  // 2. Wave clock & tuning
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

    // 水色派生：浅色跟随天气海色，深色为其暗化；天空色供 Fresnel 掠射混色
    waveUniforms.uColorShallow.value.copy(oceanMat.color);
    waveUniforms.uColorDeep.value.copy(oceanMat.color).multiplyScalar(0.3);
    if (scene.background instanceof THREE.Color) {
      waveUniforms.uSkyColor.value.copy(scene.background);
    }
    waveUniforms.uDetailStrength.value = tuning.detailStrength;

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
    if (partial.detailStrength !== undefined) tuning.detailStrength = partial.detailStrength;
    if (partial.gridVisible !== undefined) tuning.gridVisible = partial.gridVisible;
  };

  const resetTuning = () => {
    tuning = {
      ...DEFAULT_OCEAN_TUNING,
      waves: DEFAULT_OCEAN_TUNING.waves.map((wv) => ({ ...wv })),
    };
  };

  return {
    oceanMesh,
    oceanGrid,
    update: (dt, _elapsed) => {
      const weather = w.weather();
      if (weather.getOceanColor()) {
        oceanMat.color.lerp(weather.getOceanColor(), 0.05);
      }
      oceanMat.roughness = THREE.MathUtils.lerp(oceanMat.roughness, weather.getOceanRoughness(), 0.05);
      updateWaves(dt, weather.getWaveHeightMultiplier(), weather.getWaveSpeedMultiplier());
      // 跑步机滚动：GPU 与 CPU 采样共用同一份偏移（WindSystem 累计航程）
      const scroll = w.wind().getScrollOffset();
      waveUniforms.uScrollOffset.value.set(scroll.x, scroll.z);
    },
    getTuning,
    setTuning,
    resetTuning,
    getWaveHeightAt: (x, z) => {
      const off = waveUniforms.uScrollOffset.value;
      return sampleWaveHeight(x + off.x, z + off.y, waveTime, tuning, effectiveHeightScale);
    },
  };
}
