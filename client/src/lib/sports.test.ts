/**
 * 运动项目注册表的单元测试。
 *
 * 现在只有篮球,所以重点是:老数据(没有 sport 字段)与非法值
 * 都不能让卡片上的 emoji 变成空白 —— 一律按篮球兜底。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SPORT, normalizeSport, sportEmoji, sportLabel } from './sports';

describe('运动项目', () => {
  it('目前只有篮球', () => {
    expect(DEFAULT_SPORT).toBe('basketball');
    expect(sportEmoji('basketball')).toBe('🏀');
  });

  it('老数据没有 sport 字段时按篮球兜底', () => {
    expect(normalizeSport(undefined)).toBe('basketball');
    expect(sportEmoji(undefined)).toBe('🏀');
  });

  it('不认识的值也按篮球兜底,不会变空白', () => {
    expect(normalizeSport('football')).toBe('basketball');
    expect(normalizeSport('')).toBe('basketball');
    expect(normalizeSport(null)).toBe('basketball');
    expect(sportEmoji('football')).toBe('🏀');
  });

  it('名称按语言取', () => {
    expect(sportLabel('basketball', 'zh-CN')).toBe('篮球');
    expect(sportLabel('basketball', 'en-US')).toBe('Basketball');
  });
});
