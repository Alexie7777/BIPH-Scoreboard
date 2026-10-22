/**
 * 管理员密钥确认弹窗。
 *
 * 为什么单独抽一个组件:这段 UI 是"破坏性操作"的唯一闸门,
 * 必须能被单独渲染、被单独测试 —— 不能靠"点开配置页看看"来验证。
 *
 * 交互约定:
 *   - 密钥输错时弹窗**不关**,原地显示服务端给的拒绝原因,
 *     让人改一个字符就能再试,而不是失败一次要从头再来;
 *   - 提交中禁用按钮,防止连点。
 */
import { useI18n } from '../i18n';

export type DangerAction = 'reset' | 'delete';

export interface AdminKeyPromptProps {
  /** 正在确认哪一种破坏性操作 */
  action: DangerAction;
  /** 输入框里的密钥 */
  value: string;
  /** 错误提示(密钥不对时由服务端给出),null = 没有错误 */
  error: string | null;
  /** 正在提交 */
  busy?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function AdminKeyPrompt({
  action,
  value,
  error,
  busy = false,
  onChange,
  onSubmit,
  onCancel,
}: AdminKeyPromptProps) {
  const { t } = useI18n();
  const isReset = action === 'reset';

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isReset ? t('setup.keyPrompt.resetTitle') : t('setup.keyPrompt.deleteTitle')}</h2>
        <p className="panel-hint">
          {isReset ? t('setup.keyPrompt.resetBody') : t('setup.keyPrompt.deleteBody')}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="field">
            <label htmlFor="admin-key-input">{t('setup.keyPrompt.label')}</label>
            <input
              id="admin-key-input"
              type="password"
              autoFocus
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={t('setup.keyPrompt.placeholder')}
            />
            <small className="field-hint">{t('setup.keyPrompt.hint')}</small>
          </div>
          {error ? <div className="notice danger">{error}</div> : null}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn danger" disabled={busy}>
              {busy
                ? t('setup.keyPrompt.working')
                : isReset
                  ? t('setup.keyPrompt.confirmReset')
                  : t('setup.keyPrompt.confirmDelete')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AdminKeyPrompt;
