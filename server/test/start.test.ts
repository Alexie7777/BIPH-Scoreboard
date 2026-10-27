/**
 * 开赛模式(准点 / 倒计时)的共用逻辑。
 *
 * 这些函数在 shared 里,前后端与测试共用同一份实现 ——
 * "大屏该显示什么"只有一处判定,不会出现两侧各算一套的情况。
 *
 * 两条主线:
 *   1. 准点模式:赛程表上的墙钟(19:00),只在开赛前 3 分钟那个窗口出现;
 *   2. 倒计时模式:锚点(设定那一刻起算),从设定起一直显示,**归零后仍然留着**。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_START_COUNTDOWN_MS,
  START_COUNTDOWN_WINDOW_MS,
  formatStartCountdownInput,
  isValidStartCountdownAnchor,
  isValidStartMode,
  parseStartCountdown,
  resolveStartDisplay,
  resolveStartMode,
  startCountdownRemainingMs,
  type StartCountdownAnchor,
} from '@biph/shared';

const T0 = 1_700_000_000_000;

/** 用本机时区构造一个时刻 —— 准点模式跟实现里的解释方式一致,测试不依赖具体时区 */
function local(y: number, mo: number, d: number, h: number, mi: number): number {
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

describe('剩余时间写法', () => {
  it('分:秒', () => {
    expect(parseStartCountdown('15:00')).toBe(15 * 60_000);
    expect(parseStartCountdown('15:30')).toBe(15 * 60_000 + 30_000);
    expect(parseStartCountdown('0:45')).toBe(45_000);
    expect(parseStartCountdown('1:05')).toBe(65_000);
  });

  it('只写数字 → 按分钟算(现场少打一个冒号)', () => {
    expect(parseStartCountdown('15')).toBe(15 * 60_000);
    expect(parseStartCountdown('0')).toBeNull();
  });

  it('前后空白照样认', () => {
    expect(parseStartCountdown('  15:00  ')).toBe(15 * 60_000);
  });

  it('秒数不能超过 59("15:75" 会算成 16 分 15 秒,那是错的)', () => {
    expect(parseStartCountdown('15:75')).toBeNull();
    expect(parseStartCountdown('15:60')).toBeNull();
  });

  it('根本不是个时间 → null', () => {
    expect(parseStartCountdown('')).toBeNull();
    expect(parseStartCountdown('   ')).toBeNull();
    expect(parseStartCountdown('abc')).toBeNull();
    expect(parseStartCountdown('15:00:00')).toBeNull();
    expect(parseStartCountdown('-5')).toBeNull();
    expect(parseStartCountdown(null)).toBeNull();
    expect(parseStartCountdown(undefined)).toBeNull();
  });

  it('上限 24 小时', () => {
    expect(parseStartCountdown('1440')).toBe(MAX_START_COUNTDOWN_MS);
    expect(parseStartCountdown('1441')).toBeNull();
  });

  it('毫秒 → 输入框里的写法', () => {
    expect(formatStartCountdownInput(15 * 60_000)).toBe('15:00');
    expect(formatStartCountdownInput(45_000)).toBe('0:45');
    expect(formatStartCountdownInput(93 * 60_000 + 30_000)).toBe('93:30');
    expect(formatStartCountdownInput(-5)).toBe('0:00');
  });

  it('写进去再读出来,值不变', () => {
    for (const text of ['15:00', '0:45', '90:00', '1:01']) {
      const ms = parseStartCountdown(text);
      expect(ms).not.toBeNull();
      expect(parseStartCountdown(formatStartCountdownInput(ms as number))).toBe(ms);
    }
  });
});

describe('开赛模式判定', () => {
  it('显式写了模式就按写的来', () => {
    expect(resolveStartMode({ startMode: 'scheduled' })).toBe('scheduled');
    expect(resolveStartMode({ startMode: 'countdown' })).toBe('countdown');
  });

  it('老库没有 startMode:有倒计时锚点就是倒计时模式', () => {
    const anchor: StartCountdownAnchor = { durationMs: 900_000, anchorServerTs: T0 };
    expect(resolveStartMode({ startCountdown: anchor })).toBe('countdown');
  });

  it('什么都没有 → 准点模式(保持老行为)', () => {
    expect(resolveStartMode({})).toBe('scheduled');
    expect(resolveStartMode({ startMode: null, startTime: '19:00' })).toBe('scheduled');
    expect(resolveStartMode({ startCountdown: null })).toBe('scheduled');
  });

  it('只认这两个模式', () => {
    expect(isValidStartMode('scheduled')).toBe(true);
    expect(isValidStartMode('countdown')).toBe(true);
    expect(isValidStartMode('later')).toBe(false);
    expect(isValidStartMode(null)).toBe(false);
    expect(isValidStartMode(1900)).toBe(false);
  });

  it('形状不对的锚点不算数', () => {
    expect(isValidStartCountdownAnchor({ durationMs: 900_000, anchorServerTs: T0 })).toBe(true);
    expect(isValidStartCountdownAnchor({ durationMs: 0, anchorServerTs: T0 })).toBe(false);
    expect(isValidStartCountdownAnchor({ durationMs: -1, anchorServerTs: T0 })).toBe(false);
    expect(isValidStartCountdownAnchor({ durationMs: 900_000 })).toBe(false);
    expect(isValidStartCountdownAnchor({ durationMs: 900_000, anchorServerTs: 0 })).toBe(false);
    expect(isValidStartCountdownAnchor(null)).toBe(false);
  });
});

describe('倒计时剩余', () => {
  const anchor: StartCountdownAnchor = { durationMs: 900_000, anchorServerTs: T0 };

  it('刚起算就是全部时长', () => {
    expect(startCountdownRemainingMs(anchor, T0)).toBe(900_000);
  });

  it('走过多少就少多少', () => {
    expect(startCountdownRemainingMs(anchor, T0 + 60_000)).toBe(840_000);
    expect(startCountdownRemainingMs(anchor, T0 + 899_000)).toBe(1_000);
  });

  it('归零之后是 0,不是负数', () => {
    expect(startCountdownRemainingMs(anchor, T0 + 900_000)).toBe(0);
    expect(startCountdownRemainingMs(anchor, T0 + 1_200_000)).toBe(0);
  });

  it('没有锚点 → 0', () => {
    expect(startCountdownRemainingMs(null, T0)).toBe(0);
    expect(startCountdownRemainingMs(undefined, T0)).toBe(0);
  });
});

describe('大屏该显示什么', () => {
  const clocks = (wallMs: number, serverMs = wallMs) => ({ wallMs, serverMs });

  it('准点模式:开赛前 3 分钟才出现', () => {
    const start = local(2026, 10, 22, 19, 0);
    const m = { status: 'scheduled' as const, startTime: '19:00' };
    const near = resolveStartDisplay(m, clocks(start - 150_000));
    expect(near.kind).toBe('countdown');
    expect(near).toMatchObject({ mode: 'scheduled', remainingMs: 150_000 });
    // 早于 3 分钟:不打扰(赛程表上还有别的场次)
    expect(resolveStartDisplay(m, clocks(start - 200_000)).kind).toBe('none');
  });

  it('准点模式:到点后倒计时消失(下一次是明天)', () => {
    const start = local(2026, 10, 22, 19, 0);
    const m = { status: 'scheduled' as const, startTime: '19:00' };
    expect(resolveStartDisplay(m, clocks(start)).kind).toBe('none');
  });

  it('倒计时模式:从设定那一刻就一直显示,不卡 3 分钟窗口', () => {
    const anchor: StartCountdownAnchor = { durationMs: 900_000, anchorServerTs: T0 };
    const m = { status: 'scheduled' as const, startMode: 'countdown' as const, startCountdown: anchor };
    const d = resolveStartDisplay(m, { wallMs: T0, serverMs: T0 });
    expect(d.kind).toBe('countdown');
    expect(d).toMatchObject({ mode: 'countdown', remainingMs: 900_000 });
  });

  it('倒计时模式:归零后仍然留着(显示 00:00 +「开赛」)', () => {
    const anchor: StartCountdownAnchor = { durationMs: 900_000, anchorServerTs: T0 };
    const m = { status: 'scheduled' as const, startMode: 'countdown' as const, startCountdown: anchor };
    const d = resolveStartDisplay(m, { wallMs: T0, serverMs: T0 + 900_000 });
    expect(d.kind).toBe('countdown');
    expect(d).toMatchObject({ mode: 'countdown', remainingMs: 0 });
  });

  it('倒计时模式:没设倒计时就没有倒计时', () => {
    const m = { status: 'scheduled' as const, startMode: 'countdown' as const };
    expect(resolveStartDisplay(m, clocks(T0)).kind).toBe('none');
  });

  it('比赛一开始(或结束)就不再显示"距开赛"', () => {
    const anchor: StartCountdownAnchor = { durationMs: 900_000, anchorServerTs: T0 };
    const live = { status: 'live' as const, startMode: 'countdown' as const, startCountdown: anchor };
    expect(resolveStartDisplay(live, clocks(T0)).kind).toBe('none');
    const done = { status: 'finished' as const, startMode: 'countdown' as const, startCountdown: anchor };
    expect(resolveStartDisplay(done, clocks(T0)).kind).toBe('none');
  });

  it('准点模式用的是墙钟,倒计时模式用的是服务器时间', () => {
    // 墙上钟和服务器时间差 1 小时:准点模式看墙钟,倒计时模式看服务器时间
    const start = local(2026, 10, 22, 19, 0);
    const scheduled = resolveStartDisplay(
      { status: 'scheduled', startTime: '19:00' },
      { wallMs: start - 60_000, serverMs: start - 3_600_000 - 60_000 },
    );
    expect(scheduled).toMatchObject({ kind: 'countdown', remainingMs: 60_000 });

    const anchor: StartCountdownAnchor = { durationMs: 900_000, anchorServerTs: T0 };
    const countdown = resolveStartDisplay(
      { status: 'scheduled', startMode: 'countdown', startCountdown: anchor },
      { wallMs: T0, serverMs: T0 + 60_000 },
    );
    expect(countdown).toMatchObject({ kind: 'countdown', remainingMs: 840_000 });
  });

  it('窗口可以调(给测试与将来别的用途留口子)', () => {
    const start = local(2026, 10, 22, 19, 0);
    const m = { status: 'scheduled' as const, startTime: '19:00' };
    expect(
      resolveStartDisplay(m, clocks(start - 300_000), START_COUNTDOWN_WINDOW_MS).kind,
    ).toBe('none');
    expect(resolveStartDisplay(m, clocks(start - 300_000), 10 * 60_000).kind).toBe('countdown');
  });
});
