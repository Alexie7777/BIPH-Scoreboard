/**
 * 运动项目注册表。
 *
 * 每个项目一行:卡片上的 emoji、界面上的名字、还有"这个项目有哪些控件"。
 *
 * 加一个新项目只需要:
 *   1. shared 里给 SportId 加一个枚举值;
 *   2. 这里加一条配置;
 * 页面上的 emoji、文案、筛选就自动跟着对了。
 */
import type { SportId } from '@biph/shared';
import { translate, type Locale, type MessageKey } from '../i18n';

export interface SportInfo {
  /** 卡片上的标识 emoji */
  emoji: string;
  /** 文案键(中英文在词典里) */
  labelKey: MessageKey;
}

/** 全部支持的项目 */
export const SPORTS: Record<SportId, SportInfo> = {
  basketball: { emoji: '🏀', labelKey: 'sport.basketball' },
  football: { emoji: '⚽', labelKey: 'sport.football' },
};

/** 没写 sport 的老数据一律按篮球处理 */
export const DEFAULT_SPORT: SportId = 'basketball';

export function isSportId(v: unknown): v is SportId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPORTS, v);
}

/** 归一化:不认识的值退回篮球 */
export function normalizeSport(sport: unknown): SportId {
  return isSportId(sport) ? sport : DEFAULT_SPORT;
}

/** 项目 emoji */
export function sportEmoji(sport?: unknown): string {
  return SPORTS[normalizeSport(sport)].emoji;
}

/** 项目名称(按当前语言) */
export function sportLabel(sport: unknown, locale: Locale): string {
  return translate(locale, SPORTS[normalizeSport(sport)].labelKey);
}
