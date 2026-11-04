/**
 * 「总决赛」大屏模板的渲染测试。
 *
 * 这套模板和前三套最大的不同是**版面结构**:
 * 中央竖排(标识 → 对阵行 → 钟框 → 比分框),队名在两侧,
 * 没有顶栏。结构一变,最怕的就是"改着改着跑回老样子",所以把结构本身钉死:
 *
 *   1. 中央五段都在(标识 / 对阵行 / 钟框 / 比分框);
 *   2. 比分数字必须画在【中间】的两个框里(不是两侧);
 *   3. 队名分两层:小字全名 + 大字简称,两边各一块;
 *   4. 底栏必须带上犯规与暂停;
 *   5. 插画素材必须真的存在(组件引用了不存在的图 = 大屏上一片空白)。
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
      name: 'MEGALODONS',
      shortName: 'MEGS',
      color: '#ff45a8',
      textColor: '#ffffff',
      logoUrl: null,
      score: 58,
      fouls: 3,
      timeouts: 2,
    },
    away: {
      id: 'a',
      name: 'ORCAS',
      shortName: 'ORCAS',
      color: '#22d9f0',
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
      titleText: 'BIBA FINALS',
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

  it('中央竖排四段都在:标识 / 对阵行 / 钟框 / 比分框', () => {
    const html = render(makeMatch());
    expect(html).toContain('class="biba-logo"');
    expect(html).toContain('biba-versus');
    expect(html).toContain('biba-clock-row');
    expect(html).toContain('biba-scores');
  });

  it('没有顶栏(赛事名与场馆名都搬到中央那块)', () => {
    const html = render(makeMatch());
    expect(html).not.toContain('biba-header');
    expect(html).toContain('biba-brand');
    expect(html).toContain('biba-event');
  });

  it('赛事名走金色那一行,场馆名走小字那一行', () => {
    const html = render(makeMatch());
    expect(html).toContain('BIBA FINALS');
    expect(html).toContain('BIPH');
  });

  it('对阵行:主队简称 + VS + 客队简称', () => {
    const html = render(makeMatch());
    expect(html).toContain('biba-versus-side--home');
    expect(html).toContain('biba-versus-side--away');
    expect(html).toContain('>vs<');
    expect(html).toContain('MEGS');
    expect(html).toContain('ORCAS');
  });

  it('比分画在【中间】的框里,不在两侧', () => {
    const html = render(makeMatch());
    expect(html).toContain('biba-score-num');
    const scores = html.slice(html.indexOf('biba-scores'), html.indexOf('biba-team--away'));
    expect(scores).toContain('>58<');
    expect(scores).toContain('>55<');
  });

  it('两个比分框中间是冒号', () => {
    const html = render(makeMatch());
    expect(html).toContain('biba-colon');
    // React 渲染空元素是 <i></i>,不是自闭合
    expect(html).toContain('<i></i><i></i>');
  });

  it('队名分两层:小字全名 + 大字简称,两边各一块', () => {
    const html = render(makeMatch());
    expect(html).toContain('biba-team--home');
    expect(html).toContain('biba-team--away');
    expect(html).toContain('biba-team-full');
    expect(html).toContain('biba-team-short');
    // 全名是 MEGALODONS,简称是 MEGS —— 两个都要在
    expect(html).toContain('MEGALODONS');
    expect(html).toContain('MEGS');
    // 两块队名各带一道弧形色带(类名出现两次;渐变 id 不算)
    expect(html.match(/class="biba-swoosh"/g)?.length).toBe(2);
    // 插画下面各一条队色横条
    expect(html.match(/class="biba-team-bar"/g)?.length).toBe(2);
  });

  it('底栏带上犯规与暂停,队名用队色', () => {
    const html = render(makeMatch());
    expect(html).toContain('biba-bottom');
    expect(html).toContain('biba-stat-name');
    expect(html).toContain('>3<');
    expect(html).toContain('>2<');
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

  it('插画素材真的在 public 里(引用了不存在的图 = 大屏一片空白)', () => {
    for (const f of ['biba-art-left.jpg', 'biba-art-right.jpg', 'biba-crown.png']) {
      expect(existsSync(path.join(PUBLIC, f)), `缺少素材 ${f}`).toBe(true);
    }
  });

  it('样式表里有对应的类名(组件与样式不能脱节)', () => {
    const css = readFileSync(path.join(HERE, '../styles/biba.css'), 'utf8');
    for (const cls of [
      '.tpl-biba',
      '.biba-logo',
      '.biba-versus',
      '.biba-clock-row',
      '.biba-score-num',
      '.biba-team-short',
      '.biba-swoosh',
      '.biba-bottom',
      '.biba-art',
    ]) {
      expect(css).toContain(cls);
    }
  });
});
