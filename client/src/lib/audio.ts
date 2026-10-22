/**
 * 体育馆式蜂鸣器 —— NBA 风格工业汽笛(WebAudio 本地合成,零字节音频资源)。
 *
 * 声音本身由 ./horn.ts 纯数学合成:单声、低沉、长鸣,
 * 与 NBA 现场那种"低沉的号——"是同一类音色。
 * 这里只负责把它装进 AudioContext 并播放。
 *
 * 重要:自动蜂鸣必须由【本地推算的归零时刻】触发(见 Display 页),
 * 不能依赖服务端 event 消息 —— 断网时 event 根本收不到。
 */
import { renderHornPreset, type HornPresetId } from './horn';

export type BuzzKind = HornPresetId;

export interface Buzzer {
  /** 需在用户手势里调用:创建/恢复 AudioContext,并播放一个极短测试音 */
  unlock(): Promise<boolean>;
  /**
   * 探测当前能否发声(不播放声音)。
   * @returns true = AudioContext 已经 running,可以直接发声
   */
  probe(): Promise<boolean>;
  /**
   * 播放一次蜂鸣(未解锁时静默失败)。
   * @param kind 'short' = 短促一声(手动/进攻钟归零);'long' = 长鸣(比赛钟归零)
   */
  buzz(kind?: BuzzKind): void;
  /** 释放资源 */
  dispose(): void;
  /** 当前是否已经解锁(可以发声) */
  readonly unlocked: boolean;
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 等待若干毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 尝试恢复 AudioContext,但不无限期等待。
 *
 * 关键:没有用户手势时,浏览器可能【既不把状态改成 running,也不 resolve resume() 的 promise】。
 * 直接 await 会永远挂起 —— 那会让大屏的"点击开启音效"提示永远弹不出来,
 * 整场比赛都是哑的。所以一律加超时兜底。
 */
async function resumeWithTimeout(c: AudioContext, ms = 1500): Promise<void> {
  try {
    await Promise.race([c.resume(), sleep(ms)]);
  } catch {
    /* 恢复失败,静默 */
  }
}

export function createBuzzer(): Buzzer {
  let ctx: AudioContext | null = null;
  // 渲染好的 AudioBuffer 缓存(按 音色 + 采样率)
  const buffers = new Map<string, AudioBuffer>();

  function ensureCtx(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  /** 渲染(并缓存)一声汽笛 */
  function hornBuffer(c: AudioContext, kind: BuzzKind): AudioBuffer | null {
    const key = `${kind}@${c.sampleRate}`;
    const cached = buffers.get(key);
    if (cached) return cached;
    try {
      const pcm = renderHornPreset(kind, c.sampleRate);
      const buf = c.createBuffer(1, pcm.length, c.sampleRate);
      // 复制到一个明确由 ArrayBuffer 支撑的数组再灌进去
      // (不同 TS 版本的 Float32Array 泛型默认值不一致,这里绕开)
      const channel = new Float32Array(pcm.length);
      channel.set(pcm);
      buf.copyToChannel(channel, 0);
      buffers.set(key, buf);
      return buf;
    } catch {
      return null;
    }
  }

  /** 播放一个已渲染好的 buffer */
  function play(c: AudioContext, buf: AudioBuffer): void {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(c.currentTime + 0.02);
  }

  return {
    get unlocked(): boolean {
      return !!ctx && ctx.state === 'running';
    },

    async unlock(): Promise<boolean> {
      const c = ensureCtx();
      if (!c) return false;
      // 这一步是在【用户手势】里调用的,浏览器才允许真正恢复
      if ((c.state as AudioContextState) !== 'running') {
        await resumeWithTimeout(c);
      }
      if ((c.state as AudioContextState) !== 'running') return false;
      // 播一声短汽笛:用户点"开启音效"时立刻听到真实音色,方便确认
      try {
        const buf = hornBuffer(c, 'short');
        if (buf) play(c, buf);
      } catch {
        /* ignore */
      }
      return true;
    },

    async probe(): Promise<boolean> {
      const c = ensureCtx();
      if (!c) return false;
      /*
       * 这里【绝对不能】await c.resume():
       * 没有用户手势时,浏览器可能既不把状态改成 running,也不 resolve 这个 promise,
       * 于是 probe 永远挂起 —— 大屏就永远不会弹"点击开启音效"的提示,整场没有声音。
       * 只看当前状态,让上层决定要不要弹遮罩。
       */
      return (c.state as AudioContextState) === 'running';
    },

    buzz(kind: BuzzKind = 'short'): void {
      const c = ensureCtx();
      if (!c) return;
      if ((c.state as AudioContextState) !== 'running') {
        // 还没解锁:尽力恢复一下(没有手势时通常不会成功),本次不响
        void resumeWithTimeout(c, 800);
        return;
      }
      try {
        const buf = hornBuffer(c, kind);
        if (buf) play(c, buf);
      } catch {
        /* ignore */
      }
    },

    dispose(): void {
      buffers.clear();
      // 关掉当前 AudioContext;之后若再次 unlock/probe,会按需重建。
      if (ctx) {
        try {
          void ctx.close();
        } catch {
          /* ignore */
        }
        ctx = null;
      }
    },
  };
}
