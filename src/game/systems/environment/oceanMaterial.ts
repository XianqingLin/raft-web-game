import * as THREE from 'three';
import { DEFAULT_OCEAN_TUNING, OCEAN_WAVE_GLSL } from './waveform';

/**
 * 海面材质：把波形顶点位移与水色着色注入 MeshStandardMaterial。
 * 本文件持有全部 GLSL —— 波形公式（OCEAN_WAVE_GLSL）在 waveform.ts，
 * 片元水色在下面；ocean.ts 只消费返回的 uniforms，不接触 shader 字符串。
 */

/** 每帧由 ocean.ts 的 tick 打包写入（波形参数、水色派生、跑步机滚动量） */
export interface OceanUniforms {
  uTime: { value: number };
  /** 跑步机滚动偏移（WindSystem 累计航程）：GPU/CPU 同加，波形才会流过木筏 */
  uScrollOffset: { value: THREE.Vector2 };
  uHeightScale: { value: number };
  uBaseOffset: { value: number };
  uWaveXF: { value: THREE.Vector4 };
  uWaveZF: { value: THREE.Vector4 };
  uWaveSpeed: { value: THREE.Vector4 };
  uWaveAmp: { value: THREE.Vector4 };
  uWavePhase: { value: THREE.Vector4 };
  // 水色/细节（片元）：Deep/Shallow 每帧从天气驱动的材质色派生，Sky 跟随天空色
  uColorDeep: { value: THREE.Color };
  uColorShallow: { value: THREE.Color };
  uSkyColor: { value: THREE.Color };
  uDetailStrength: { value: number };
}

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

export function createOceanMaterial(): {
  material: THREE.MeshStandardMaterial;
  uniforms: OceanUniforms;
} {
  const material = new THREE.MeshStandardMaterial({
    color: 0x0284c7, // Tropical azure blue
    roughness: 0.15,
    metalness: 0.2,
    transparent: true,
    opacity: 0.92,
  });

  const uniforms: OceanUniforms = {
    uTime: { value: 0 },
    uScrollOffset: { value: new THREE.Vector2(0, 0) },
    uHeightScale: { value: DEFAULT_OCEAN_TUNING.heightScale },
    uBaseOffset: { value: DEFAULT_OCEAN_TUNING.baseOffset },
    uWaveXF: { value: new THREE.Vector4() },
    uWaveZF: { value: new THREE.Vector4() },
    uWaveSpeed: { value: new THREE.Vector4() },
    uWaveAmp: { value: new THREE.Vector4() },
    uWavePhase: { value: new THREE.Vector4() },
    uColorDeep: { value: new THREE.Color(0x02516b) },
    uColorShallow: { value: new THREE.Color(0x0284c7) },
    uSkyColor: { value: new THREE.Color(0x87ceeb) },
    uDetailStrength: { value: DEFAULT_OCEAN_TUNING.detailStrength },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
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
  material.customProgramCacheKey = () => 'ocean-wave-displacement-v3';

  return { material, uniforms };
}
