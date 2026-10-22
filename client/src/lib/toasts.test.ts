/**
 * 操作提示(toast)文案的单元测试。
 *
 * 锁三件事:
 *   1. 常用操作都能生成提示 —— 不会出现"按了完全没反应"的漏网之鱼;
 *   2. 提示只描述【动作】,不描述动作之后的状态 —— 连点时不会给出过时的比分;
 *   3. 提示文案在两种语言下都拼得出来(占位符不缺、队伍名带对)。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type Match } from '@biph/shared';
import { describeCommand } from './toasts';
import { translate } from '../i18n';

function makeMatch(patch?: Partial<Match>): Match {
  return {
    id: 'm1',
    name: '测试比赛',
    venue: '体育馆',
    court: '1 号场',
    status: 'live',
    sport: 'basketball',
    rules: { ...DEFAULT_RULES },
    home: {
      id: 'h',
      name: '火箭队',
      shortName: '火',
      color: '#ffffff',
      textColor: '#000000',
      logoUrl: null,
      score: 10,
      fouls: 2,
      timeouts: 3,
    },
    away: {
      id: 'a',
      name: '猎鹰队',
      shortName: '猎',
      color: '#000000',
      textColor: '#ffffff',
      logoUrl: null,
      score: 8,
      fouls: 1,
      timeouts: 4,
    },
    clock: {
      running: false,
      remainingMs: 600_000,
      anchorServerTs: 0,
      period: 1,
      periodLabel: 'Q1',
    },
    shotClock: {
      running: false,
      remainingMs: 24_000,
      anchorServerTs: 0,
      period: 1,
      periodLabel: '',
    },
    timeout: { running: false, remainingMs: 0, anchorServerTs: 0, side: null },
    possession: 'home',
    presentation: {
      template: 'simple',
      titleText: '',
      sponsorName: '',
      sponsorText: '',
      soundEnabled: true,
      autoFit: 'fit',
    },
    seq: 1,
    createdAt: 0,
    updatedAt: 0,
    lastEvent: null,
    ...patch,
  };
}

/** 生成提示的最终文案(模拟渲染时 t() 的行为) */
function text(type: Parameters<typeof describeCommand>[0], payload?: unknown, match?: Match | null): string {
  const action = describeCommand(type, payload, match === undefined ? makeMatch() : match);
  if (!action) return '';
  return translate('zh-CN', action.key, action.vars);
}

describe('操作提示文案', () => {
  it('加分/减分带上正确的队伍名和分值', () => {
    expect(text('score.add', { side: 'home', points: 2 })).toBe('火箭队 +2 分');
    expect(text('score.add', { side: 'away', points: 3 })).toBe('猎鹰队 +3 分');
    expect(text('score.sub', { side: 'away', points: 1 })).toBe('猎鹰队 -1 分');
  });

  it('犯规与暂停额度也带队伍名', () => {
    expect(text('foul.add', { side: 'home' })).toBe('火箭队 +1 次犯规');
    expect(text('foul.sub', { side: 'away' })).toBe('猎鹰队 -1 次犯规');
    expect(text('timeout.add', { side: 'home' })).toBe('火箭队 用掉一次暂停');
    expect(text('timeout.request', { side: 'away' })).toBe('猎鹰队 请求暂停,大屏已开始倒计时');
  });

  it('【不写动作之后的状态】—— 连点时比分还没广播回来,提示不能给旧比分', () => {
    // 快照里的比分是 10:8,但提示里绝不能出现"当前 12:8"这种会过时的数字
    const out = text('score.add', { side: 'home', points: 2 });
    expect(out).not.toContain('12');
    expect(out).not.toContain('8');
    expect(out).not.toContain('当前');
  });

  it('节次提示不带具体节号(连点「下一节」时不会弹出过时的节次)', () => {
    expect(text('clock.nextPeriod')).toBe('已进入下一节');
    expect(text('clock.prevPeriod')).toBe('已回到上一节');
  });

  it('启停提示按【按下之前】的状态判断', () => {
    const running = makeMatch({
      clock: { running: true, remainingMs: 500_000, anchorServerTs: 0, period: 1, periodLabel: 'Q1' },
    });
    expect(text('clock.toggle', {}, running)).toBe('比赛钟已暂停');
    expect(text('clock.toggle', {}, makeMatch())).toBe('比赛钟已开始');

    const shotRunning = makeMatch({
      shotClock: { running: true, remainingMs: 20_000, anchorServerTs: 0, period: 1, periodLabel: '' },
    });
    expect(text('shot.toggle', {}, shotRunning)).toBe('进攻钟已暂停');
    expect(text('shot.toggle', {}, makeMatch())).toBe('进攻钟已开始');
  });

  it('加减时间带正负号', () => {
    expect(text('clock.adjust', { deltaMs: 30_000 })).toBe('比赛钟 +30 秒');
    expect(text('clock.adjust', { deltaMs: -10_000 })).toBe('比赛钟 -10 秒');
    expect(text('shot.adjust', { deltaMs: -5_000 })).toBe('进攻钟 -5 秒');
  });

  it('进攻权为空时说"无"', () => {
    expect(text('possession.set', { side: 'home' })).toBe('进攻权:火箭队');
    expect(text('possession.set', { side: null })).toBe('进攻权:无');
  });

  it('配置类命令不弹提示(切语言不该刷屏)', () => {
    expect(describeCommand('match.update', { patch: { presentation: { locale: 'en-US' } } }, makeMatch())).toBeNull();
  });

  it('英文表同样拼得出来', () => {
    const action = describeCommand('score.add', { side: 'home', points: 2 }, makeMatch());
    expect(action).not.toBeNull();
    expect(translate('en-US', action!.key, action!.vars)).toBe('火箭队 +2');
  });

  it('没有比赛快照时也不会崩(退回空队伍名)', () => {
    expect(() => text('score.add', { side: 'home', points: 1 }, null)).not.toThrow();
    expect(text('score.add', { side: 'home', points: 1 }, null)).toBe(' +1 分');
  });
});
