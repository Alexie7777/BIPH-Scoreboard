import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  START_COUNTDOWN_WINDOW_MS,
  ServerClockEstimator,
  buildPeriodLabel,
  isValidStartTime,
  nextStartOccurrence,
  periodDurationMs,
  remainingMs,
  startCountdownMs,
  type ClockAnchor,
  type MatchRules,
  type TimeAnchor,
} from '@biph/shared';
import {
  adjustClock,
  adjustShotClock,
  createAnchor,
  currentRemaining,
  currentTimeoutRemaining,
  endTimeoutAnchor,
  pauseClock,
  pauseShotClock,
  resetClock,
  resetShotClock,
  setClock,
  setPeriod,
  setShotClock,
  startClock,
  startShotClock,
  startTimeoutAnchor,
  toggleClock,
  toggleShotClock,
} from '../src/clock.js';

const RULES: MatchRules = { ...DEFAULT_RULES, periods: 4, periodMinutes: 10 };
const T0 = 1_700_000_000_000;

function anchor(overrides: Partial<ClockAnchor> = {}): ClockAnchor {
  return {
    running: false,
    remainingMs: periodDurationMs(RULES),
    anchorServerTs: T0,
    period: 1,
    periodLabel: 'Q1',
    ...overrides,
  };
}

/**
 * 模拟一个客户端:
 *  - 收到带 serverTs 的消息时记录基准
 *  - 之后用 performance.now() 的单调推进估算「当前服务器时间」
 */
class ClientClock {
  private lastServerTs = 0;
  private lastRecvPerf = 0;

  receive(serverTs: number, recvPerf: number): void {
    this.lastServerTs = serverTs;
    this.lastRecvPerf = recvPerf;
  }

  serverNowEst(perfNow: number): number {
    return this.lastServerTs + (perfNow - this.lastRecvPerf);
  }

  display(anchor: TimeAnchor, perfNow: number): number {
    return remainingMs(anchor, this.serverNowEst(perfNow));
  }
}

describe('锚点基础操作', () => {
  it('开始计时:把当前剩余量固化为新锚点并标记为运行', () => {
    const a = anchor({ remainingMs: 500_000, running: false });
    const started = startClock(a, T0);
    expect(started.running).toBe(true);
    expect(started.remainingMs).toBe(500_000);
    expect(started.anchorServerTs).toBe(T0);
  });

  it('已经运行时再调 start 是幂等的(不会重置剩余量)', () => {
    const a = startClock(anchor({ remainingMs: 500_000 }), T0);
    const again = startClock(a, T0 + 5_000);
    expect(again).toBe(a);
  });

  it('暂停:冻结当前真实剩余量,而不是冻结一个过时的值', () => {
    const a = startClock(anchor({ remainingMs: 600_000 }), T0);
    // 3 秒后暂停,此时真实剩余应为 597000
    const paused = pauseClock(a, T0 + 3_000);
    expect(paused.running).toBe(false);
    expect(paused.remainingMs).toBe(597_000);
    // 暂停后再过 10 秒,剩余量不变
    expect(currentRemaining(paused, T0 + 13_000)).toBe(597_000);
  });

  it('调整:只生效一次,不会被重复施加', () => {
    const a = startClock(anchor({ remainingMs: 600_000 }), T0);
    // 2 秒后 +10 秒
    const adj = adjustClock(a, 10_000, T0 + 2_000);
    expect(adj.remainingMs).toBe(608_000);
    // 再过 1 秒,真实剩余是 607000 —— 调整没有再被加一次
    expect(currentRemaining(adj, T0 + 3_000)).toBe(607_000);
  });

  it('调整可以取负,且不会低于 0', () => {
    const a = startClock(anchor({ remainingMs: 5_000 }), T0);
    const adj = adjustClock(a, -60_000, T0);
    expect(adj.remainingMs).toBe(0);
  });

  it('直接设定绝对时间', () => {
    const a = startClock(anchor({ remainingMs: 600_000 }), T0);
    const set = setClock(a, 120_000, T0 + 1_000);
    expect(set.remainingMs).toBe(120_000);
    expect(set.running).toBe(true);
  });

  it('切节:重置到本节总时长并停止,由计分员显式开始', () => {
    const a = startClock(anchor({ remainingMs: 0, period: 1 }), T0);
    const p2 = setPeriod(a, 2, RULES, 'live', T0);
    expect(p2.period).toBe(2);
    expect(p2.periodLabel).toBe('Q2');
    expect(p2.remainingMs).toBe(600_000);
    expect(p2.running).toBe(false);
  });

  it('加时赛标签为 OT1', () => {
    const a = anchor({ period: 5 });
    expect(buildPeriodLabel(5, 4, 'live')).toBe('OT1');
  });

  it('重置:回到本节总时长并停止', () => {
    const a = startClock(anchor({ remainingMs: 123_000 }), T0);
    const r = resetClock(a, RULES, 'live', T0);
    expect(r.remainingMs).toBe(600_000);
    expect(r.running).toBe(false);
  });

  it('启停切换', () => {
    const a = anchor({ remainingMs: 600_000 });
    const on = toggleClock(a, T0);
    expect(on.running).toBe(true);
    const off = toggleClock(on, T0 + 1_000);
    expect(off.running).toBe(false);
    expect(off.remainingMs).toBe(599_000);
  });
});

describe('进攻钟', () => {
  const shot = (over: Partial<ClockAnchor> = {}) =>
    anchor({ remainingMs: 24_000, periodLabel: '', ...over });

  it('开始 / 暂停 / 切换', () => {
    const a = shot();
    const on = startShotClock(a, T0);
    expect(on.running).toBe(true);
    const off = toggleShotClock(on, T0 + 2_000);
    expect(off.running).toBe(false);
    expect(off.remainingMs).toBe(22_000);
  });

  it('调整与重置', () => {
    const a = startShotClock(shot(), T0);
    const adj = adjustShotClock(a, -5_000, T0 + 1_000);
    expect(adj.remainingMs).toBe(18_000);
    const r = resetShotClock(adj, RULES, T0);
    expect(r.remainingMs).toBe(24_000);
    expect(r.running).toBe(false);
  });

  it('直接设定', () => {
    const a = setShotClock(shot(), 14_000, T0);
    expect(a.remainingMs).toBe(14_000);
  });

  it('暂停后剩余量冻结', () => {
    const a = pauseShotClock(startShotClock(shot(), T0), T0 + 3_000);
    expect(a.remainingMs).toBe(21_000);
    expect(currentRemaining(a, T0 + 30_000)).toBe(21_000);
  });
});

describe('★ 核心保证:计时不依赖网络', () => {
  it('断网 60 秒,客户端本地推算的剩余时间与真实时间完全一致', () => {
    const a = startClock(anchor({ remainingMs: 600_000 }), T0);

    // 客户端在 t0 收到状态
    const client = new ClientClock();
    client.receive(T0, 0);

    // 网络中断 60 秒:期间没有任何消息到达,客户端只有单调时钟在走
    const OFFLINE_MS = 60_000;
    const truth = currentRemaining(a, T0 + OFFLINE_MS); // 服务端视角的真实剩余
    const shown = client.display(a, OFFLINE_MS); // 客户端本地推算

    expect(shown).toBe(truth);
    expect(shown).toBe(540_000);
  });

  it('消息迟到 2 秒,客户端依然算出正确的当前剩余(自描述消息)', () => {
    // 锚点在 t0 创建并开始计时
    const a = startClock(anchor({ remainingMs: 600_000 }), T0);

    // 承载该锚点的消息在服务器时刻 t0+2000 才发出,客户端随即收到
    const client = new ClientClock();
    client.receive(T0 + 2_000, 0);

    // 客户端此刻(收到后 1 秒)应显示的剩余
    const shown = client.display(a, 1_000);
    // 服务端真实剩余
    const truth = currentRemaining(a, T0 + 3_000);

    expect(shown).toBe(truth);
    expect(shown).toBe(597_000);
  });

  it('任何一条消息单独都能算出当前显示值(不依赖上一条消息)', () => {
    const a = startClock(anchor({ remainingMs: 600_000 }), T0);

    // 完全无关的旧消息:服务器在 t0-50s 发的
    const stale = new ClientClock();
    stale.receive(T0 - 50_000, 0);
    // 收到后客户端本地又走了 51 秒 → 估算的服务器时间是 t0+1000
    expect(stale.display(a, 51_000)).toBe(currentRemaining(a, T0 + 1_000));

    // 最新消息:服务器在 t0+1s 发的
    const fresh = new ClientClock();
    fresh.receive(T0 + 1_000, 0);
    expect(fresh.display(a, 0)).toBe(currentRemaining(a, T0 + 1_000));
  });

  it('重复投递同一条消息,结果完全一致(幂等)', () => {
    const a = startClock(anchor({ remainingMs: 600_000 }), T0);
    const c1 = new ClientClock();
    const c2 = new ClientClock();
    c1.receive(T0 + 1_000, 0);
    c2.receive(T0 + 1_000, 0);
    expect(c1.display(a, 5_000)).toBe(c2.display(a, 5_000));
  });

  it('乱序投递:过期消息不会把基准往回拨,最终值仍然正确', () => {
    const a = startClock(anchor({ remainingMs: 600_000 }), T0);
    const client = new ServerClockEstimator();

    // 最新消息先到:服务器在 t0+1000 发的
    client.receive(T0 + 1_000, 1_000);
    const fresh = client.remaining(a, 1_000);
    expect(fresh).toBe(currentRemaining(a, T0 + 1_000));

    // 随后一条过期消息才到:服务器在 t0 发的(乱序 / 重连补投)
    client.receive(T0, 0);
    const after = client.remaining(a, 2_000);
    // 基准没有被拨回,依然按最新消息推算
    expect(after).toBe(currentRemaining(a, T0 + 2_000));
    expect(after).toBe(fresh - 1_000);
  });

  it('长时间运行不累积漂移(用锚点重算,不是逐秒累加)', () => {
    const a = startClock(anchor({ remainingMs: 600_000 }), T0);
    const client = new ClientClock();
    client.receive(T0, 0);
    // 2 小时后
    const twoHours = 2 * 3600 * 1000;
    expect(client.display(a, twoHours)).toBe(currentRemaining(a, T0 + twoHours));
  });

  it('系统墙钟跳变(NTP 修正)不影响推算:锚点用单调时间差', () => {
    const a = startClock(anchor({ remainingMs: 600_000 }), T0);
    const client = new ClientClock();
    client.receive(T0, 0);
    // 客户端 Date.now() 突然前跳 30 秒,performance.now() 不受影响
    const shown = client.display(a, 10_000);
    expect(shown).toBe(currentRemaining(a, T0 + 10_000));
  });

  it('归零检测:只在真正从正数跨到 0 时触发一次', () => {
    const a = startClock(anchor({ remainingMs: 3_000 }), T0);
    const client = new ClientClock();
    client.receive(T0, 0);

    let prev = client.display(a, 0);
    let fired = 0;
    for (let t = 100; t <= 5_000; t += 100) {
      const cur = client.display(a, t);
      if (prev > 0 && cur === 0) fired += 1;
      prev = cur;
    }
    expect(fired).toBe(1);
  });
});

describe('暂停倒计时', () => {
  it('倒计时也是锚点:按锚点时刻递减,和比赛钟同一套算法', () => {
    const to = startTimeoutAnchor(60, 'home', T0);
    expect(to.running).toBe(true);
    expect(to.remainingMs).toBe(60_000);
    expect(to.side).toBe('home');

    expect(currentTimeoutRemaining(to, T0)).toBe(60_000);
    expect(currentTimeoutRemaining(to, T0 + 5_000)).toBe(55_000);
    // 归零后不会变成负数
    expect(currentTimeoutRemaining(to, T0 + 90_000)).toBe(0);
  });

  it('断网期间倒计时照走(客户端只靠锚点本地推算)', () => {
    const to = startTimeoutAnchor(60, 'home', T0);
    const client = new ClientClock();
    client.receive(T0, 0);

    // 网络中断 30 秒,期间没有任何消息到达
    const truth = currentTimeoutRemaining(to, T0 + 30_000);
    const shown = client.display(to, 30_000);
    expect(shown).toBe(truth);
    expect(shown).toBe(30_000);
  });

  it('结束暂停后锚点清空,不再计时', () => {
    const to = endTimeoutAnchor();
    expect(to.running).toBe(false);
    expect(to.side).toBeNull();
    expect(currentTimeoutRemaining(to, T0 + 10_000)).toBe(0);
  });
});

/* ============================================================================
 * 计划开赛时间(墙钟)与开赛倒计时。
 *
 * 为什么单独一块:开赛时间是赛程表上的"19:00",不是从打开页面开始数的 ——
 * 所以判定必须落到"最近一个还没到的那个时刻"上,跨零点最容易算错。
 * ========================================================================== */

/** 用本机时区构造一个时刻 —— 跟实现里的解释方式一致,测试不依赖具体时区 */
function local(y: number, mo: number, d: number, h: number, mi: number): number {
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

describe('开赛时间格式', () => {
  it('只认 HH:MM', () => {
    expect(isValidStartTime('19:00')).toBe(true);
    expect(isValidStartTime('09:05')).toBe(true);
    expect(isValidStartTime('23:59')).toBe(true);
    expect(isValidStartTime('0:00')).toBe(true);
  });

  it('越界或根本不是时间,一律判为非法', () => {
    expect(isValidStartTime('24:00')).toBe(false);
    expect(isValidStartTime('19:60')).toBe(false);
    expect(isValidStartTime('1900')).toBe(false);
    expect(isValidStartTime('')).toBe(false);
    expect(isValidStartTime('abc')).toBe(false);
    expect(isValidStartTime(null)).toBe(false);
    expect(isValidStartTime(undefined)).toBe(false);
    expect(isValidStartTime(1900)).toBe(false);
  });
});

describe('下一次开赛时刻', () => {
  it('今天还没到 → 就是今天那个时刻', () => {
    const now = local(2026, 10, 22, 18, 57);
    expect(nextStartOccurrence('19:00', now)).toBe(local(2026, 10, 22, 19, 0));
  });

  it('今天已经过了 → 顺延到明天同一时刻', () => {
    const now = local(2026, 10, 22, 20, 10);
    expect(nextStartOccurrence('19:00', now)).toBe(local(2026, 10, 23, 19, 0));
  });

  it('正好到点 → 归零并消失(下一次是明天)', () => {
    const now = local(2026, 10, 22, 19, 0);
    expect(nextStartOccurrence('19:00', now)).toBe(local(2026, 10, 23, 19, 0));
  });

  it('跨零点:23:58 配 00:30,指的是明天 00:30,不是 32 分钟后', () => {
    const now = local(2026, 10, 22, 23, 58);
    expect(nextStartOccurrence('00:30', now)).toBe(local(2026, 10, 23, 0, 30));
  });

  it('没填或格式不对 → 没有下一次', () => {
    const now = local(2026, 10, 22, 18, 57);
    expect(nextStartOccurrence(null, now)).toBeNull();
    expect(nextStartOccurrence(undefined, now)).toBeNull();
    expect(nextStartOccurrence('25:00', now)).toBeNull();
  });
});

describe('开赛倒计时', () => {
  it('开赛前 3 分钟内才倒数,窗口是 3 分钟', () => {
    const start = local(2026, 10, 22, 19, 0);
    // 距开赛 2 分 30 秒 → 在窗口里
    expect(startCountdownMs('19:00', start - 150_000)).toBe(150_000);
    // 距开赛正好 3 分钟 → 刚好在窗口边上
    expect(startCountdownMs('19:00', start - 180_000)).toBe(180_000);
    // 距开赛 3 分 01 秒 → 还没进窗口
    expect(startCountdownMs('19:00', start - 181_000)).toBeNull();
    // 距开赛 10 分钟 → 太早
    expect(startCountdownMs('19:00', start - 600_000)).toBeNull();
  });

  it('到点了就消失', () => {
    const start = local(2026, 10, 22, 19, 0);
    expect(startCountdownMs('19:00', start)).toBeNull();
    expect(startCountdownMs('19:00', start + 1_000)).toBeNull();
  });

  it('没填开赛时间 → 永远不显示', () => {
    const now = local(2026, 10, 22, 18, 58);
    expect(startCountdownMs(null, now)).toBeNull();
    expect(startCountdownMs(undefined, now)).toBeNull();
    expect(startCountdownMs('不是时间', now)).toBeNull();
  });

  it('窗口长度可以调(赛事规则里改)仍按同一套判定', () => {
    const start = local(2026, 10, 22, 19, 0);
    expect(startCountdownMs('19:00', start - 150_000, START_COUNTDOWN_WINDOW_MS)).toBe(150_000);
    expect(startCountdownMs('19:00', start - 150_000, 60_000)).toBeNull();
  });
});
