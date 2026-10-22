/**
 * i18n 核心的单元测试。
 *
 * 重点锁两件容易悄悄坏掉的事:
 *   1. 两个词典的键必须完全一致(漏一个键 → 切到英文时那里变空白);
 *   2. 语言的解析优先级(URL > 临时覆盖 > 比赛设置 > 本机偏好),
 *      这是"大屏和 iPad 一起切"能成立的前提。
 */
import { describe, expect, it } from 'vitest';
import { enUS, zhCN, type MessageKey } from './dict';
import {
  effectiveLocale,
  formatClockTime,
  isLocaleLockedByUrl,
  readUrlLocale,
  setLocale,
  setScopedLocale,
  setVenueLocale,
  translate,
  translateServerError,
  withLangParam,
} from './core';

describe('词典', () => {
  it('中英文的键完全一致', () => {
    const zh = Object.keys(zhCN).sort();
    const en = Object.keys(enUS).sort();
    expect(en).toEqual(zh);
  });

  it('英文表没有空文案(漏翻会在这里暴露)', () => {
    const empty = Object.entries(enUS).filter(([, v]) => !v || !v.trim());
    expect(empty.map(([k]) => k)).toEqual([]);
  });

  it('占位符在两种语言里成对出现', () => {
    const varsOf = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    const mismatched: string[] = [];
    for (const key of Object.keys(zhCN) as MessageKey[]) {
      const a = varsOf(zhCN[key]);
      const b = varsOf(enUS[key]);
      if (a.join() !== b.join()) mismatched.push(key);
    }
    expect(mismatched).toEqual([]);
  });
});

describe('翻译', () => {
  it('按语言取文案', () => {
    expect(translate('zh-CN', 'team.fouls')).toBe('犯规');
    expect(translate('en-US', 'team.fouls')).toBe('Fouls');
  });

  it('标签页标题与 Dashboard 标题同源(app.title)', () => {
    // 浏览器标签页的 document.title 与 Dashboard 左上角标题都取这一个键,
    // 天然一致;切语言时两边一起变。
    expect(translate('zh-CN', 'app.title')).toBe('BIPH 场地管理台');
    expect(translate('en-US', 'app.title')).toBe('BIPH Venue Dashboard');
  });

  it('替换占位符', () => {
    expect(translate('zh-CN', 'team.timeout.remain', { n: 2, m: 4 })).toBe('剩余 2 次,共 4 次');
    expect(translate('en-US', 'team.timeout.remain', { n: 2, m: 4 })).toBe('2 of 4 left');
  });

  it('服务端错误:认得出来的翻,认不出来的原样返回', () => {
    expect(translateServerError('en-US', '比赛不存在')).toBe('Match not found');
    expect(translateServerError('zh-CN', '比赛不存在')).toBe('比赛不存在');
    expect(translateServerError('en-US', '某个没收录的新错误')).toBe('某个没收录的新错误');
  });
});

describe('语言解析', () => {
  it('URL 参数认得出 zh/en 与全称', () => {
    expect(readUrlLocale('?lang=zh')).toBe('zh-CN');
    expect(readUrlLocale('?lang=en')).toBe('en-US');
    expect(readUrlLocale('?lang=en-US')).toBe('en-US');
    expect(readUrlLocale('?t=abc')).toBeNull();
    expect(readUrlLocale('?lang=jp')).toBeNull();
  });

  it('链接能拼上语言参数', () => {
    expect(withLangParam('http://x/m/1/display', 'en-US')).toBe('http://x/m/1/display?lang=en');
    expect(withLangParam('http://x/m/1/display?t=k', 'zh-CN')).toBe('http://x/m/1/display?t=k&lang=zh');
    expect(withLangParam('http://x/m/1/display', null)).toBe('http://x/m/1/display');
  });

  it('比赛设置优先于本机偏好 —— 现场要整场一起切', () => {
    setLocale('zh-CN');
    setScopedLocale('en-US');
    expect(effectiveLocale()).toBe('en-US');
    // 比赛设置一变,本机的临时覆盖就作废,回到"跟随本场"
    setScopedLocale(null);
    expect(effectiveLocale()).toBe('zh-CN');
  });
});

describe('时钟格式', () => {
  it('固定 HH:MM:SS,不随系统/语言变化', () => {
    expect(formatClockTime(0)).toBe('--:--:--');
    expect(formatClockTime(new Date(2026, 0, 1, 9, 5, 7).getTime())).toBe('09:05:07');
  });
});

/*
 * 场馆语言:管理台(场地清单)与控制台(本场)必须永远是同一个语言。
 *
 * 以前语言只存在"本场"里,管理台只能按自己的本机偏好显示 ——
 * 于是会出现"管理台中文、控制台英文",现场看着像坏了。
 * 现在语言以场馆为准,服务端把它镜像到每场比赛。
 */
describe('场馆语言', () => {
  it('场馆语言优先于本机偏好', () => {
    setVenueLocale('en-US');
    expect(effectiveLocale()).toBe('en-US');
    setVenueLocale(null);
  });

  it('本场设置优先于场馆语言(两者由服务端保证一致)', () => {
    setVenueLocale('en-US');
    setScopedLocale('zh-CN');
    expect(effectiveLocale()).toBe('zh-CN');
    setScopedLocale(null);
    setVenueLocale(null);
  });

  it('用户刚点切换:立刻生效,不等服务端回包', () => {
    setScopedLocale('zh-CN');
    setLocale('en-US');
    expect(effectiveLocale()).toBe('en-US');
    setScopedLocale(null);
  });

  it('服务端把语言改回来时,本地临时覆盖作废(不能一直压着服务端)', () => {
    setLocale('en-US');
    setVenueLocale('zh-CN');
    expect(effectiveLocale()).toBe('zh-CN');
    setVenueLocale(null);
  });

  it('?lang= 不再锁死切换按钮(大屏必须能跟着控制台切)', () => {
    expect(isLocaleLockedByUrl()).toBe(false);
  });
});
