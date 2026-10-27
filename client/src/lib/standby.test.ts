import { describe, expect, it } from 'vitest';
import { standbyLabel } from './standby';
import { translate } from '../i18n/core';

const zh = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) =>
  translate('zh-CN', key, vars);
const en = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) =>
  translate('en-US', key, vars);

describe('待机屏文案', () => {
  it('配了开赛时间 → 直接写几点开始', () => {
    expect(standbyLabel({ startTime: '19:00' }, zh)).toBe('19:00 开赛');
    expect(standbyLabel({ startTime: '19:00' }, en)).toBe('Tip-off at 19:00');
  });

  it('没配开赛时间 → 退回"即将开始"', () => {
    expect(standbyLabel({ startTime: null }, zh)).toBe('即将开始');
    expect(standbyLabel({}, zh)).toBe('即将开始');
    expect(standbyLabel({ startTime: '' }, zh)).toBe('即将开始');
    expect(standbyLabel(null, zh)).toBe('即将开始');
    expect(standbyLabel(undefined, zh)).toBe('即将开始');
    expect(standbyLabel({ startTime: null }, en)).toBe('Starting soon');
  });

  it('脏数据不当成开赛时间(宁可显示"即将开始",也不显示假时间)', () => {
    expect(standbyLabel({ startTime: '25:00' }, zh)).toBe('即将开始');
    expect(standbyLabel({ startTime: '19:70' }, zh)).toBe('即将开始');
    expect(standbyLabel({ startTime: '19:00:00' }, zh)).toBe('即将开始');
    expect(standbyLabel({ startTime: 'abc' }, zh)).toBe('即将开始');
  });

  it('前后空白照样认', () => {
    expect(standbyLabel({ startTime: '  19:00  ' }, zh)).toBe('19:00 开赛');
  });

  it('配了时间就不再出现"即将开始"', () => {
    expect(standbyLabel({ startTime: '19:00' }, zh)).not.toContain('即将开始');
    expect(standbyLabel({ startTime: '19:00' }, en)).not.toContain('Starting soon');
  });

  it('倒计时模式不写"几点开赛"(没有准点时间可写)', () => {
    // 倒计时模式下大屏整屏都是倒计时,待机屏只在没设倒计时时露出来
    expect(standbyLabel({ startMode: 'countdown', startTime: '19:00' }, zh)).toBe('即将开始');
    expect(standbyLabel({ startMode: 'countdown', startTime: '19:00' }, en)).toBe('Starting soon');
  });
});
