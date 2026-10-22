/**
 * 服务器当前时间(墙钟)组件的渲染测试。
 *
 * 管理台右上角与控制台左上角显示的是**同一个钟** —— 所以这里把
 * "格式固定 HH:MM:SS"、"两处不会走偏"这两件事钉死:
 *   - 固定 3 位补零,不随系统/语言变化(和比赛钟一个风格);
 *   - 传入的时间原样渲染,不做任何加减;
 *   - 类名由调用方决定(管理台是 badge,控制台是 control-clock)。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServerClock } from './ServerClock';

function render(now: number, className?: string, title?: string): string {
  return renderToStaticMarkup(
    <ServerClock now={now} className={className} title={title} />,
  );
}

describe('服务器当前时间(墙钟)', () => {
  it('渲染成 HH:MM:SS', () => {
    const html = render(new Date(2026, 0, 1, 9, 5, 7).getTime());
    expect(html).toContain('09:05:07');
  });

  it('小时/分钟/秒都补零', () => {
    expect(render(new Date(2026, 0, 1, 0, 0, 0).getTime())).toContain('00:00:00');
    expect(render(new Date(2026, 0, 1, 23, 59, 59).getTime())).toContain('23:59:59');
  });

  it('类名由调用方决定(管理台是 badge,控制台是 control-clock)', () => {
    expect(render(0, 'badge mono')).toContain('class="server-clock badge mono"');
    expect(render(0, 'control-clock mono')).toContain('class="server-clock control-clock mono"');
  });

  it('悬停提示能传进去', () => {
    expect(render(0, undefined, '服务器当前时间')).toContain('title="服务器当前时间"');
  });
});
