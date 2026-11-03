/**
 * 足球面板(补时 + 半场/中场)的渲染测试。
 *
 * 锁三件容易悄悄坏掉的事:
 *   1. **阶段决定按钮**:上半场能"结束上半场",中场能"结束中场",
 *      下半场只留"回到上半场"这个退路 —— 三个阶段不能串。
 *   2. **没设补时的时候不能开表**:按钮必须置灰,不然按了没反应。
 *   3. 中场倒计时归零之后画面留着,等计分员按「结束中场」——
 *      绝不自动开始下半场。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { I18nProvider } from '../i18n';
import { FootballPanel, type FootballPanelProps } from './FootballPanel';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function render(props: Partial<FootballPanelProps> = {}): string {
  const all: FootballPanelProps = {
    phase: 'first',
    addedTimeMs: 0,
    addedTimeRunning: false,
    addedTimeDurationMs: 0,
    halftimeMs: 0,
    halftimeRunning: false,
    halftimeMinutes: 15,
    onHalfEnd: () => {},
    onAddedTimeSet: () => {},
    onAddedTimeToggle: () => {},
    onHalftimeStart: () => {},
    onHalftimeToggle: () => {},
    onHalftimeEnd: () => {},
    onBackToFirstHalf: () => {},
    ...props,
  };
  return renderToStaticMarkup(
    <I18nProvider>
      <FootballPanel {...all} />
    </I18nProvider>,
  );
}

describe('足球面板', () => {
  it('上半场:有「结束上半场」与「开始中场休息」', () => {
    const html = render({ phase: 'first' });
    expect(html).toContain('结束上半场');
    expect(html).toContain('开始中场休息 15 分');
    expect(html).toContain('上半场');
  });

  it('中场休息:显示倒计时与「结束中场 · 下半场」,没有「结束上半场」', () => {
    const html = render({ phase: 'halftime', halftimeMs: 900_000, halftimeRunning: true });
    expect(html).toContain('中场休息');
    expect(html).toContain('结束中场 · 下半场');
    expect(html).toContain('aria-label="中场休息 15:00"');
    expect(html).not.toContain('结束上半场');
  });

  it('下半场:不再有「结束上半场」,但留了「回到上半场」的退路', () => {
    const html = render({ phase: 'second' });
    expect(html).not.toContain('结束上半场');
    expect(html).toContain('回到上半场');
    expect(html).toContain('下半场');
  });

  it('没有设补时:开表与清除都是禁用的', () => {
    const html = render({ addedTimeDurationMs: 0 });
    // 两个按钮都带 disabled
    const disabledCount = (html.match(/disabled=""/g) ?? []).length;
    expect(disabledCount).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('added-wrap');
  });

  it('设了补时:显示 + 号与剩余时间', () => {
    const html = render({ addedTimeDurationMs: 240_000, addedTimeMs: 180_000, addedTimeRunning: true });
    expect(html).toContain('fb-sign');
    expect(html).toContain('aria-label="补时 03:00"');
  });

  it('常用补时按钮是 1 / 2 / 4 / 5 分钟', () => {
    const html = render();
    expect(html).toContain('+1');
    expect(html).toContain('+2');
    expect(html).toContain('+4');
    expect(html).toContain('+5');
  });

  it('样式表里有足球面板的类名(组件与样式不能脱节)', () => {
    const css = readFileSync(path.join(HERE, '../styles/global.css'), 'utf8');
    expect(css).toContain('.football-panel');
    expect(css).toContain('.fb-block');
  });
});
