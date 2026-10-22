/**
 * 工业汽笛蜂鸣器的波形验证。
 *
 * 这组测试的目的很具体:把"听起来像 NBA 那种号角"翻译成【可测量的物理量】,
 * 免得以后有人改参数,改着改着退回成"哔—哔—"两声却没人发现。
 *
 * 判据:
 *   1. 单声连续 —— 保持段没有能量断崖(两声 beep 的特征是中间掉到接近 0)
 *   2. 基频很低 —— 约 165Hz,自相关估出来的
 *   3. 谐波列存在 —— 330 / 495Hz 处有明显的能量峰
 *   4. 不削波 —— 峰值不超过 1
 *   5. 时长符合预设
 */
import { describe, expect, it } from 'vitest';
import { HORN_PRESETS, renderHorn, renderHornPreset } from './horn';

const SR = 48000;

/** 分窗 RMS 包络 */
function rmsEnvelope(pcm: Float32Array, sampleRate: number, windowMs = 20): number[] {
  const win = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const out: number[] = [];
  for (let i = 0; i + win <= pcm.length; i += win) {
    let s = 0;
    for (let j = 0; j < win; j += 1) s += pcm[i + j]! * pcm[i + j]!;
    out.push(Math.sqrt(s / win));
  }
  return out;
}

/** 自相关估基频(取中间一段,避开起音/释放) */
function estimateBaseFreq(pcm: Float32Array, sampleRate: number): number {
  const from = Math.floor(pcm.length * 0.25);
  const to = Math.floor(pcm.length * 0.6);
  const seg = pcm.subarray(from, to);
  const minLag = Math.floor(sampleRate / 1000); // 上限 1000Hz
  const maxLag = Math.floor(sampleRate / 60); // 下限 60Hz
  let bestLag = minLag;
  let bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i + lag < seg.length; i += 1) {
      const a = seg[i]!;
      const b = seg[i + lag]!;
      sum += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const corr = sum / Math.sqrt(e1 * e2 + 1e-12);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  return sampleRate / bestLag;
}

/** 在指定频点做一次 Goertzel 变换,看那里有多少能量 */
function energyAt(pcm: Float32Array, sampleRate: number, freq: number): number {
  const n = pcm.length;
  const k = Math.max(1, Math.round((n * freq) / sampleRate));
  const w = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i += 1) {
    const s0 = pcm[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return Math.sqrt(Math.max(0, power)) / n;
}

describe('工业汽笛蜂鸣器', () => {
  it('长鸣约 1.9 秒,短鸣约 0.43 秒', () => {
    const long = renderHornPreset('long', SR);
    const short = renderHornPreset('short', SR);
    expect(long.length / SR).toBeCloseTo(HORN_PRESETS.long.durationMs / 1000, 2);
    expect(short.length / SR).toBeCloseTo(HORN_PRESETS.short.durationMs / 1000, 2);
  });

  it('是【单声连续】,不是两声 beep:保持段没有能量断崖', () => {
    const pcm = renderHornPreset('long', SR);
    const env = rmsEnvelope(pcm, SR, 20);

    // 去掉起音(前 60ms)与释放(尾 120ms),只看保持段
    const sustain = env.slice(3, Math.floor(env.length - 6));
    const sorted = [...sustain].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const min = sorted[0]!;

    // 关键判据:最低的窗口也要有相当能量。
    // 两声 beep 的中间会掉到接近 0(比值 < 0.05),单声长鸣会保持在 0.6 以上。
    expect(min / median).toBeGreaterThan(0.6);
  });

  it('基频很低(约 165Hz),这是 NBA 那种号角"沉"的关键', () => {
    const pcm = renderHornPreset('short', SR);
    const f = estimateBaseFreq(pcm, SR);
    expect(f).toBeGreaterThan(145);
    expect(f).toBeLessThan(190);
  });

  it('有明显的谐波列(2 次、3 次谐波都在)', () => {
    const pcm = renderHornPreset('short', SR);
    const base = 165;
    const e1 = energyAt(pcm, SR, base);
    const e2 = energyAt(pcm, SR, base * 2);
    const e3 = energyAt(pcm, SR, base * 3);
    // 与一个非谐波频点比:谐波处必须明显更强
    const off = energyAt(pcm, SR, base * 1.37);
    expect(e2).toBeGreaterThan(off * 3);
    expect(e3).toBeGreaterThan(off * 3);
    expect(e1).toBeGreaterThan(0);
  });

  it('不削波:峰值不超过 1', () => {
    for (const kind of ['short', 'long'] as const) {
      const pcm = renderHornPreset(kind, SR);
      let max = 0;
      for (let i = 0; i < pcm.length; i += 1) max = Math.max(max, Math.abs(pcm[i]!));
      expect(max).toBeLessThanOrEqual(1);
      expect(max).toBeGreaterThan(0.5); // 也不是无声
    }
  });

  it('起音够快(前 20ms 内就到峰值附近),不然会听着像"渐强"而不是号角', () => {
    const pcm = renderHornPreset('short', SR);
    const env = rmsEnvelope(pcm, SR, 5);
    const sustain = env.slice(2, -2);
    const sorted = [...sustain].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    expect(env[1]!).toBeGreaterThan(median * 0.5);
  });

  it('波形确定:同样参数渲染两次结果完全一致', () => {
    const a = renderHorn({ sampleRate: SR, durationMs: 500 });
    const b = renderHorn({ sampleRate: SR, durationMs: 500 });
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) expect(a[i]).toBe(b[i]);
  });

  it('不同采样率下时长一致(手机上 44.1k,大屏可能 48k)', () => {
    for (const sr of [44100, 48000]) {
      const pcm = renderHornPreset('long', sr);
      expect(pcm.length / sr).toBeCloseTo(HORN_PRESETS.long.durationMs / 1000, 2);
    }
  });
});
