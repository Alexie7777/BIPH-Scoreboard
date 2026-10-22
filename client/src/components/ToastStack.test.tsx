/**
 * 操作提示栈(ToastStack)的渲染测试。
 *
 * 用 react-dom/server 真正渲染一次组件 —— 不需要浏览器 DOM,
 * 也能锁住"最终输出到屏幕上的那段标记":
 *   - 容器类名(样式表靠它定位右上角)
 *   - 每条提示的类名(成功/失败两种样式)
 *   - 文案和对勾/感叹号
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
import { ToastStack, type ToastItem } from './ToastStack';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function render(toasts: ToastItem[]): string {
  return renderToStaticMarkup(
    <ToastStack toasts={toasts} onDismiss={() => undefined} />,
  );
}

describe('操作提示栈', () => {
  it('没有提示时什么都不渲染', () => {
    expect(render([])).toBe('');
  });

  it('成功提示:容器 + 条目 + 对勾 + 文案', () => {
    const html = render([{ id: 1, text: '猛虎联队 +2 分', kind: 'ok' }]);
    expect(html).toContain('class="toast-stack"');
    expect(html).toContain('class="toast-item ok"');
    expect(html).toContain('猛虎联队 +2 分');
    // 对勾是"操作生效"的标志,不能丢
    expect(html).toContain('✓');
  });

  it('失败提示:条目带 err 类,标志换成感叹号', () => {
    const html = render([{ id: 1, text: '没有可撤销的操作', kind: 'err' }]);
    expect(html).toContain('class="toast-item err"');
    expect(html).toContain('没有可撤销的操作');
    expect(html).toContain('!');
    expect(html).not.toContain('✓');
  });

  it('多条提示按顺序堆叠', () => {
    const html = render([
      { id: 1, text: '第一条', kind: 'ok' },
      { id: 2, text: '第二条', kind: 'err' },
    ]);
    expect(html.indexOf('第一条')).toBeLessThan(html.indexOf('第二条'));
    expect(html.match(/class="toast-item/g)?.length).toBe(2);
  });

  it('给读屏软件播报(aria-live),不然提示对无障碍是隐形的', () => {
    const html = render([{ id: 1, text: '比赛钟已开始', kind: 'ok' }]);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
  });

  it('样式表里确实有这些类名(组件与样式不能脱节)', () => {
    const css = readFileSync(path.join(HERE, '../styles/global.css'), 'utf8');
    expect(css).toContain('.toast-stack');
    expect(css).toContain('.toast-item');
    expect(css).toContain('.toast-item.err');
    // 旧版底部居中的错误条样式已经退役,不该再有
    expect(css).not.toMatch(/^\.toast \{/m);
  });
});
