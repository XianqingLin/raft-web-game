import * as THREE from 'three';

/**
 * 雨的视觉层：GPU 雨丝（LineSegments）+ 水花圆环池（InstancedMesh）。
 * 纯渲染模块 —— 只吃每帧参数（相机位置、风向量、目标不透明度），
 * 下不下雨、雨量多大由 WeatherSystem 决策。
 */

/** 每帧喂给雨视觉的参数（weather.update 逐帧传入） */
export interface RainFrameParams {
  /** 雨幕/水花窗口跟随的相机位置 */
  cameraPos: THREE.Vector3;
  /** 风向量（WindSystem）：雨丝的倾斜方向与风一致 */
  windVec: { x: number; z: number };
  /** 目标不透明度 0..1（天气系统按雨量给出，内部平滑过渡） */
  opacityTarget: number;
}

export interface RainVisual {
  /** 当前不透明度（水花密度随雨量缩放时读数用） */
  getOpacity: () => number;
  update: (dt: number, params: RainFrameParams) => void;
  dispose: () => void;
}

export function createRainVisual(
  scene: THREE.Scene,
  /** 水花圆环 Y 贴合海面波形（OceanEnvironment.getWaveHeightAt） */
  getWaveHeightAt: (x: number, z: number) => number
): RainVisual {
  // ==================== GPU 雨丝（细长半透明 streak，下落/风漂/相机环绕全在 shader 内） ====================
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

  const update = (dt: number, params: RainFrameParams) => {
    // GPU 雨丝只推进时间和淡入淡出，CPU 零逐粒子开销
    rainUniforms.uTime.value += dt;
    rainUniforms.uWind.value.set(params.windVec.x, params.windVec.z);
    rainUniforms.uOpacity.value = THREE.MathUtils.lerp(
      rainUniforms.uOpacity.value,
      params.opacityTarget,
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
          Math.abs(s.x - params.cameraPos.x) > splashArea * 0.6 ||
          Math.abs(s.z - params.cameraPos.z) > splashArea * 0.6;
        if (s.t >= s.dur || awayXZ) {
          respawnSplash(s, params.cameraPos);
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
    getOpacity: () => rainUniforms.uOpacity.value,
    update,
    dispose,
  };
}
