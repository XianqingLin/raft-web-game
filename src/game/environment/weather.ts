import type { WorldView } from '../worldView';
import type { OceanEnvironment } from './ocean';
import * as THREE from 'three';
import { WeatherType } from '../../types/game';
import { soundManager } from '../../audio/soundManager';

export interface WeatherSystem {
  currentWeather: WeatherType;
  update: (dt: number, cameraPos: THREE.Vector3, dayProgress: number) => void;
  setWeather: (type: WeatherType) => void;
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
  onWeatherChange?: (weather: WeatherType) => void
): WeatherSystem {
  let currentWeather: WeatherType = 'CLEAR';
  let targetWeather: WeatherType = 'CLEAR';
  let weatherTimer = 85 + Math.random() * 45; // Changes every 85-130 seconds
  let transitionProgress = 1.0; // 0..1 blend

  // Rain Particles System
  const rainCount = 3200;
  const rainGeo = new THREE.BufferGeometry();
  const rainPositions = new Float32Array(rainCount * 3);
  const rainVelocities = new Float32Array(rainCount * 3);

  const rainSpreadXZ = 50;
  const rainHeight = 35;

  for (let i = 0; i < rainCount; i++) {
    rainPositions[i * 3] = (Math.random() - 0.5) * rainSpreadXZ;
    rainPositions[i * 3 + 1] = Math.random() * rainHeight;
    rainPositions[i * 3 + 2] = (Math.random() - 0.5) * rainSpreadXZ;

    // High downward velocity with slight tropical wind tilt
    rainVelocities[i * 3] = -1.2 + (Math.random() - 0.5) * 0.8;
    rainVelocities[i * 3 + 1] = -28 - Math.random() * 12;
    rainVelocities[i * 3 + 2] = 0.8 + (Math.random() - 0.5) * 0.6;
  }

  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));

  const rainMat = new THREE.PointsMaterial({
    color: 0xcfe8ff,
    size: 0.35,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const rainParticles = new THREE.Points(rainGeo, rainMat);
  scene.add(rainParticles);

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

  const setWeather = (type: WeatherType) => {
    if (type === currentWeather) return;
    targetWeather = type;
    currentWeather = type;
    transitionProgress = 0.0;
    onWeatherChange?.(type);
  };

  const update = (dt: number, cameraPos: THREE.Vector3, _dayProgress: number) => {
    // 1. Weather timer update
    weatherTimer -= dt;
    if (weatherTimer <= 0) {
      // Pick a new randomized weather
      const choices: WeatherType[] = ['CLEAR', 'LIGHT_FOG', 'HEAVY_RAIN'];
      // Weigh clear 50%, fog 25%, rain 25%
      const r = Math.random();
      let next: WeatherType = 'CLEAR';
      if (r < 0.45) next = 'CLEAR';
      else if (r < 0.72) next = 'LIGHT_FOG';
      else next = 'HEAVY_RAIN';

      if (next === currentWeather) {
        // cycle to another to ensure interesting variety
        const others = choices.filter((w) => w !== currentWeather);
        next = others[Math.floor(Math.random() * others.length)];
      }

      setWeather(next);
      weatherTimer = 75 + Math.random() * 60; // 75 - 135 seconds per weather pattern
    }

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
      targetRoughness = 0.42;
      targetWaveHeight = 2.4;
      targetWaveSpeed = 1.65;
      targetSunDim = 0.28;
      targetRainOpacity = 0.75;
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

    // 3. Rain Particles Simulation
    rainMat.opacity = THREE.MathUtils.lerp(rainMat.opacity, targetRainOpacity, dt * 2.0);
    rainParticles.visible = rainMat.opacity > 0.02;

    if (rainParticles.visible) {
      const positions = rainGeo.attributes.position.array as Float32Array;
      const baseY = cameraPos.y;
      const baseFloor = 0.0; // Ocean surface

      for (let i = 0; i < rainCount; i++) {
        const idx = i * 3;
        positions[idx] += rainVelocities[idx] * dt;
        positions[idx + 1] += rainVelocities[idx + 1] * dt;
        positions[idx + 2] += rainVelocities[idx + 2] * dt;

        // Wrap around camera bounds
        if (positions[idx + 1] < Math.min(baseFloor, baseY - 6)) {
          positions[idx + 1] = baseY + 18 + Math.random() * 6;
          positions[idx] = cameraPos.x + (Math.random() - 0.5) * rainSpreadXZ;
          positions[idx + 2] = cameraPos.z + (Math.random() - 0.5) * rainSpreadXZ;
        }

        // Horizontal bounding box wrap
        if (positions[idx] < cameraPos.x - rainSpreadXZ / 2) positions[idx] += rainSpreadXZ;
        if (positions[idx] > cameraPos.x + rainSpreadXZ / 2) positions[idx] -= rainSpreadXZ;
        if (positions[idx + 2] < cameraPos.z - rainSpreadXZ / 2) positions[idx + 2] += rainSpreadXZ;
        if (positions[idx + 2] > cameraPos.z + rainSpreadXZ / 2) positions[idx + 2] -= rainSpreadXZ;
      }
      rainGeo.attributes.position.needsUpdate = true;
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
  };

  return {
    get currentWeather() {
      return currentWeather;
    },
    update,
    setWeather,
    getWaveHeightMultiplier: () => waveHeightMult,
    getWaveSpeedMultiplier: () => waveSpeedMult,
    getOceanColor: () => currentOceanColor,
    getOceanRoughness: () => currentOceanRoughness,
    dispose,
  };
}

// ==================== Factory（依赖接线集中于此，GameWorld 一行调用） ====================

export function createWeather(w: WorldView, ocean: OceanEnvironment): WeatherSystem {
  return createWeatherSystem(
    w.scene,
    ocean.sunLight,
    ocean.ambientLight,
    ocean.hemiLight,
    (newWeather) => {
      w.ui.onWeatherChange?.(newWeather);
      if (newWeather === 'LIGHT_FOG') {
        w.toast('🌫️ A thick sea mist rolls across the ocean waters...', '#94a3b8');
      } else if (newWeather === 'HEAVY_RAIN') {
        w.toast('🌧️ A tropical storm strikes! Rough waves and rain!', '#38bdf8');
      } else {
        w.toast('☀️ The skies clear over the open sea.', '#fde047');
      }
    }
  );
}
