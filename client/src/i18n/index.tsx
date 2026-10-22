/**
 * i18n 的 React 外壳。
 *
 * 组件里统一用 `const { t, locale, setLocale } = useI18n();` 取文案。
 * 不要再从别处 import 一个裸的 t() —— 那样组件不会因为语言变化而重渲染。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  effectiveLocale,
  isLocaleLockedByUrl,
  setLocale as setLocaleRaw,
  subscribeLocale,
  translate,
  type Locale,
  type MessageKey,
  type Vars,
} from './core';

export * from './core';

export interface I18nValue {
  /** 当前生效的语言 */
  locale: Locale;
  /** 取文案:t('team.fouls') / t('clock.label', { period: 'Q2' }) */
  t: (key: MessageKey, vars?: Vars) => string;
  /** 切换语言:写本机偏好并立刻生效。服务端同步由调用方负责。 */
  setLocale: (locale: Locale) => void;
  /**
   * 语言是否被"钉死"、不允许手动切换。
   *
   * 现在永远是 false:URL 上的 ?lang= 只是"打开时先显示什么",
   * 不再锁死切换按钮 —— 大屏从带 ?lang= 的二维码打开后,
   * 计分员在控制台切语言,它必须跟着变。
   */
  locked: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, effectiveLocale, effectiveLocale);

  const t = useCallback((key: MessageKey, vars?: Vars) => translate(locale, key, vars), [locale]);
  const setLocale = useCallback((l: Locale) => setLocaleRaw(l), []);

  // 浏览器标签页标题:与 Dashboard 标题用同一个键,切语言时一起换。
  // 顺带把 <html lang> 也改掉(读屏软件与浏览器自带 UI 会跟着变)。
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = translate(locale, 'app.title');
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({ locale, t, setLocale, locked: isLocaleLockedByUrl() }),
    [locale, t, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n 必须在 <I18nProvider> 内部使用');
  return ctx;
}

export default useI18n;
