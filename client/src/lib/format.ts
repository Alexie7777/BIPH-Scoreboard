/**
 * 格式化助手。
 *
 * 计时相关的格式化必须与后端完全一致,因此这里只做【转发】,
 * 真实实现一律来自 `@biph/shared`,不在前端另写一份。
 *
 * 界面文案不在这里:统一走 `i18n` 的 t(),避免两处维护。
 */
import {
  buildPeriodLabel,
  formatClock,
  formatSeconds,
  isValidStartMode,
  isValidStartTime,
  nextStartOccurrence,
  periodDurationMs,
  remainingMs,
  resolveStartDisplay,
  resolveStartMode,
  shotClockDurationMs,
  startCountdownMs,
  startCountdownRemainingMs,
  parseStartCountdown,
  formatStartCountdownInput,
  type MatchStatus,
  type StartMode,
} from '@biph/shared';
import { translate, type Locale } from '../i18n';

export {
  buildPeriodLabel,
  formatClock,
  formatSeconds,
  formatStartCountdownInput,
  isValidStartMode,
  isValidStartTime,
  nextStartOccurrence,
  parseStartCountdown,
  periodDurationMs,
  remainingMs,
  resolveStartDisplay,
  resolveStartMode,
  shotClockDurationMs,
  startCountdownMs,
  startCountdownRemainingMs,
};
export type { StartMode };

/** 状态 → 界面标签(按当前语言) */
export function statusLabel(status: MatchStatus, locale: Locale): string {
  switch (status) {
    case 'live':
      return translate(locale, 'status.live');
    case 'finished':
      return translate(locale, 'status.finished');
    default:
      return translate(locale, 'status.scheduled');
  }
}

/** 状态 → badge class */
export function statusBadgeClass(status: MatchStatus): string {
  switch (status) {
    case 'live':
      return 'badge live';
    case 'finished':
      return 'badge finished';
    default:
      return 'badge scheduled';
  }
}

/** 把绝对 URL 拆成 origin + path,便于展示"控制台链接" */
export function splitUrl(url: string): { origin: string; path: string } {
  try {
    const u = new URL(url, window.location.origin);
    return { origin: u.origin, path: u.pathname + u.search };
  } catch {
    return { origin: '', path: url };
  }
}
