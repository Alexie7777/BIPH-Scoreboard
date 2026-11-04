/**
 * 「总决赛」大屏模板的渲染测试。
 *
 * 这套模板和前三套最大的不同是**版面结构**:
 * 比分在中间、队名退到两侧、时钟单独一个框。
 * 结构一变,最怕的就是"改着改着跑回老样子",所以把结构本身钉死:
 *
 *   1. 比分数字必须画在【中间】的两个框里(不是两侧);
 *   2. 队名必须在两侧;
 *   3. 底栏必须带上犯规与暂停;
 *   4. 插画素材必须真的存在(组件引用了不存在的图 = 大屏上一片空白);
 *   5. 赛事名不是以 BIBA 开头时,不能硬塞别家联赛的笔刷字。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES, TEMPLATE_IDS, type Match } from '@biph/shared';
import { I18nProvider } from '../i18n';
import { BibaBoard } from './BibaBoard';
import type { BoardProps } from './boardData';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '../../public');

function makeMatch(patch: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    name: 'BIBA 总决赛',
    venue: '',
    court: '1 号场',
    startTime: null,
    status: 'live',
    sport: 'basketball',
    rules: { ...DEFAULT_RULES },
    home: {
      id: 'h',
      name: 'THRESHERS',
      shortName: 'THR',
      color: '#2ea3ff',
      textColor: '#ffffff',
      logoUrl: null,
      score: 58,
      fouls: 3,
      timeouts: 2,
    },
    away: {
      id: 'a',
      name: 'ORCAS',
      shortName: 'ORC',
      color: '#ffc400',
      textColor: '#000000',
      logoUrl: null,
      score: 55,
      fouls: 2,
      timeouts: 1,
    },
    clock: { running: true, remainingMs: 768_000, anchorServerTs: 0, period: 1, periodLabel: 'Q1' },
    shotClock: { running: false, remainingMs: 24_000, anchorServerTs: 0, period: 1, periodLabel: '' },
    timeout: { running: false, remainingMs: 0, anchorServerTs: 0, side: null },
    possession: 'home',
    presentation: {
      template: 'biba',
      titleText: 'BIBA FINALS 2026',
      sponsorName: 'BIPH',
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

function render(match: Match, props: Partial<BoardProps> = {}): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <BibaBoard
        match={match}
        clockRemainingMs={768_000}
        shotRemainingMs={24_000}
        timeoutRemainingMs={0}
        startRemainingMs={0}
        startVisible={false}
        startMode="scheduled"
        offline={false}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('总决赛大屏模板', () => {
  it('模板 id 已经登记进 shared(配置页才选得到)', () => {
    expect(TEMPLATE_IDS).toContain('biba');
  });

  it('中央竖排三件套都在:赛事 logo / 钟框 / 比分框', () => {
    const html = render(makeMatch());
    expect(html).toContain('class="biba-logo"');
    expect(html).toContain('biba-clock-row');
    expect(html).toContain('biba-scores');
  });

  it('比分画在【中间】的框里,不在两侧', () => {
    const html = render(makeMatch());
    // 两个比分数字各一个,且都在 biba-scores 容器里
    expect(html).toContain('biba-score-num');
    const scores = html.slice(html.indexOf('biba-scores'), html.indexOf('biba-team--away'));
    expect(scores).toContain('>58<');
    expect(scores).toContain('>55<');
  });

  it('队名在两侧,主队蓝、客队金', () => {
    const html = render(makeMatch());
    expect(html).toContain('biba-team--home');
    expect(html).toContain('biba-team--away');
    expect(html).toContain('THRESHERS');
    expect(html).toContain('ORCAS');
    // 主客两侧各有一条队色横条
    expect(html.match(/biba-team-bar/g)?.length).toBe(2);
  });

  it('底栏带上犯规与暂停', () => {
    const html = render(makeMatch());
    expect(html).toContain('biba-bottom');
    expect(html).toContain('biba-stat-name');
    // 主队犯规 3、客队犯规 2
    expect(html).toContain('>3<');
    expect(html).toContain('>2<');
    // 暂停剩余 2/4 —— 中间隔着标签,所以拆开断言
    expect(html).toContain('biba-stat-dim');
    expect(html).toContain('>/4<');
  });

  it('本场不用进攻钟时:进攻钟那一块整个不出现', () => {
    const m = makeMatch();
    m.rules = { ...m.rules, useShotClock: false };
    const html = render(m);
    expect(html).not.toContain('biba-shot');
  });

  it('本场用进攻钟时:进攻钟出现在主钟框里', () => {
    const m = makeMatch();
    m.rules = { ...m.rules, useShotClock: true };
    const html = render(m, { shotRemainingMs: 18_000 });
    expect(html).toContain('biba-shot');
  });

  it('赛事名以 BIBA 开头:出笔刷字素材,其余文字实时显示', () => {
    const html = render(makeMatch());
    expect(html).toContain('/biba-wordmark.png');
    expect(html).toContain('FINALS');
    expect(html).toContain('2026');
  });

  it('赛事名不是 BIBA 开头:不硬塞别家联赛的笔刷字', () => {
    const m = makeMatch();
    m.presentation = { ...m.presentation, titleText: '校内联赛总决赛' };
    const html = render(m);
    expect(html).not.toContain('/biba-wordmark.png');
    expect(html).toContain('校内联赛总决赛');
  });

  it('插画素材真的在 public 里(引用了不存在的图 = 大屏一片空白)', () => {
    for (const f of [
      'biba-art-left.jpg',
      'biba-art-right.jpg',
      'biba-crown.png',
      'biba-wordmark.png',
    ]) {
      expect(existsSync(path.join(PUBLIC, f)), `缺少素材 ${f}`).toBe(true);
    }
  });

  it('样式表里有对应的类名(组件与样式不能脱节)', () => {
    const css = readFileSync(path.join(HERE, '../styles/biba.css'), 'utf8');
    for (const cls of [
      '.tpl-biba',
      '.biba-logo',
      '.biba-clock-row',
      '.biba-score-num',
      '.biba-team-bar',
      '.biba-bottom',
      '.biba-art',
    ]) {
      expect(css).toContain(cls);
    }
  });
});
