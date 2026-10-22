/**
 * 大屏模板(BoardCore)的渲染测试。
 *
 * 重点锁两件容易悄悄坏掉的事:
 *   1. **队徽要真的画出来** —— 队徽是配置页上传的,以前只改了配置页的草稿,
 *      大屏模板压根没渲染它,于是"上传了 logo 但大屏不显示"。
 *   2. 三套模板(simple / led / broadcast)共用这一套 DOM ——
 *      队徽在这一层加,三套模板就都有。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES, type Match } from '@biph/shared';
import { I18nProvider } from '../i18n';
import { BoardCore } from './BoardCore';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function makeMatch(patch: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    name: '校赛A场',
    venue: '',
    court: '1 号场',
    startTime: null,
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
    clock: { running: true, remainingMs: 600_000, anchorServerTs: 0, period: 1, periodLabel: 'Q1' },
    shotClock: { running: false, remainingMs: 24_000, anchorServerTs: 0, period: 1, periodLabel: '' },
    timeout: { running: false, remainingMs: 0, anchorServerTs: 0, side: null },
    possession: 'home',
    presentation: {
      template: 'simple',
      titleText: '',
      sponsorName: '',
      sponsorText: '',
      soundEnabled: true,
      autoFit: 'fit',
      locale: null,
    },
    seq: 1,
    createdAt: 0,
    updatedAt: 0,
    lastEvent: null,
    ...patch,
  };
}

function render(match: Match): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <BoardCore
        match={match}
        clockRemainingMs={600_000}
        shotRemainingMs={24_000}
        timeoutRemainingMs={0}
        startRemainingMs={0}
        offline={false}
        accent="#ffb020"
      />
    </I18nProvider>,
  );
}

describe('大屏模板', () => {
  it('有队徽时:主客两队的 logo 都画出来', () => {
    const m = makeMatch();
    m.home.logoUrl = '/uploads/home.png';
    m.away.logoUrl = '/uploads/away.png';
    const html = render(m);
    expect(html).toContain('src="/uploads/home.png"');
    expect(html).toContain('src="/uploads/away.png"');
    expect(html).toContain('class="t-logo"');
  });

  it('没有队徽时:不画空的 logo 框', () => {
    const html = render(makeMatch());
    expect(html).not.toContain('class="t-logo"');
  });

  it('队名照常显示(加队徽不能把队名挤没了)', () => {
    const m = makeMatch();
    m.home.logoUrl = '/uploads/home.png';
    const html = render(m);
    expect(html).toContain('火箭队');
    expect(html).toContain('猎鹰队');
  });

  it('样式表里确实有队徽的类名(组件与样式不能脱节)', () => {
    const css = readFileSync(path.join(HERE, '../styles/global.css'), 'utf8');
    expect(css).toContain('.board-team .t-logo');
    expect(css).toContain('.board-team .t-name-text');
  });

  it('客队队徽排在队名右边,和主队左右对称', () => {
    const m = makeMatch();
    m.home.logoUrl = '/uploads/home.png';
    m.away.logoUrl = '/uploads/away.png';
    const html = render(m);
    // 客队那一块带 away 修饰类,样式表据此镜像
    expect(html).toContain('board-team board-team--away');
    const css = readFileSync(path.join(HERE, '../styles/global.css'), 'utf8');
    expect(css).toContain('.board-team--away .t-name');
    expect(css).toMatch(/\.board-team--away \.t-name \{[^}]*row-reverse/);
  });
});
