/**
 * 语言切换:中文 / English 两段式按钮。
 *
 * 只负责"本机立刻生效";要不要把语言同步给服务端(比如让大屏跟着切),
 * 由调用方通过 onChange 自己决定。
 */
import type { Locale } from '@biph/shared';
import { useI18n } from '../i18n';

export interface LanguageToggleProps {
  /** 附加 class */
  className?: string;
  /** 切换回调:参数是刚选中的语言 */
  onChange?: (locale: Locale) => void;
  /** 紧凑模式(大屏角落用) */
  compact?: boolean;
}

export function LanguageToggle({ className, onChange, compact }: LanguageToggleProps) {
  const { locale, t, setLocale, locked } = useI18n();

  const pick = (next: Locale) => {
    if (next === locale) return;
    setLocale(next);
    onChange?.(next);
  };

  const classes = ['lang-toggle', compact ? 'compact' : '', className ?? ''].filter(Boolean).join(' ');

  return (
    <div className={classes} role="group" aria-label={t('common.lang')} title={locked ? t('common.lang') : undefined}>
      <button
        type="button"
        className={locale === 'zh-CN' ? 'on' : ''}
        disabled={locked}
        onClick={() => pick('zh-CN')}
        aria-pressed={locale === 'zh-CN'}
      >
        中文
      </button>
      <button
        type="button"
        className={locale === 'en-US' ? 'on' : ''}
        disabled={locked}
        onClick={() => pick('en-US')}
        aria-pressed={locale === 'en-US'}
      >
        EN
      </button>
    </div>
  );
}

export default LanguageToggle;
