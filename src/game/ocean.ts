import * as THREE from 'three';

/** 海面漂流基准速度（木筏/漂浮物随波漂移；BuildSystem 的帆 multiplier 在此基础上缩放） */
export const OCEAN_DRIFT_BASE = 1.9;

export interface OceanEnvironment {
  oceanMesh: THREE.Mesh;
  oceanGrid: THREE.GridHelper;
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  ambientLight: THREE.AmbientLight;
  starField: THREE.Points;
  updateTimeOfDay: (normalizedDayProgress: number) => void;
  updateWaves: (
    elapsed: number,
    driftSpeed: number,
    waveHeightMult?: number,
    waveSpeedMult?: number,
    oceanColor?: THREE.Color,
    oceanRoughness?: number
  ) => void;
  getWaveHeightAt: (
    x: number,
    z: number,
    elapsed: number,
    waveHeightMult?: number,
    waveSpeedMult?: number
  ) => number;
}

export function createOceanEnvironment(scene: THREE.Scene): OceanEnvironment {
  // 1. Dynamic Ocean Plane with Vertex Wave Shader
  const oceanSize = 400;
  const oceanSegments = 100;
  const oceanGeo = new THREE.PlaneGeometry(oceanSize, oceanSize, oceanSegments, oceanSegments);
  oceanGeo.rotateX(-Math.PI / 2);

  // Store original vertex heights for procedural wave animation
  const posAttr = oceanGeo.attributes.position;
  const originalY = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    originalY[i] = posAttr.getY(i);
  }

  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7, // Tropical azure blue
    roughness: 0.15,
    metalness: 0.2,
    transparent: true,
    opacity: 0.92,
  });

  const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  oceanMesh.receiveShadow = true;
  scene.add(oceanMesh);

  // Moving visual drift grid for tactile spatial feedback
  const oceanGrid = new THREE.GridHelper(oceanSize, 160, 0x38bdf8, 0x0284c7);
  oceanGrid.position.y = 0.02;
  (oceanGrid.material as THREE.Material).transparent = true;
  (oceanGrid.material as THREE.Material).opacity = 0.25;
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

  // 4. Update Waves Loop
  const updateWaves = (
    elapsed: number,
    _driftSpeed: number,
    waveHeightMult = 1.0,
    waveSpeedMult = 1.0,
    oceanColor?: THREE.Color,
    oceanRoughness?: number
  ) => {
    // Keep grid stationary so raft is completely anchored and stable
    oceanGrid.position.z = 0;

    // Apply material adaptations
    if (oceanColor) {
      oceanMat.color.lerp(oceanColor, 0.05);
    }
    if (oceanRoughness !== undefined) {
      oceanMat.roughness = THREE.MathUtils.lerp(oceanMat.roughness, oceanRoughness, 0.05);
    }

    // Procedural swell on ocean vertices
    const speed = elapsed * waveSpeedMult;
    const pos = oceanGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      const wave =
        Math.sin(vx * 0.08 + speed * 1.6) * (0.12 * waveHeightMult) +
        Math.cos(vz * 0.07 + speed * 1.3) * (0.14 * waveHeightMult) +
        Math.sin((vx + vz) * 0.12 + speed * 2.1) * (0.05 * waveHeightMult);
      pos.setY(i, wave - 0.1);
    }
    pos.needsUpdate = true;
    oceanGeo.computeVertexNormals();
  };

  const getWaveHeightAt = (
    vx: number,
    vz: number,
    elapsed: number,
    waveHeightMult = 1.0,
    waveSpeedMult = 1.0
  ) => {
    const speed = elapsed * waveSpeedMult;
    return (
      Math.sin(vx * 0.08 + speed * 1.6) * (0.12 * waveHeightMult) +
      Math.cos(vz * 0.07 + speed * 1.3) * (0.14 * waveHeightMult) +
      Math.sin((vx + vz) * 0.12 + speed * 2.1) * (0.05 * waveHeightMult) -
      0.1
    );
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
    updateTimeOfDay,
    updateWaves,
    getWaveHeightAt,
  };
}
