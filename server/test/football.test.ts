/**
 * 足球的命令归约与规则约束。
 *
 * 足球与篮球最大的差别是"时钟走正数":锚点里存的还是"还剩多少",
 * 但显示值是「本半场时长 − 剩余」(00:00 → 45:00)。
 * 这一层测的是状态机:上半场 → 补时 → 中场 → 下半场。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HALFTIME_MINUTES,
  buildPeriodLabel,
  defaultRulesFor,
  elapsedMs,
  formatAddedTime,
  halftimeDurationMs,
  isValidAddedTimeAnchor,
  isValidHalftimeAnchor,
  resolveFootballPhase,
} from '@biph/shared';
import { applyCommand, createMatch, rejectReason, resetMatch } from '../src/match.js';

const T0 = 1_700_000_000_000;
const HALF = 45 * 60_000;

function football(overrides: Parameters<typeof createMatch>[0] = {}) {
  return createMatch(
    { name: '足球赛', homeName: '蓝队', awayName: '红队', sport: 'football', ...overrides },
    T0,
    'fb-match',
  );
}

function basketball() {
  return createMatch({ name: '篮球赛', homeName: '甲队', awayName: '乙队' }, T0, 'bk-match');
}

/** 把主钟推进到"上半场结束"的状态:45:00 到了、停着 */
function halfOver(m: ReturnType<typeof football>) {
  let r = applyCommand(m, 'clock.start', {}, T0);
  r = applyCommand(r.match, 'half.end', {}, T0 + HALF);
  return r.match;
}

describe('足球的默认规则与标签', () => {
  it('足球默认两半场 45 分钟,没有进攻钟/暂停/犯规', () => {
    const r = defaultRulesFor('football');
    expect(r.periods).toBe(2);
    expect(r.periodMinutes).toBe(45);
    expect(r.useShotClock).toBe(false);
    expect(r.showTeamFouls).toBe(false);
    expect(r.showTimeouts).toBe(false);
    expect(r.showPossession).toBe(false);
    expect(r.halftimeMinutes).toBe(DEFAULT_HALFTIME_MINUTES);
  });

  it('建赛时足球的比赛钟就是 45 分钟(满表停着),标签是 1H', () => {
    const m = football();
    expect(m.sport).toBe('football');
    expect(m.clock.remainingMs).toBe(HALF);
    expect(m.clock.running).toBe(false);
    expect(m.clock.periodLabel).toBe('1H');
  });

  it('节次标签:篮球 Q1/FINAL,足球 1H/2H/HT/FT', () => {
    expect(buildPeriodLabel(1, 4, 'live')).toBe('Q1');
    expect(buildPeriodLabel(4, 4, 'finished')).toBe('FINAL');
    expect(buildPeriodLabel(1, 2, 'live', { sport: 'football' })).toBe('1H');
    expect(buildPeriodLabel(2, 2, 'live', { sport: 'football' })).toBe('2H');
    expect(buildPeriodLabel(1, 2, 'live', { sport: 'football', halftime: true })).toBe('HT');
    expect(buildPeriodLabel(2, 2, 'finished', { sport: 'football' })).toBe('FT');
  });

  it('中场休息时长由规则决定,默认 15 分钟', () => {
    expect(halftimeDurationMs(defaultRulesFor('football'))).toBe(15 * 60_000);
    expect(halftimeDurationMs({ ...defaultRulesFor('football'), halftimeMinutes: 20 })).toBe(20 * 60_000);
  });

  it('脏数据锚点会被挡住', () => {
    expect(isValidAddedTimeAnchor({ running: true, remainingMs: 1000, anchorServerTs: T0, durationMs: 4000 })).toBe(true);
    expect(isValidAddedTimeAnchor({ running: true, remainingMs: -1, anchorServerTs: T0, durationMs: 4000 })).toBe(false);
    expect(isValidHalftimeAnchor({ running: false, remainingMs: 0, anchorServerTs: 0, durationMs: 0 })).toBe(true);
    expect(isValidHalftimeAnchor(null)).toBe(false);
    expect(isValidHalftimeAnchor({ running: 'yes' })).toBe(false);
  });
});

describe('正数时钟', () => {
  it('已用时间 = 本半场时长 − 剩余,并夹在本半场时长之内', () => {
    const m = football();
    // 满表停着 → 已用 00:00
    expect(elapsedMs(m.clock, HALF, T0)).toBe(0);
    // 开表走 10 分钟 → 已用 10:00
    const running = applyCommand(m, 'clock.start', {}, T0).match;
    expect(elapsedMs(running.clock, HALF, T0 + 10 * 60_000)).toBe(10 * 60_000);
    // 表停了之后剩余不再变 → 已用时间不再变
    const paused = applyCommand(running, 'clock.pause', {}, T0 + 10 * 60_000).match;
    expect(elapsedMs(paused.clock, HALF, T0 + 30 * 60_000)).toBe(10 * 60_000);
  });

  it('补时格式化成 +MM:SS', () => {
    expect(formatAddedTime(4 * 60_000)).toBe('+04:00');
    expect(formatAddedTime(90_000)).toBe('+01:30');
    expect(formatAddedTime(0)).toBe('+00:00');
  });
});

describe('上半场结束', () => {
  it('结束上半场:主钟停在 0(显示 45:00)且停着', () => {
    const m = halfOver(football());
    expect(m.clock.remainingMs).toBe(0);
    expect(m.clock.running).toBe(false);
    expect(m.status).toBe('live');
    // 显示值:已用 45:00
    expect(elapsedMs(m.clock, HALF, T0 + HALF)).toBe(HALF);
  });

  it('上半场没结束时不许进中场休息', () => {
    const m = applyCommand(football(), 'clock.start', {}, T0).match;
    expect(rejectReason(m, 'halftime.start', {}, T0)).toBe('上半场还没结束');
  });

  it('下半场再按「结束上半场」会被拒', () => {
    const m = halfOver(football());
    const second = applyCommand(m, 'halftime.start', {}, T0 + HALF).match;
    const done = applyCommand(second, 'halftime.end', {}, T0 + HALF).match;
    expect(rejectReason(done, 'half.end', {}, T0 + HALF)).toBe('已经是下半场');
  });
});

describe('补时', () => {
  it('设补时:锚点记下总时长,start=true 直接开表', () => {
    const m = halfOver(football());
    const set = applyCommand(m, 'addedTime.set', { seconds: 240 }, T0 + HALF).match;
    expect(set.addedTime?.durationMs).toBe(240_000);
    expect(set.addedTime?.remainingMs).toBe(240_000);
    expect(set.addedTime?.running).toBe(false);

    const started = applyCommand(m, 'addedTime.set', { seconds: 240, start: true }, T0 + HALF).match;
    expect(started.addedTime?.running).toBe(true);
  });

  it('主钟还没走完就不许"设补时并开表"', () => {
    const m = applyCommand(football(), 'clock.start', {}, T0).match;
    expect(rejectReason(m, 'addedTime.set', { seconds: 240, start: true }, T0)).toBe('上半场还没结束');
    // 只设不开始是允许的(裁判提前宣布也行)
    expect(rejectReason(m, 'addedTime.set', { seconds: 240 }, T0)).toBeNull();
  });

  it('补时开/停,还没设补时不能说开表', () => {
    const m = halfOver(football());
    expect(rejectReason(m, 'addedTime.toggle', {}, T0 + HALF)).toBe('还没有设补时');

    const set = applyCommand(m, 'addedTime.set', { seconds: 240 }, T0 + HALF).match;
    const on = applyCommand(set, 'addedTime.toggle', {}, T0 + HALF).match;
    expect(on.addedTime?.running).toBe(true);
    const off = applyCommand(on, 'addedTime.toggle', {}, T0 + HALF + 1000).match;
    expect(off.addedTime?.running).toBe(false);
  });

  it('补时 0 表示清除', () => {
    const m = halfOver(football());
    const set = applyCommand(m, 'addedTime.set', { seconds: 240 }, T0 + HALF).match;
    const cleared = applyCommand(set, 'addedTime.set', { seconds: 0 }, T0 + HALF).match;
    expect(cleared.addedTime).toBeNull();
  });

  it('补时超过 30 分钟会被拒', () => {
    const m = halfOver(football());
    expect(rejectReason(m, 'addedTime.set', { seconds: 31 * 60 }, T0 + HALF)).toBe(
      '补时应在 0 到 30 分钟之间',
    );
  });
});

describe('中场休息', () => {
  it('开始中场休息:锚点存在即表示在中场,倒计时开表', () => {
    const m = halfOver(football());
    const ht = applyCommand(m, 'halftime.start', {}, T0 + HALF).match;
    expect(ht.halftime).not.toBeNull();
    expect(ht.halftime?.running).toBe(true);
    expect(ht.halftime?.remainingMs).toBe(15 * 60_000);
    expect(ht.clock.periodLabel).toBe('HT');
    expect(resolveFootballPhase({ period: ht.clock.period, halftime: ht.halftime })).toBe('halftime');
  });

  it('补时还没走完不许进中场', () => {
    const m = halfOver(football());
    const set = applyCommand(m, 'addedTime.set', { seconds: 240, start: true }, T0 + HALF).match;
    expect(rejectReason(set, 'halftime.start', {}, T0 + HALF)).toBe('补时还没结束');
  });

  it('中场倒计时暂停/继续', () => {
    const m = halfOver(football());
    const ht = applyCommand(m, 'halftime.start', {}, T0 + HALF).match;
    const paused = applyCommand(ht, 'halftime.toggle', {}, T0 + HALF + 1000).match;
    expect(paused.halftime?.running).toBe(false);
    const resumed = applyCommand(paused, 'halftime.toggle', {}, T0 + HALF + 2000).match;
    expect(resumed.halftime?.running).toBe(true);
  });

  it('不在中场时按「结束中场休息」会被拒', () => {
    const m = halfOver(football());
    expect(rejectReason(m, 'halftime.end', {}, T0 + HALF)).toBe('当前不在中场休息');
    expect(rejectReason(m, 'halftime.toggle', {}, T0 + HALF)).toBe('当前不在中场休息');
  });

  it('结束中场休息:进入下半场,主钟回到 45:00 停着,标签 2H', () => {
    const m = halfOver(football());
    const ht = applyCommand(m, 'halftime.start', {}, T0 + HALF).match;
    const second = applyCommand(ht, 'halftime.end', {}, T0 + HALF + 60_000).match;
    expect(second.halftime).toBeNull();
    expect(second.clock.period).toBe(2);
    expect(second.clock.remainingMs).toBe(HALF);
    expect(second.clock.running).toBe(false);
    expect(second.clock.periodLabel).toBe('2H');
    expect(resolveFootballPhase({ period: second.clock.period, halftime: second.halftime })).toBe('second');
  });
});

describe('篮球比赛不能用足球命令', () => {
  it('所有足球命令在篮球比赛上都被拒', () => {
    const m = basketball();
    for (const cmd of ['half.end', 'addedTime.set', 'addedTime.toggle', 'halftime.start', 'halftime.toggle', 'halftime.end']) {
      expect(rejectReason(m, cmd as never, { seconds: 240 }, T0)).toBe('本场不是足球比赛');
    }
  });
});

describe('重置与结束', () => {
  it('重置会清掉补时与中场休息', () => {
    const m = halfOver(football());
    const ht = applyCommand(m, 'halftime.start', {}, T0 + HALF).match;
    const r = resetMatch(ht, T0 + HALF);
    expect(r.addedTime).toBeNull();
    expect(r.halftime).toBeNull();
    expect(r.clock.remainingMs).toBe(HALF);
    expect(r.clock.running).toBe(false);
    expect(r.status).toBe('scheduled');
  });

  it('比赛结束会撤下中场休息与补时', () => {
    const m = halfOver(football());
    const ht = applyCommand(m, 'halftime.start', {}, T0 + HALF).match;
    const done = applyCommand(ht, 'match.final', {}, T0 + HALF).match;
    expect(done.halftime).toBeNull();
    expect(done.addedTime).toBeNull();
    expect(done.status).toBe('finished');
    expect(done.clock.periodLabel).toBe('FT');
  });
});

describe('按项目分流', () => {
  it('足球比赛开球不会带动进攻钟', () => {
    const m = applyCommand(football(), 'clock.start', {}, T0).match;
    expect(m.shotClock.running).toBe(false);
    expect(m.clock.running).toBe(true);
  });

  it('篮球比赛开球照旧带动进攻钟(旧行为不变)', () => {
    const m = applyCommand(basketball(), 'clock.start', {}, T0).match;
    expect(m.shotClock.running).toBe(true);
    expect(m.shotClock.remainingMs).toBe(24_000);
  });

  it('足球的「重置」只重置主钟并清掉补时', () => {
    const m = halfOver(football());
    const set = applyCommand(m, 'addedTime.set', { seconds: 240 }, T0 + HALF).match;
    const reset = applyCommand(set, 'clock.reset', {}, T0 + HALF).match;
    expect(reset.clock.remainingMs).toBe(HALF);
    expect(reset.clock.running).toBe(false);
    expect(reset.addedTime).toBeNull();
  });
});
