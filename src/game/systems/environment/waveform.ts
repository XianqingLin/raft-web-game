/**
 * 海面波形 —— 波形的唯一出处。
 *
 * GPU 公式（OCEAN_WAVE_GLSL，注入顶点着色器）与 CPU 采样（sampleWaveHeight，
 * 供浮力/漂浮物等玩法使用）是同一公式的两份实现，必须逐项一致：
 * 同样四组 sin、同样先乘 heightScale 再加 baseOffset。改波形只改本文件，
 * 两处同步改，渲染位移与物理采样才不会脱节。
 */

/** 单组波的参数：高度贡献 = amp * sin(x*xFreq + z*zFreq + t*speed + phase) */
export interface WaveComponentParams {
  xFreq: number;
  zFreq: number;
  speed: number;
  amp: number;
  phase: number;
}

/** 海面波形调参（调参面板运行时读写）。 */
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

/** CPU 侧波形采样 —— OCEAN_WAVE_GLSL 的逐项镜像（同步契约见文件头注释）。 */
export function sampleWaveHeight(
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

/** 海面波形 GLSL（注入 MeshStandardMaterial 顶点着色器），sampleWaveHeight 的逐项镜像。 */
export const OCEAN_WAVE_GLSL = /* glsl */ `
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
