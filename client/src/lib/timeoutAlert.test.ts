/**
 * 暂停倒计时提示状态机的单元测试。
 *
 * 锁住四件事:
 *   1. 进入最后 5 秒 → 警示,并逐秒读秒
 *   2. 归零 → 报"时间到",且只报一次
 *   3. 「继续比赛」提前结束 → 不报"时间到",撤掉警示
 *   4. 采样是 60Hz —— 同一秒内重复采样不能刷屏
 */
import { describe, expect, it } from 'vitest';
import {
  IDLE_TIMEOUT_WATCH,
  TIMEOUT_URGENT_MS,
  stepTimeoutWatch,
  type TimeoutWatch,
} from './timeoutAlert';

/** 连续采样若干次,收集所有 transition */
function feed(
  start: TimeoutWatch,
  samples: { running: boolean; left: number }[],
): { types: string[]; last: TimeoutWatch } {
  let watch = start;
  const types: string[] = [];
  for (const s of samples) {
    const step = stepTimeoutWatch(watch, s);
    watch = step.watch;
    types.push(step.transition.type);
  }
  return { types, last: watch };
}

describe('暂停倒计时提示', () => {
  it('刚开始时不提示', () => {
    const { types } = feed(IDLE_TIMEOUT_WATCH, [
      { running: true, left: 60_000 },
      { running: true, left: 59_000 },
    ]);
    expect(types).toEqual(['none', 'none']);
  });

  it('进入最后 5 秒 → 警示,并逐秒读秒', () => {
    const { types } = feed(IDLE_TIMEOUT_WATCH, [
      { running: true, left: 60_000 },
      { running: true, left: 5000 },
      { running: true, left: 4000 },
      { running: true, left: 3000 },
      { running: true, left: 2000 },
      { running: true, left: 1000 },
    ]);
    expect(types).toEqual(['none', 'urgent', 'urgent', 'urgent', 'urgent', 'urgent']);
  });

  it('读秒数取整到秒(向上取整,4.2 秒显示 5 秒)', () => {
    const step = stepTimeoutWatch(IDLE_TIMEOUT_WATCH, { running: true, left: 4200 });
    expect(step.transition).toEqual({ type: 'urgent', seconds: 5 });
  });

  it('同一秒内重复采样不重复报(采样 60Hz,不能刷屏)', () => {
    const first = stepTimeoutWatch(IDLE_TIMEOUT_WATCH, { running: true, left: 4200 });
    expect(first.transition.type).toBe('urgent');
    // 同一秒内又采了两次,left 略变但读秒还是 5
    const second = stepTimeoutWatch(first.watch, { running: true, left: 4100 });
    expect(second.transition).toEqual({ type: 'none' });
    const third = stepTimeoutWatch(second.watch, { running: true, left: 4050 });
    expect(third.transition).toEqual({ type: 'none' });
  });

  it('归零 → 报"时间到",且只报一次', () => {
    const { types } = feed(IDLE_TIMEOUT_WATCH, [
      { running: true, left: 5000 },
      { running: true, left: 0 },
      { running: true, left: 0 },
      { running: true, left: 0 },
    ]);
    expect(types).toEqual(['urgent', 'ended', 'none', 'none']);
  });

  it('服务端收尾(倒计时在跑时归零,随后 running 变 false)也只报一次', () => {
    const { types } = feed(IDLE_TIMEOUT_WATCH, [
      { running: true, left: 3000 },
      { running: true, left: 0 },
      { running: false, left: 0 },
    ]);
    expect(types).toEqual(['urgent', 'ended', 'none']);
  });

  it('「继续比赛」提前结束 → 不报"时间到",撤掉提示', () => {
    const { types } = feed(IDLE_TIMEOUT_WATCH, [
      { running: true, left: 30_000 },
      { running: false, left: 0 },
    ]);
    expect(types).toEqual(['none', 'cleared']);
  });

  it('最后几秒内按「继续比赛」→ 仍然报"时间到"(此刻倒计时确实到点了)', () => {
    const { types } = feed(IDLE_TIMEOUT_WATCH, [
      { running: true, left: 2000 },
      { running: false, left: 0 },
    ]);
    expect(types).toEqual(['urgent', 'ended']);
  });

  it('倒计时重新开始(时间被调回)→ 撤掉警示', () => {
    const { types } = feed(IDLE_TIMEOUT_WATCH, [
      { running: true, left: 3000 },
      { running: true, left: 60_000 },
    ]);
    expect(types).toEqual(['urgent', 'cleared']);
  });

  it('阈值就是 5 秒', () => {
    expect(TIMEOUT_URGENT_MS).toBe(5000);
  });
});
