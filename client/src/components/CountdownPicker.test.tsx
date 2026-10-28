/**
 * 倒计时选择器(准点模式原生时间选择器的对等物)的渲染测试。
 *
 * 锁住现场真的会用到的三件事:
 *   1. 常用时长一键选(现场最常说的"还有 15 分钟")
 *   2. 精确到秒:分钟/秒两个数字框,值按当前时长回填
 *   3. 已经设过时,面板里多一个「重新起算」(同一个时长重新倒数一遍)
 *
 * 点击这类交互由浏览器实测覆盖(真实 Chrome 点一次"15 分",
 * 看服务端有没有收到 15 分钟的起算),这里只锁渲染出来的东西。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../i18n';
import {
  COUNTDOWN_PRESET_MINUTES,
  CountdownPicker,
  presetDurationMs,
} from './CountdownPicker';

function render(props: Partial<React.ComponentProps<typeof CountdownPicker>> = {}) {
  return renderToStaticMarkup(
    <I18nProvider>
      <CountdownPicker value={null} onPick={() => {}} onClose={() => {}} {...props} />
    </I18nProvider>,
  );
}

describe('倒计时选择器', () => {
  it('常用时长都在(现场最常说的那几句)', () => {
    const html = render();
    for (const m of COUNTDOWN_PRESET_MINUTES) {
      expect(html).toContain(`${m} 分`);
    }
  });

  it('常用时长换算成毫秒没算错', () => {
    expect(presetDurationMs(15)).toBe(900_000);
    expect(presetDurationMs(1)).toBe(60_000);
    expect(presetDurationMs(60)).toBe(3_600_000);
  });

  it('标题与"大屏将显示"的预览都在', () => {
    const html = render({ value: 15 * 60_000 });
    expect(html).toContain('选择剩余时间');
    expect(html).toContain('15:00');
  });

  it('分钟/秒两个数字框,值按当前时长回填', () => {
    const html = render({ value: 12 * 60_000 + 30_000 });
    expect(html).toContain('分钟');
    expect(html).toContain('秒');
    expect(html).toContain('value="12"');
    expect(html).toContain('value="30"');
  });

  it('还没设过时不给「重新起算」,设过了才有', () => {
    expect(render({ value: null })).not.toContain('重新起算');
    expect(render({ value: 15 * 60_000 })).toContain('重新起算');
  });

  it('确定/取消两个按钮都在', () => {
    const html = render();
    expect(html).toContain('确定');
    expect(html).toContain('取消');
  });
});
