/**
 * 暂停倒计时的提示状态机(纯函数)。
 * ------------------------------------------------------------------
 * 为什么放在客户端算:暂停倒计时也是锚点,客户端本来就能本地推算剩余时间。
 * 所以"最后 5 秒"和"刚刚归零"这两个时刻,**断网也能准时判定** ——
 * 和计时器不依赖网络是同一条原则。
 *
 * 为什么需要一个状态机:服务端在倒计时归零时会自动收尾(清锚点),
 * 这条路**不走命令通道、不发事件**,客户端只能靠"上一次采样 vs 这一次采样"
 * 的差异来判断"刚才发生了什么"。纯函数好测,也好推理。
 *
 * 三种提示:
 *   urgent  —— 剩最后几秒(默认 5 秒):红色警示 + 读秒
 *   ended   —— 倒计时走完了:绿色收尾提示
 *   cleared —— 「继续比赛」提前结束:撤掉警示(不算"时间到")
 */
export interface TimeoutWatch {
  /** 上一次采样:暂停倒计时是否在跑 */
  running: boolean;
  /** 上一次采样的剩余毫秒 */
  left: number;
  /** 上一次是否已经进入"最后几秒" */
  urgent: boolean;
  /** 已经提示过的读秒数(0 = 还没提示过) */
  alerted: number;
  /** "归零"这件事是不是已经报过了 */
  ended: boolean;
}

export const IDLE_TIMEOUT_WATCH: TimeoutWatch = {
  running: false,
  left: 0,
  urgent: false,
  alerted: 0,
  ended: false,
};

/** 进入警示的阈值:剩 5 秒 */
export const TIMEOUT_URGENT_MS = 5000;

export type TimeoutTransition =
  | { type: 'none' }
  | { type: 'urgent'; seconds: number }
  | { type: 'ended' }
  | { type: 'cleared' };

export interface TimeoutStep {
  watch: TimeoutWatch;
  transition: TimeoutTransition;
}

/**
 * 推进一步。
 *
 * @param prev   上一次采样后的状态
 * @param next   这一次的采样:{ running: 倒计时是否在跑, left: 剩余毫秒 }
 * @param urgentMs 进入警示的阈值
 */
export function stepTimeoutWatch(
  prev: TimeoutWatch,
  next: { running: boolean; left: number },
  urgentMs: number = TIMEOUT_URGENT_MS,
): TimeoutStep {
  // ① 倒计时归零,但服务端还没收尾 —— 这就是"时间到"的那一刻
  if (next.running && next.left <= 0) {
    if (prev.ended) return { watch: prev, transition: { type: 'none' } };
    return { watch: { ...prev, ended: true }, transition: { type: 'ended' } };
  }

  // ② 倒计时还在跑
  if (next.running) {
    const urgent = next.left <= urgentMs;
    if (!urgent) {
      // 刚开始,或者倒计时被重置/重新起过:没有提示可显示
      return {
        watch: { running: true, left: next.left, urgent: false, alerted: 0, ended: false },
        transition: prev.urgent ? { type: 'cleared' } : { type: 'none' },
      };
    }
    const seconds = Math.max(1, Math.ceil(next.left / 1000));
    // 读秒没变就别重复报(采样是 60Hz,不变就安静)
    if (prev.urgent && prev.alerted === seconds && !prev.ended) {
      return { watch: { ...prev, left: next.left }, transition: { type: 'none' } };
    }
    return {
      watch: { running: true, left: next.left, urgent: true, alerted: seconds, ended: false },
      transition: { type: 'urgent', seconds },
    };
  }

  // ③ 暂停已经不在进行了
  if (prev.running && !prev.ended) {
    /*
     * 从"在跑"变成"不在跑",有两种可能:
     *   - 刚才还在最后几秒 → 倒计时自然走完,服务端自动收尾 → 报"时间到"
     *   - 刚才还很早         → 是按了「继续比赛」提前结束的 → 不算"时间到"
     */
    const naturalEnd = prev.urgent;
    return {
      watch: { running: false, left: 0, urgent: false, alerted: 0, ended: false },
      transition: naturalEnd ? { type: 'ended' } : { type: 'cleared' },
    };
  }

  // ④ 一直不在进行:什么都不用做
  return {
    watch: { running: false, left: 0, urgent: false, alerted: 0, ended: false },
    transition: { type: 'none' },
  };
}
