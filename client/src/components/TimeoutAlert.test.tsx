/**
 * 暂停倒计时警示横幅(TimeoutAlert)的渲染测试。
 *
 * 用 react-dom/server 真正渲染一次 —— 锁住"最终输出到屏幕上的那段标记":
 *   - 横幅类名(样式表靠它区分"红色警示"和"绿色收尾")
 *   - 标志符号(⏱ / ✓)
 *   - 读秒文案与结束文案
 *   - 没有提示时不渲染任何东西
 *
 * 再顺手检查样式表里确实有这些类名 ——
 * 组件改了类名而样式没跟上,是这种"纯前端"改动最容易悄悄坏掉的地方。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { I18nProvider } from '../i18n';
import { TimeoutAlert, type TimeoutAlertData } from './TimeoutAlert';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function render(alert: TimeoutAlertData | null): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <TimeoutAlert alert={alert} />
    </I18nProvider>,
  );
}

describe('暂停倒计时警示横幅', () => {
  it('没有提示时什么都不渲染', () => {
    expect(render(null)).toBe('');
  });

  it('最后 5 秒:红色警示 + 秒表标志 + 读秒文案', () => {
    const html = render({ phase: 'urgent', seconds: 5 });
    expect(html).toContain('class="timeout-alert urgent"');
    expect(html).toContain('⏱');
    expect(html).toContain('暂停倒计时 5 秒后结束');
  });

  it('读秒跟着剩余秒数变', () => {
    expect(render({ phase: 'urgent', seconds: 3 })).toContain('暂停倒计时 3 秒后结束');
  });

  it('倒计时归零:绿色收尾 + 对勾 + 结束文案', () => {
    const html = render({ phase: 'ended', seconds: 0 });
    expect(html).toContain('class="timeout-alert ended"');
    expect(html).toContain('✓');
    expect(html).toContain('暂停时间结束,请准备开赛');
    expect(html).not.toContain('⏱');
  });

  it('给读屏软件播报(aria-live),裁判不看屏也得听得见', () => {
    const html = render({ phase: 'urgent', seconds: 5 });
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
  });

  it('样式表里确实有这些类名(组件与样式不能脱节)', () => {
    const css = readFileSync(path.join(HERE, '../styles/global.css'), 'utf8');
    expect(css).toContain('.timeout-alert');
    expect(css).toContain('.timeout-alert.urgent');
    expect(css).toContain('.timeout-alert.ended');
    expect(css).toContain('.timeout-alert-mark');
    expect(css).toContain('.timeout-alert-text');
  });
});
