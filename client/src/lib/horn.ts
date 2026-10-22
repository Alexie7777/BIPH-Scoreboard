/**
 * NBA 风格工业汽笛蜂鸣器 —— 纯数学合成,零字节音频资源。
 *
 * 为什么不用 mp3:
 *   1. 零外网依赖(项目硬约束):断网、纯内网、离线赛场都能响;
 *   2. 声音在【大屏本机】现算现放,归零那一刻零延迟;
 *   3. 不涉及任何第三方录音素材的授权问题。
 *
 * 声音特征(对着 NBA 现场那种工业号角):
 *   - 【单声长鸣】,不是电子计时器那种"哔—哔—"两声
 *   - 基频很低(约 165Hz),体育馆扩声下有压迫感,手机外放也能听出来
 *   - 丰富的谐波列(管状号角的高次模态),高次模态还带微小失谐 → 拍频 → 听感更"厚"
 *   - 起音只有几毫秒、释放干脆 —— 号角的标志
 *   - 软饱和(软削波),让"响度感"接近真实扩声设备
 *   - 一点点高通白噪声,模拟号角的气流声
 *
 * 本模块【不依赖 WebAudio API】,只输出采样数组:
 *   - 浏览器端:塞进 AudioBuffer 播放
 *   - Node 端:直接分析波形(单元测试用),保证"听到的"和"验证的"是同一份代码
 */

/** 蜂鸣器预设 */
export const HORN_PRESETS = {
  /**
   * 短促一声:手动蜂鸣、进攻钟归零、节次结束。
   * NBA 现场也是同一个号角,只是按的时间长短不同。
   */
  short: { durationMs: 430 },
  /**
   * 长鸣:比赛钟归零(比赛结束那一刻)。
   * NBA 比赛结束那声长鸣就是这种"低沉的号——"。
   */
  long: { durationMs: 1900 },
} as const;

export type HornPresetId = keyof typeof HORN_PRESETS;

export interface HornOptions {
  /** 采样率(浏览器里传 ctx.sampleRate) */
  sampleRate: number;
  /** 持续时长(ms) */
  durationMs: number;
  /** 基频(Hz)。NBA 那种号角很沉,默认 165 */
  baseFreq?: number;
  /** 谐波数,越多越"厚" */
  harmonics?: number;
  /** 起音时长(ms),号角起音极快 */
  attackMs?: number;
  /** 释放时长(ms) */
  releaseMs?: number;
  /** 气流噪声量(0~0.1) */
  noise?: number;
  /** 软饱和驱动量,越大越"炸" */
  drive?: number;
  /** 输出峰值(0~1) */
  peak?: number;
}

const DEFAULTS = {
  baseFreq: 165,
  harmonics: 12,
  attackMs: 4,
  releaseMs: 45,
  noise: 0.028,
  drive: 1.7,
  peak: 0.92,
} as const;

/** 简易确定性伪随机(同一个种子永远同一份波形,方便测试比对) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 渲染一声工业汽笛。
 * @returns 单声道 Float32Array,取值范围约 [-peak, peak]
 */
export function renderHorn(options: HornOptions): Float32Array {
  const {
    sampleRate,
    durationMs,
    baseFreq = DEFAULTS.baseFreq,
    harmonics = DEFAULTS.harmonics,
    attackMs = DEFAULTS.attackMs,
    releaseMs = DEFAULTS.releaseMs,
    noise = DEFAULTS.noise,
    drive = DEFAULTS.drive,
    peak = DEFAULTS.peak,
  } = options;

  const n = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const out = new Float32Array(n);

  /* ---------- 1. 谐波列(号角的高次模态) ---------- */
  // 增益按 1/n^1.15 衰减(高次模态弱),奇次略强(管子封闭端的特征)
  // 高次模态加一点点失谐,产生拍频 → 听感更厚、更有"金属感"
  const parts: { freq: number; gain: number; phase: number }[] = [];
  for (let k = 1; k <= harmonics; k += 1) {
    const parity = k % 2 === 1 ? 1 : 0.72;
    const gain = (parity / Math.pow(k, 1.15)) * (k === 1 ? 1.6 : 1);
    const detune = k === 1 ? 1 : k % 2 === 0 ? 1.0016 : 0.9979;
    parts.push({
      freq: baseFreq * k * detune,
      gain,
      phase: (k * 1.7) % (Math.PI * 2),
    });
  }

  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    let s = 0;
    for (const p of parts) {
      s += p.gain * Math.sin(2 * Math.PI * p.freq * t + p.phase);
    }
    out[i] = s;
  }

  /* ---------- 2. 气流噪声(白噪声减去低通残差 = 高通) ---------- */
  if (noise > 0) {
    const rand = mulberry32(0x5eed);
    let lp = 0;
    for (let i = 0; i < n; i += 1) {
      const w = rand() * 2 - 1;
      lp += (w - lp) * 0.35;
      out[i] = out[i]! + (w - lp) * noise;
    }
  }

  /* ---------- 3. 归一化 → 软饱和 → 再归一化 ---------- */
  // 先把原始波形拉到 0..1,再过软削波,保证不同长度/音色的响度一致
  let max = 0;
  for (let i = 0; i < n; i += 1) max = Math.max(max, Math.abs(out[i]!));
  if (max > 0) {
    const inv = 1 / max;
    for (let i = 0; i < n; i += 1) out[i] = out[i]! * inv;
  }

  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i += 1) {
    out[i] = Math.tanh(out[i]! * drive) / norm;
  }

  /* ---------- 4. 包络:极快起音 + 保持 + 干脆释放 ---------- */
  const attack = Math.max(1, Math.round((sampleRate * attackMs) / 1000));
  const release = Math.max(1, Math.round((sampleRate * releaseMs) / 1000));
  for (let i = 0; i < n; i += 1) {
    let e: number;
    if (i < attack) {
      e = i / attack;
    } else if (i > n - release) {
      e = Math.exp((-6 * (i - (n - release))) / release);
    } else {
      e = 1;
    }
    out[i] = out[i]! * e;
  }

  /* ---------- 5. 归一到目标峰值(不削波) ---------- */
  max = 0;
  for (let i = 0; i < n; i += 1) max = Math.max(max, Math.abs(out[i]!));
  if (max > 0) {
    const g = peak / max;
    for (let i = 0; i < n; i += 1) out[i] = out[i]! * g;
  }

  return out;
}

/** 按预设渲染 */
export function renderHornPreset(
  preset: HornPresetId,
  sampleRate: number,
  overrides: Partial<HornOptions> = {},
): Float32Array {
  return renderHorn({
    sampleRate,
    durationMs: HORN_PRESETS[preset].durationMs,
    ...overrides,
  });
}
