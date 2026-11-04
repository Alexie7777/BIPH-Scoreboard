/**
 * 「本场不使用进攻钟」的行为约束。
 *
 * 背景:校赛不打 24 秒时,计分员会在配置页取消勾选「使用进攻钟」。
 * 早先服务端**完全不看这个标志位**,于是:
 *   ① 取消勾选之后,进攻钟的锚点照旧在跑;
 *   ② 再按一次「开始比赛」,进攻钟照样被带起来(满 24 秒);
 *   ③ 归零后被服务端判成「24 秒违例」→ 停比赛钟 + 大屏整屏红闪长鸣。
 * 现场看到的现象就是"明明把进攻钟关了,还是响了一声违例"。
 *
 * 这一组把正确的行为钉死:
 *   - 取消勾选 → 进攻钟立刻停住;
 *   - 取消勾选 → 任何路径都不会再把它带起来,也不会判违例;
 *   - 取消勾选 → 进攻钟的命令一律被拒(服务端自己的判断,不靠界面藏按钮);
 *   - 重新勾选 → 进攻钟能正常用(满表起步)。
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch, rejectReason } from '../src/match.js';
import { shotClockEnabled } from '@biph/shared';

const T0 = 1_700_000_000_000;

function freshMatch(rules: Record<string, unknown> = {}) {
  return createMatch(
    { name: '校赛A场', homeName: '猛虎队', awayName: '飞鹰队', rules },
    T0,
    'test-match',
  );
}

/** 关掉进攻钟 */
function turnOff(m: ReturnType<typeof freshMatch>) {
  return applyCommand(m, 'match.update', { patch: { rules: { useShotClock: false } } }, T0).match;
}

describe('进攻钟是否启用:判定口径', () => {
  it('缺这个字段的老数据按"用"处理(宁可多显示一个表,也不能看不见却还在判罚)', () => {
    expect(shotClockEnabled({ rules: {} })).toBe(true);
    expect(shotClockEnabled({ rules: { useShotClock: undefined } })).toBe(true);
    expect(shotClockEnabled({ rules: { useShotClock: true } })).toBe(true);
    expect(shotClockEnabled({ rules: { useShotClock: false } })).toBe(false);
  });
});

describe('取消勾选「使用进攻钟」', () => {
  it('进攻钟立刻停住,不再往下倒数', () => {
    let m = freshMatch();
    // 开球:比赛钟与进攻钟一起走
    m = applyCommand(m, 'clock.start', {}, T0).match;
    expect(m.shotClock.running).toBe(true);

    // 过了 3 秒再关掉
    m = turnOff(applyCommand(m, 'clock.adjust', { deltaMs: 0 }, T0 + 3000).match);
    expect(m.rules.useShotClock).toBe(false);
    expect(m.shotClock.running).toBe(false);
    // 停住时保留剩余值,不算成 0(重新勾选回来还能接着用)
    expect(m.shotClock.remainingMs).toBeGreaterThan(0);
  });

  it('关掉之后再按「开始比赛」,进攻钟不会被带起来', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = turnOff(m);
    expect(m.shotClock.running).toBe(false);

    // 暂停 → 再开始
    m = applyCommand(m, 'clock.pause', {}, T0 + 1000).match;
    m = applyCommand(m, 'clock.toggle', {}, T0 + 2000).match;
    expect(m.clock.running).toBe(true);
    // 关键断言:进攻钟没有起来
    expect(m.shotClock.running).toBe(false);
  });

  it('关掉之后按「重置」,不去动进攻钟的锚点', () => {
    // 校赛场景:进攻钟秒数常常顺手改成 0。
    // 复位进攻钟用的是规则里的 shotClockSeconds,复位出来的锚点 remainingMs=0
    // —— 服务端的归零检测会误以为"进攻钟刚归零",凭空判一次违例。
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = turnOff(m);
    const before = m.shotClock;

    m = applyCommand(m, 'clock.reset', {}, T0 + 1000).match;
    expect(m.shotClock.remainingMs).toBe(before.remainingMs);
    expect(m.shotClock.running).toBe(false);
  });

  it('关掉之后换节,也不去动进攻钟的锚点', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = turnOff(m);
    const before = m.shotClock;

    m = applyCommand(m, 'clock.nextPeriod', {}, T0 + 1000).match;
    expect(m.shotClock.remainingMs).toBe(before.remainingMs);
    expect(m.shotClock.running).toBe(false);
  });

  it('关掉之后,进攻钟的命令一律被拒', () => {
    const m = turnOff(freshMatch());
    for (const type of [
      'shot.start',
      'shot.pause',
      'shot.toggle',
      'shot.adjust',
      'shot.set',
      'shot.reset',
      'shot.violation',
    ] as const) {
      expect(rejectReason(m, type, {}, T0)).toBe('本场不使用进攻钟');
    }
  });

  it('没关掉时,进攻钟的命令照常放行', () => {
    const m = freshMatch();
    expect(rejectReason(m, 'shot.start', {}, T0)).toBeNull();
    expect(rejectReason(m, 'shot.reset', { start: true }, T0)).toBeNull();
  });
});

describe('重新勾选「使用进攻钟」', () => {
  it('进攻钟恢复正常:按「开始比赛」满 24 秒起步', () => {
    let m = freshMatch();
    m = applyCommand(m, 'clock.start', {}, T0).match;
    m = turnOff(m);
    m = applyCommand(m, 'clock.pause', {}, T0 + 1000).match;

    // 重新勾选回来
    m = applyCommand(
      m,
      'match.update',
      { patch: { rules: { useShotClock: true } } },
      T0 + 2000,
    ).match;
    expect(m.rules.useShotClock).toBe(true);

    // 再按「开始比赛」→ 进攻钟满表起步
    m = applyCommand(m, 'clock.toggle', {}, T0 + 3000).match;
    expect(m.shotClock.running).toBe(true);
    expect(m.shotClock.remainingMs).toBe(24_000);
  });
});
