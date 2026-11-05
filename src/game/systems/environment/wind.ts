/**
 * WindSystem —— 风（天气与海流的唯一自主演化源头）。
 *
 * 跑步机模型：木筏永远固定在世界原点，"航行"由本系统给出的滚动量表达：
 *   - getRaftVelocity：木筏航速是惯性状态（动量模型）——帆/桨推力与相对
 *     海流的二次水阻力共同演化，松桨长滑行、顶流净速、满帆极速都由
 *     推力-阻力平衡 v* = sqrt(推力/阻力系数) 涌现，不逐项硬算相加。
 *     世界（海面波形、漂浮物）绕木筏以它的反向滚动。
 *   - getScrollOffset：累计滚动量（航程），海面 GPU/CPU 波形采样同减此偏移，
 *     波浪才会从木筏底下持续流过。
 *
 * 风的因果链（现实气象的简化映射）：
 *   - 风 = 唯一自主演化的量：工况制（静风/和风/劲风/风暴），各工况有驻留
 *     时间与随机跳转；风暴工况叠加阵风抖动（低频噪声，海流的 50s 低通会
 *     自动滤平——浪上看得出忽快忽慢，海流不受影响）。
 *   - 海流 = 风的低通滤波（现实中海流就是风的长期平均）。
 *   - 天气 = f(风, 湿度)，由 WeatherSystem 派生；湿度是本系统持有的隐含
 *     慢变量（缓慢随机漂移）——同样的强风，湿度低是大风晴天，湿度高触发
 *     暴风雨，"读风"成为有用但非确定性的技能。
 *
 * 调参只需调风；调试面板关闭"风自调节"后可手动设定风向/风速（雷达图+滑杆）。
 */

import * as THREE from 'three';
import type { WorldView } from '../../worldView';
import type { WeatherType } from '../../../types/game';

/** 风工况：静风（雾）/ 和风（常态）/ 劲风 / 风暴（暴雨） */
export type WindRegime = 'CALM' | 'BREEZE' | 'STRONG' | 'GALE';

const REGIME_LABEL: Record<WindRegime, string> = {
  CALM: '静风',
  BREEZE: '和风',
  STRONG: '劲风',
  GALE: '风暴',
};

/** 各工况的基础风速（世界单位/秒） */
const REGIME_SPEED: Record<WindRegime, number> = {
  CALM: 0.8,
  BREEZE: 2.0,
  STRONG: 3.4,
  GALE: 5.2,
};

/** 各工况的阵风幅度（风暴最大，叠加低频噪声抖动） */
const REGIME_GUST: Record<WindRegime, number> = {
  CALM: 0.08,
  BREEZE: 0.15,
  STRONG: 0.5,
  GALE: 1.3,
};

/** 工况跳转表：[目标工况, 概率]，风暴进出都走这里，天气节奏由驻留时间决定 */
const REGIME_TRANSITIONS: Record<WindRegime, Array<[WindRegime, number]>> = {
  CALM: [['BREEZE', 0.7], ['STRONG', 0.3]],
  BREEZE: [['CALM', 0.35], ['STRONG', 0.5], ['GALE', 0.15]],
  STRONG: [['BREEZE', 0.4], ['CALM', 0.2], ['GALE', 0.4]],
  GALE: [['STRONG', 0.6], ['BREEZE', 0.4]],
};

/** 工况驻留时间（秒），与旧天气节奏（75~135s）同量级 */
const nextDwell = () => 70 + Math.random() * 60;

function pickRegime(from: WindRegime): WindRegime {
  const table = REGIME_TRANSITIONS[from];
  let r = Math.random();
  for (const [to, p] of table) {
    r -= p;
    if (r <= 0) return to;
  }
  return table[table.length - 1][0];
}

/** 风向蜿蜒角速度：两个慢正弦叠加，方向永远在缓变但无突变 */
function windWander(elapsed: number): number {
  return 0.018 * Math.sin(elapsed * 0.021 + 1.7) + 0.012 * Math.sin(elapsed * 0.0093 + 0.4);
}

/** 阵风噪声：三个不同频率正弦叠加，近似 [-1, 1] 的低频抖动 */
function gustNoise(elapsed: number): number {
  return (Math.sin(elapsed * 0.9) + 0.6 * Math.sin(elapsed * 2.3 + 1.7) + 0.8 * Math.sin(elapsed * 0.37 + 4.1)) / 2.4;
}

/** 海流 = 风向量 × 该系数 */
const CURRENT_RATIO = 0.35;
/** 海流追踪风的低通速率（1/s）：时间常数约 50s，天然滤平阵风 */
const CURRENT_LERP_RATE = 0.02;
/** 风速向工况目标过渡的速率（1/s） */
const WIND_LERP_RATE = 0.3;
/** 帆推力：每张张开帆把风速转化为推力的系数（方向=风吹向的方向） */
const SAIL_THRUST_PER_SAIL = 0.6;
/** 有效帆数上限：再多的帆不提速（堆帆的收益递减） */
const SAIL_COUNT_CAP = 2;
/** 筏速硬上限（m/s），防止暴风满帆时世界滚动快到眩晕 */
const MAX_RAFT_SPEED = 7;
/** 划桨推进目标速度（m/s）：可克服任何海流，介于海流与满帆顺风之间 */
const PADDLE_THRUST = 2.4;
/** 二次水阻力系数：平衡航速 v* = sqrt(推力/k)。取 1/PADDLE_THRUST 使单桨
 *  平衡航速（相对水）恰为 PADDLE_THRUST，与旧模型手感一致；松桨后的滑行、
 *  顶流划桨的净速、满帆极速全部由此涌现 */
const WATER_DRAG = 1 / PADDLE_THRUST;
/** 开帆时划桨的力度折减：桨退居"微调航向"，速度仍由风主导 */
const PADDLE_TRIM_FACTOR = 0.45;
/** 起桨推力过渡速率（1/s）：起桨渐快 */
const PADDLE_LERP_IN = 3.0;
/** 收桨推力归零速率（1/s）：只平滑收桨瞬间，松桨后的滑行由动量+阻力负责 */
const PADDLE_LERP_OUT = 6.0;
/** 风暴浪涌的阻力增益：浪高倍率超出 1 的部分按比例加在水阻力上，顶浪更吃力 */
const STORM_DRAG_GAIN = 0.35;

/** 风状态（WeatherSystem 派生天气消费） */
export interface WindState {
  /** 有效风速（含阵风，m/s） */
  speed: number;
  /** 隐含湿度 0..1（缓慢漂移，玩家不可见的天气闸门） */
  humidity: number;
  regime: WindRegime;
  regimeLabel: string;
}

/** 调试面板读数（方向约定：0° = 正北 -Z，90° = 正东 +X） */
export interface WindDebugState extends WindState {
  /** 风自调节是否开启（关闭 = 雷达图/风速滑杆手动控制） */
  auto: boolean;
  windDirDeg: number;
  windSpeed: number;
  currentDirDeg: number;
  currentSpeed: number;
  /** 当前木筏航速（海流+帆推力；=世界滚动合速度） */
  flowSpeed: number;
  /** 当前张开的帆数（调试读数） */
  openSails: number;
  /** 是否正在划桨（调试读数） */
  paddling: boolean;
  /** 累计航程（米） */
  distanceM: number;
}

export interface WindSystem {
  update: (dt: number, elapsed: number) => void;
  /** 风向量（风吹向的方向 × 有效风速，含阵风）；雨丝视觉与里程碑 2 帆推力消费 */
  getWindVector: () => { x: number; z: number };
  /** 木筏航速（动量状态：推力与相对海流的水阻力共同演化） */
  getRaftVelocity: () => { x: number; z: number };
  /** 是否正在划桨（手持船桨按住左键；手持模型动画消费） */
  isPaddling: () => boolean;
  /** 世界相对木筏的流速（= -木筏航速；漂浮物/钩子/鲨鱼肉直接消费） */
  getWorldFlow: () => { x: number; z: number };
  /** 累计滚动偏移（海面波形采样用：GPU/CPU 同加此偏移） */
  getScrollOffset: () => { x: number; z: number };
  /** 风状态（天气派生消费） */
  getWindState: () => WindState;
  /** 强制工况（【仅调试】选天气时把风/湿度拨到对应状态，随后交还自主演化） */
  forceCondition: (type: WeatherType) => void;
  /** 【仅调试】风自调节开关：关闭后风向/风速完全由 setManualWind 决定 */
  setAuto: (on: boolean) => void;
  /** 【仅调试】手动风向风速（0° = 正北）；自调节关闭时生效 */
  setManualWind: (dirDeg: number, speed: number) => void;
  /** 【仅调试】面板读数快照 */
  getDebugState: () => WindDebugState;
}

export function createWindSystem(w: WorldView): WindSystem {
  let windDir = Math.random() * Math.PI * 2; // 弧度；内部 (cos, sin) 表示
  let regime: WindRegime = Math.random() < 0.5 ? 'CALM' : 'BREEZE';
  let regimeDwell = nextDwell();
  let baseSpeed = REGIME_SPEED[regime]; // 平滑基础风速（不含阵风）
  let effectiveSpeed = baseSpeed; // 含阵风的上一帧有效风速
  let lastWind = { x: 0, z: 0 };

  // 隐含湿度：缓慢随机漂移，只在天气派生时可见（不受风自调节开关影响）
  let humidity = 0.4 + Math.random() * 0.3;
  let humidityTarget = Math.random();
  let humidityTimer = 40 + Math.random() * 40;

  // 手动模式（自调节关闭）：风向/风速完全由面板决定，交接时从当前值起步无跳变
  let windAuto = true;
  let manualDir = windDir;
  let manualSpeed = baseSpeed;

  const current = { x: 0, z: 0 };
  /** 木筏航速 = 海流 + 帆推力 + 划桨推力（getRaftVelocity / getWorldFlow 的统一来源） */
  const raftVel = { x: 0, z: 0 };
  const scroll = { x: 0, z: 0 };
  let distanceM = 0;

  // 划桨推力（起桨渐快、收桨快速归零；松桨后的滑行由动量+阻力负责）
  const paddleVel = { x: 0, z: 0 };
  let paddlingNow = false;
  const camForward = new THREE.Vector3();

  /** 当前张开的帆数（BuildSystem 的 F 开合写 data.sailOpen） */
  const openSailCount = (): number => {
    let n = 0;
    for (const s of w.build().structures.values()) {
      if (s.type === 'sail' && s.data?.sailOpen) n++;
    }
    return n;
  };

  /** 是否正在划桨：手持船桨 + 按住左键 + 指针锁定 + 非建造/拆除模式（左键另有用途） */
  const isRowing = (): boolean => {
    if (!w.isPointerLocked() || !w.isMouseDown(0)) return false;
    const build = w.build();
    if (build.isBuildMode || build.isDemolishMode) return false;
    const inv = w.inventory();
    return inv.hotbar[inv.activeHotbarIdx]?.itemId === 'paddle';
  };

  const update = (dt: number, elapsed: number) => {
    // 湿度慢漂移始终运行（手动模式下天气派生仍需要湿度闸门）
    humidityTimer -= dt;
    if (humidityTimer <= 0) {
      humidityTarget = Math.random();
      humidityTimer = 40 + Math.random() * 40;
    }
    humidity += (humidityTarget - humidity) * Math.min(1, dt * 0.04);

    if (windAuto) {
      // 1. 工况驻留与随机跳转
      regimeDwell -= dt;
      if (regimeDwell <= 0) {
        regime = pickRegime(regime);
        regimeDwell = nextDwell();
      }
      // 2. 风速：基础值向工况目标平滑 + 阵风抖动
      baseSpeed += (REGIME_SPEED[regime] - baseSpeed) * Math.min(1, dt * WIND_LERP_RATE);
      effectiveSpeed = Math.max(0.05, baseSpeed + gustNoise(elapsed) * REGIME_GUST[regime]);
      // 3. 风向蜿蜒
      windDir += windWander(elapsed) * dt;
    } else {
      windDir = manualDir;
      baseSpeed = manualSpeed;
      effectiveSpeed = Math.max(0.05, baseSpeed);
    }

    // 4. 风向量（getWindVector / 调试读数 / 海流的统一来源）
    lastWind.x = Math.cos(windDir) * effectiveSpeed;
    lastWind.z = Math.sin(windDir) * effectiveSpeed;

    // 5. 海流 = 风的低通滤波（矢量滞后跟随：风暴时海流渐涨、过后渐衰；
    //    50s 时间常数自动滤平阵风）——不受自调节开关影响，手动拖风向可看海流追上来
    const k = Math.min(1, dt * CURRENT_LERP_RATE);
    current.x += (lastWind.x * CURRENT_RATIO - current.x) * k;
    current.z += (lastWind.z * CURRENT_RATIO - current.z) * k;

    // 5.5 风暴浪涌阻力增益：浪高倍率超出 1 的部分按比例加在水阻力上（顶浪更吃力）
    const stormDrag = 1 + STORM_DRAG_GAIN * Math.max(0, w.weather().getWaveHeightMultiplier() - 1);

    // 6. 帆推力：只有张开的帆吃风；推力方向 = 风吹向的方向，收帆即归零
    const sailFactor = SAIL_THRUST_PER_SAIL * Math.min(openSailCount(), SAIL_COUNT_CAP);

    // 6.5 划桨推力：手持船桨按住左键 = 向视角方向推进（不消耗体力）。
    //     轻微正弦是划水节奏；开帆时力度折减为"微调航向"。
    paddlingNow = isRowing();
    let thrustX = lastWind.x * sailFactor;
    let thrustZ = lastWind.z * sailFactor;
    if (paddlingNow) {
      camForward.set(0, 0, -1).applyQuaternion(w.camera.quaternion);
      camForward.y = 0;
      if (camForward.lengthSq() > 1e-4) camForward.normalize();
      const stroke = (0.85 + 0.15 * Math.sin(elapsed * 3.4)) * PADDLE_THRUST;
      const authority = sailFactor > 0 ? PADDLE_TRIM_FACTOR : 1;
      const kIn = Math.min(1, dt * PADDLE_LERP_IN);
      paddleVel.x += (camForward.x * stroke * authority - paddleVel.x) * kIn;
      paddleVel.z += (camForward.z * stroke * authority - paddleVel.z) * kIn;
    } else {
      // 收桨：推力快速归零（只平滑收桨瞬间）；松桨后的滑行交给动量+阻力
      const kOut = Math.min(1, dt * PADDLE_LERP_OUT);
      paddleVel.x -= paddleVel.x * kOut;
      paddleVel.z -= paddleVel.z * kOut;
    }
    thrustX += paddleVel.x;
    thrustZ += paddleVel.z;

    // 7. 动量积分：raftVel 是惯性状态（不再逐帧"海流+帆+桨"硬算相加）。
    //    推力 + 二次水阻力（只作用于相对海流的速度）——松桨后的长滑行、
    //    顶流划桨的净速、满帆极速全部由推力-阻力平衡 v* = sqrt(推力/k) 涌现。
    const relX = raftVel.x - current.x;
    const relZ = raftVel.z - current.z;
    const relSpeed = Math.hypot(relX, relZ);
    const drag = WATER_DRAG * stormDrag * relSpeed;
    raftVel.x += (thrustX - drag * relX) * dt;
    raftVel.z += (thrustZ - drag * relZ) * dt;
    const speed = Math.hypot(raftVel.x, raftVel.z);
    if (speed > MAX_RAFT_SPEED) {
      const clamp = MAX_RAFT_SPEED / speed;
      raftVel.x *= clamp;
      raftVel.z *= clamp;
    }
    scroll.x += raftVel.x * dt;
    scroll.z += raftVel.z * dt;
    distanceM += speed * dt;
  };

  return {
    update,
    getWindVector: () => ({ ...lastWind }),
    getRaftVelocity: () => ({ x: raftVel.x, z: raftVel.z }),
    isPaddling: () => paddlingNow,
    getWorldFlow: () => ({ x: -raftVel.x, z: -raftVel.z }),
    getScrollOffset: () => ({ x: scroll.x, z: scroll.z }),
    getWindState: () => ({
      speed: effectiveSpeed,
      humidity,
      regime,
      regimeLabel: REGIME_LABEL[regime],
    }),
    forceCondition: (type) => {
      if (type === 'HEAVY_RAIN') {
        regime = 'GALE';
        humidity = humidityTarget = 0.8;
      } else if (type === 'LIGHT_FOG') {
        regime = 'CALM';
        humidity = humidityTarget = 0.75;
      } else {
        regime = 'BREEZE';
        humidity = humidityTarget = 0.4;
      }
      regimeDwell = nextDwell();
    },
    setAuto: (on) => {
      if (on === windAuto) return;
      windAuto = on;
      if (!on) {
        // 交接：手动值从当前风状态起步，方向/速度无跳变
        manualDir = windDir;
        manualSpeed = baseSpeed;
      } else {
        // 交还：工况演化从当前值平滑过渡（baseSpeed 已是手动值，lerp 自然衔接）
        regimeDwell = nextDwell();
      }
    },
    setManualWind: (dirDeg, speed) => {
      // 面板 0° = 正北；内部 (cos, sin) 表示需换算（内部 0 弧度 = 正东）
      manualDir = ((dirDeg - 90) * Math.PI) / 180;
      manualSpeed = speed;
      if (!windAuto) {
        windDir = manualDir;
        baseSpeed = manualSpeed;
      }
    },
    getDebugState: () => {
      const norm = (d: number) => ((d * 180) / Math.PI + 360) % 360;
      return {
        windDirDeg: norm(Math.atan2(lastWind.x, -lastWind.z)),
        windSpeed: Math.hypot(lastWind.x, lastWind.z),
        currentDirDeg: norm(Math.atan2(current.x, -current.z)),
        currentSpeed: Math.hypot(current.x, current.z),
        flowSpeed: Math.hypot(raftVel.x, raftVel.z),
        openSails: openSailCount(),
        paddling: paddlingNow,
        distanceM,
        auto: windAuto,
        speed: effectiveSpeed,
        humidity,
        regime,
        regimeLabel: REGIME_LABEL[regime],
      };
    },
  };
}
