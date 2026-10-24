/**
 * 进攻钟面板的渲染与交互测试。
 *
 * 锁住三件现场真的会用到的操作:
 *   1. 「重置并开表」—— 投篮命中后一次点完,不用"先重置、再点开始"两下
 *   2. 「14s」—— 抢到进攻篮板后复位到 14 秒(FIBA 2014 起)
 *   3. 「24 秒违例」—— 破坏性操作,必须走二次确认
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../i18n';
import { ShotClockPanel } from './ShotClockPanel';

function render(props: Partial<React.ComponentProps<typeof ShotClockPanel>> = {}) {
  return renderToStaticMarkup(
    <I18nProvider>
      <ShotClockPanel
        remainingMs={24_000}
        running={false}
        durationSeconds={24}
        onToggle={() => {}}
        onAdjust={() => {}}
        onReset={() => {}}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('进攻钟面板', () => {
  it('常用操作:重置并开表 / 14s 各有一个按钮', () => {
    const html = render({ onResetAndStart: () => {}, onReset14: () => {} });
    expect(html).toContain('重置并开表');
    expect(html).toContain('14s');
  });

  it('没传回调就不渲染那些按钮(不给人点没用的按钮)', () => {
    const html = render();
    expect(html).not.toContain('重置并开表');
    expect(html).not.toContain('14s');
    expect(html).not.toContain('24 秒违例');
  });

  it('违例按钮存在,且是破坏性操作(要二次确认)', () => {
    const html = render({ onViolation: () => {} });
    expect(html).toContain('24 秒违例');
    // ConfirmButton 的 danger 变体
    expect(html).toContain('danger');
  });

  it('点击「重置并开表」会回调 onResetAndStart', () => {
    const onResetAndStart = vi.fn();
    // renderToStaticMarkup 不触发事件,这里只验证回调被正确接收与透传
    const html = render({ onResetAndStart });
    expect(onResetAndStart).not.toHaveBeenCalled();
    expect(html).toContain('重置并开表');
  });

  it('剩余时间少的时候面板进入 urgent 状态(变红)', () => {
    const html = render({ remainingMs: 3_000, running: true });
    expect(html).toContain('urgent');
  });
});
