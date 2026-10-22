/**
 * i18n 核心(不依赖 React)。
 * ------------------------------------------------------------------
 * 语言解析优先级(从高到低):
 *
 *   1. 本地临时覆盖 override     —— 用户刚点过切换,不等服务端回包
 *   2. 比赛设置 scoped          —— presentation.locale,跟着本场比分走
 *   3. 场馆设置 venue            —— 整个服务器一个语言(服务端广播下来的)
 *   4. URL 参数 ?lang=zh|en      —— 二维码里带着它,只当"还没拿到服务端状态"时的兜底
 *   5. 本机偏好 device          —— localStorage,记住这台设备的习惯
 *   6. 默认简体中文
 *
 * 为什么"比赛设置"与"场馆设置"要排在本机偏好前面:
 * 现场是"大屏 + iPad + 管理台"好几台设备,切语言应该整场一起切,
 * 而不是大屏中文、iPad 英文、管理台又是中文。
 *
 * 为什么"场馆设置"和"比赛设置"同时存在:
 * 管理台(场地清单)没有"本场"概念,它只能跟着场馆;
 * 控制台与大屏读的是"本场"。服务端保证每场比赛的值都等于场馆语言,
 * 所以这两层永远是同一个值 —— 管理台与控制台不可能对不上。
 *
 * 为什么 URL 参数不再排第一:
 * 二维码里的 ?lang= 是"打开时先显示什么"的意思,不是"锁死不许改"。
 * 以前它优先级最高,导致大屏一旦从带 ?lang= 的二维码打开,
 * 之后在控制台切语言它也不跟着变 —— 看着像坏了。现在它只是兜底。
 */
import { LOCALES, isLocale, type Locale } from '@biph/shared';
import { enUS, SERVER_ERROR_KEYS, zhCN, type MessageKey } from './dict';

export type { Locale };
export { type MessageKey };
export { LOCALES, isLocale };

const STORAGE_KEY = 'biph.locale';

const DICTS: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zhCN as unknown as Record<MessageKey, string>,
  'en-US': enUS,
};

export type Vars = Record<string, string | number>;

export const DEFAULT_LOCALE: Locale = 'zh-CN';

/* ------------------------------ 本机偏好 ------------------------------ */

export function readDeviceLocale(): Locale | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeDeviceLocale(locale: Locale): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* 隐私模式下 localStorage 可能不可用,忽略 */
  }
}

/* ------------------------------ URL 参数 ------------------------------ */

/** ?lang=zh|en|zh-CN|en-US → Locale;认不出来返回 null */
export function readUrlLocale(search?: string): Locale | null {
  let raw: string | null = null;
  try {
    const q = search ?? (typeof window !== 'undefined' ? window.location.search : '');
    raw = new URLSearchParams(q).get('lang');
  } catch {
    return null;
  }
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'zh' || v === 'zh-cn' || v === 'zh-hans') return 'zh-CN';
  if (v === 'en' || v === 'en-us' || v === 'en-gb') return 'en-US';
  return null;
}

/** 给 URL 拼上语言参数(用于生成大屏链接/二维码) */
export function withLangParam(url: string, locale: Locale | null): string {
  if (!locale) return url;
  const short = locale === 'en-US' ? 'en' : 'zh';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}lang=${short}`;
}

/**
 * 时间戳 → HH:MM:SS。
 *
 * 刻意不用 toLocaleTimeString:各语言/系统的分隔符与 12/24 小时制不一致,
 * 记分牌上的时钟要的是稳定格式。
 */
export function formatClockTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '--:--:--';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ------------------------------ 翻译 ------------------------------ */

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  let s = DICTS[locale]?.[key] ?? DICTS[DEFAULT_LOCALE][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/**
 * 把服务端返回的中文错误翻成当前语言。
 *
 * 服务端错误文案是中文(协议里没有错误码),这里按原文映射。
 * 认不出来的原文原样返回 —— 服务端以后改字也不会变成空白。
 */
export function translateServerError(locale: Locale, message: string): string {
  const key = SERVER_ERROR_KEYS[message];
  if (!key) return message;
  return translate(locale, key);
}

/* ------------------------------ 全局状态 ------------------------------ */

let device: Locale | null = readDeviceLocale();
let scoped: Locale | null = null;
let venue: Locale | null = null;
let override: Locale | null = null;
const urlLocale: Locale | null = readUrlLocale();

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 当前生效的语言 */
export function effectiveLocale(): Locale {
  return override ?? scoped ?? venue ?? urlLocale ?? device ?? DEFAULT_LOCALE;
}

/** 模块级当前语言:给 React 之外的地方用(如 api 层的错误文案) */
export function getLocale(): Locale {
  return effectiveLocale();
}

/**
 * 设置比赛端的语言(presentation.locale)。比赛端一变,本地临时覆盖就作废。
 */
export function setScopedLocale(locale: Locale | null): void {
  if (scoped === locale) return;
  scoped = locale;
  override = null;
  emit();
}

/**
 * 设置场馆语言(整个服务器一个)。
 *
 * 服务端广播/轮询下来后调用。变化时作废本地临时覆盖 ——
 * 服务端说的算,不能让一次早就过期的点击一直压着它。
 */
export function setVenueLocale(locale: Locale | null): void {
  if (venue === locale) return;
  venue = locale;
  override = null;
  emit();
}

/**
 * 用户主动切换语言。
 * 写本机偏好(记住这台设备) + 立刻本地生效(不等服务端回包)。
 */
export function setLocale(locale: Locale): void {
  writeDeviceLocale(locale);
  device = locale;
  override = locale;
  emit();
}

/**
 * 当前 URL 是否用 ?lang= 钉死了语言。
 *
 * 现在 ?lang= 只是"打开时先显示什么",不再锁死切换按钮 ——
 * 大屏从二维码打开后,计分员在控制台切语言,它必须跟着变。
 */
export function isLocaleLockedByUrl(): boolean {
  return false;
}

export { subscribe as subscribeLocale, effectiveLocale as getLocaleSnapshot };
