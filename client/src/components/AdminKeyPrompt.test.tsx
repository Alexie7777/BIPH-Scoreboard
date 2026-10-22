/**
 * 管理员密钥确认弹窗(AdminKeyPrompt)的渲染测试。
 *
 * 这个弹窗是"重置比赛 / 删除比赛"的唯一闸门,行为必须钉死:
 *   - 输入框是 password 类型(不能明文把密钥显示在屏幕上);
 *   - 密钥输错时弹窗【不关】,原地显示服务端给的拒绝原因;
 *   - 两种操作显示不同的标题与后果说明,别让人以为删的是别的东西;
 *   - 提交中禁用按钮,防止连点。
 *
 * 顺便检查样式表里确实有这些类名 —— 组件改了类名而样式没跟上,
 * 是这种"纯前端"改动最容易悄悄坏掉的地方。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { I18nProvider } from '../i18n';
import { AdminKeyPrompt, type AdminKeyPromptProps } from './AdminKeyPrompt';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function render(props: Partial<AdminKeyPromptProps> = {}): string {
  const full: AdminKeyPromptProps = {
    action: 'reset',
    value: '',
    error: null,
    busy: false,
    onChange: () => {},
    onSubmit: () => {},
    onCancel: () => {},
    ...props,
  };
  return renderToStaticMarkup(
    <I18nProvider>
      <AdminKeyPrompt {...full} />
    </I18nProvider>,
  );
}

describe('管理员密钥确认弹窗', () => {
  it('重置:标题、后果说明与"确认重置"按钮', () => {
    const html = render({ action: 'reset' });
    expect(html).toContain('重置比赛');
    expect(html).toContain('清空比分');
    expect(html).toContain('确认重置');
    expect(html).not.toContain('确认删除');
  });

  it('删除:标题、后果说明与"确认删除"按钮', () => {
    const html = render({ action: 'delete' });
    expect(html).toContain('删除比赛');
    expect(html).toContain('立即失效');
    expect(html).toContain('确认删除');
    expect(html).not.toContain('确认重置');
  });

  it('密钥输入框是密码框(屏幕上是圆点,不是明文)', () => {
    const html = render({ value: '1818' });
    expect(html).toContain('type="password"');
    expect(html).toContain('id="admin-key-input"');
    // 标签与输入框绑定,读屏软件念得出来
    expect(html).toContain('for="admin-key-input"');
  });

  it('密钥输错:弹窗不关,原地显示服务端给的拒绝原因', () => {
    const html = render({ error: '需要管理员密钥' });
    // 弹窗还在(标题还在)
    expect(html).toContain('重置比赛');
    // 错误以危险色通知呈现
    expect(html).toContain('class="notice danger"');
    expect(html).toContain('需要管理员密钥');
  });

  it('提交中:按钮禁用,文案换成"执行中…"', () => {
    const html = render({ busy: true });
    expect(html).toContain('执行中…');
    expect(html).toContain('disabled');
  });

  it('提示里写清楚默认密钥是 1818', () => {
    expect(render()).toContain('默认密钥是 1818');
    expect(render()).toContain('ADMIN_KEY');
  });

  it('样式表里确实有这些类名(组件与样式不能脱节)', () => {
    const css = readFileSync(path.join(HERE, '../styles/global.css'), 'utf8');
    expect(css).toContain('.modal-backdrop');
    expect(css).toContain('.modal-actions');
    expect(css).toContain('#admin-key-input');
    expect(css).toContain('.notice.danger');
  });
});
