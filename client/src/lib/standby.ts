/**
 * 待机屏(还没开赛时铺满大屏的那一屏)上写什么。
 *
 * 之前这一屏写的是「即将开始 / Starting soon」—— 观众抬头只知道"还没开始",
 * 不知道几点开球。赛程表上有开赛时间的时候,直接把几点写出来更有用:
 *   准点模式、填了开赛时间 → "19:00 开赛" / "Tip-off at 19:00"
 *   倒计时模式            → "即将开始" / "Starting soon"
 *   什么都没填            → "即将开始" / "Starting soon"
 *
 * 只显示配置里那个 "HH:MM",不去推断是哪一天:
 * startTime 只有"几点"、没有"几号",赛程表上写几点就是几点,
 * 凭空加一句"明天"反而可能是错的(可能是下周三那一场)。
 *
 * 倒计时模式为什么写「即将开始」而不是「还剩 15:00」:
 * 倒计时模式下大屏整屏就是那个倒计时(还没到 3 分钟也会显示),
 * 待机屏只有在【没设倒计时】的时候才露出来 —— 那时候确实只剩"即将开始"可说。
 */
import type { StartMode } from '@biph/shared';
import type { MessageKey, Vars } from '../i18n/core';
import { isValidStartTime, resolveStartMode } from './format';

/** 取文案的函数形态 —— 与 useI18n() 返回的 t() 兼容 */
export type Translate = (key: MessageKey, vars?: Vars) => string;

/** 待机屏要写的那一句话 */
export function standbyLabel(
  match: { startMode?: StartMode | null; startTime?: string | null } | null | undefined,
  t: Translate,
): string {
  if (match && resolveStartMode(match) === 'scheduled' && isValidStartTime(match.startTime)) {
    return t('board.startup.at', { time: (match.startTime as string).trim() });
  }
  return t('board.standby');
}
