import * as THREE from 'three';
import type { WorldView } from '../../worldView';
// 波形契约（类型/默认调参/GPU 公式/CPU 采样）的唯一出处，见 waveform.ts
import { DEFAULT_OCEAN_TUNING, sampleWaveHeight, type OceanTuning } from './waveform';
// 海面材质与全部 shader 注入（GLSL 只住在 waveform.ts / oceanMaterial.ts）
import { createOceanMaterial } from './oceanMaterial';

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
  // Dynamic Ocean Plane —— 顶点位移在 GPU shader 完成（注入见 oceanMaterial.ts）
  const oceanSize = 400;
  const oceanSegments = 220; // GPU 位移后顶点不再是 CPU 瓶颈，密度足够表现长涌
  const oceanGeo = new THREE.PlaneGeometry(oceanSize, oceanSize, oceanSegments, oceanSegments);
  oceanGeo.rotateX(-Math.PI / 2);

  const { material: oceanMat, uniforms: waveUniforms } = createOceanMaterial();

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

  // Wave clock & tuning
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
