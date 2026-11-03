/**
 * 运动项目注册表的单元测试。
 *
 * 重点是:老数据(没有 sport 字段)与非法值都不能让卡片上的 emoji 变成空白 ——
 * 一律按篮球兜底。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SPORT, normalizeSport, sportEmoji, sportLabel } from './sports';

describe('运动项目', () => {
  it('篮球与足球都在注册表里', () => {
    expect(DEFAULT_SPORT).toBe('basketball');
    expect(sportEmoji('basketball')).toBe('🏀');
    expect(sportEmoji('football')).toBe('⚽');
  });

  it('老数据没有 sport 字段时按篮球兜底', () => {
    expect(normalizeSport(undefined)).toBe('basketball');
    expect(sportEmoji(undefined)).toBe('🏀');
  });

  it('不认识的值也按篮球兜底,不会变空白', () => {
    // 'volleyball' 是还没做的项目 —— 它得按篮球兜底,不能变空白
    expect(normalizeSport('volleyball')).toBe('basketball');
    expect(normalizeSport('')).toBe('basketball');
    expect(normalizeSport(null)).toBe('basketball');
    expect(sportEmoji('volleyball')).toBe('🏀');
  });

  it('足球能原样认出来,不被兜底掉', () => {
    expect(normalizeSport('football')).toBe('football');
  });

  it('名称按语言取', () => {
    expect(sportLabel('basketball', 'zh-CN')).toBe('篮球');
    expect(sportLabel('basketball', 'en-US')).toBe('Basketball');
    expect(sportLabel('football', 'zh-CN')).toBe('足球');
    expect(sportLabel('football', 'en-US')).toBe('Football');
  });
});
