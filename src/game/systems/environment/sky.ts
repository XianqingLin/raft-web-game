import * as THREE from 'three';
import type { WorldView } from '../../worldView';

/**
 * 天空/光照层：灯光组、星空、昼夜循环与雾/背景的天空色。
 * 天气对颜色/强度的再修饰在 weather.ts——两者都是每帧小步 lerp，
 * tick 顺序 sky → ocean → weather 与拆分前一致，叠加效果不变。
 */
export interface SkyEnvironment {
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  ambientLight: THREE.AmbientLight;
  starField: THREE.Points;
  /** 每帧 tick（Tickable）：按 time.dayTime 驱动昼夜过渡 */
  update: (dt: number) => void;
}

export function createSkyEnvironment(w: WorldView): SkyEnvironment {
  const scene = w.scene;

  // 1. Lighting Rig
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

  // 3. Default daylight fog & background
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.FogExp2(0x87ceeb, 0.009);

  // 4. Day/night cycle (0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight)
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
    sunLight,
    hemiLight,
    ambientLight,
    starField,
    update: () => {
      updateTimeOfDay(w.time().dayTime);
    },
  };
}
