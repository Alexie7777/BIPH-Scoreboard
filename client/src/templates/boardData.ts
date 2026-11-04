/**
 * 大屏的「数据层」。
 *
 * 四套模板(简洁 / LED / 现代转播 / 总决赛)显示的东西必须**完全一致** ——
 * 同一个比赛摆四块屏,比分、时钟、犯规、暂停不能有两套算法。
 * 口径写两份、改一处忘一处,现场就会出现"这台屏 12:48,那台屏 12:49"。
 *
 * 所以这里只有一个纯函数:所有派生值都从它算出来,
 * 模板之间差的只有【长什么样】,不差【显示什么】。
 *
 * 纯函数(不吃当前时间、不读全局状态)才能直接单测。
 */
import type { Match, StartMode, Team } from '@biph/shared';
import { isFootball, periodDurationMs, shotClockEnabled } from '@biph/shared';

export interface BoardProps {
  match: Match;
  /** 本地推算的比赛钟剩余毫秒 */
  clockRemainingMs: number;
  /** 本地推算的进攻钟剩余毫秒 */
  shotRemainingMs: number;
  /** 本地推算的暂停倒计时剩余毫秒(没有暂停时为 0) */
  timeoutRemainingMs: number;
  /** 本地推算的开赛倒计时剩余毫秒 */
  startRemainingMs: number;
  /** 本地推算的补时剩余毫秒(足球;0 = 没有补时) */
  addedTimeRemainingMs?: number;
  /** 本地推算的中场倒计时剩余毫秒(足球) */
  halftimeRemainingMs?: number;
  /**
   * 开赛倒计时屏该不该显示。
   *
   * 准点模式:只在开赛前 3 分钟那个窗口里为 true;
   * 倒计时模式:从设定那一刻起一直是 true,**归零后仍然留着**(显示 00:00 +「开赛」),
   * 因为"到点了"是一个状态,不是"没有倒计时" —— 该由计分员按「开始」,绝不自动开表。
   */
  startVisible: boolean;
  /** 开赛模式:准点(墙钟)还是倒计时(相对时长) */
  startMode: StartMode;
  /** 是否与服务器断开 */
  offline: boolean;
  /** 是否非等比铺满 */
  stretch?: boolean;
}

export interface BoardData {
  /** 大屏顶栏标题 */
  title: string;
  /** 有没有赞助商信息 */
  showSponsor: boolean;
  /** 本场是否用进攻钟(没勾"使用进攻钟"时为 false) */
  showShot: boolean;
  /** 进攻钟最后 5 秒(变红) */
  shotLow: boolean;
  /** 是不是足球 */
  football: boolean;
  /** 大屏上要显示的比赛钟数值(足球是正数) */
  clockShown: number;
  /** 比赛钟最后 1 分钟(变红) */
  clockLow: boolean;
  /** 比赛钟颜色 */
  clockColor: string;
  /** 进攻钟颜色 */
  shotColor: string;
  /** 比赛是不是结束了 */
  isFinal: boolean;
  /** 补时条该不该显示(足球) */
  showAddedTime: boolean;
  /** 是不是中场休息(足球) */
  inHalftime: boolean;
  /** 主队进 BONUS */
  homeBonus: boolean;
  /** 客队进 BONUS */
  awayBonus: boolean;
  /** 正在叫暂停的队 */
  timeoutTeam: Team | null;
  /** 暂停倒计时是不是在跑 */
  timeoutActive: boolean;
  /** 开赛倒计时屏该不该显示 */
  startActive: boolean;
  /** 开赛倒计时最后 10 秒(变红) */
  startUrgent: boolean;
  /** 节次标签(Q1 / 1H / HT …) */
  periodLabel: string;
}

export function computeBoardData(props: BoardProps, accent: string): BoardData {
  const {
    match,
    clockRemainingMs,
    shotRemainingMs,
    timeoutRemainingMs,
    startRemainingMs,
    addedTimeRemainingMs = 0,
    halftimeRemainingMs = 0,
    startVisible,
  } = props;
  const { rules, presentation, home, away } = match;

  const title = presentation.titleText || match.name;
  const showSponsor = !!(presentation.sponsorName || presentation.sponsorText);
  const showShot = shotClockEnabled(match);
  const shotLow = shotRemainingMs > 0 && shotRemainingMs <= 5_000;

  /*
   * 足球的表往上走(00:00 → 45:00),篮球的表倒着走(还剩多少)。
   *
   * 两种口径只在这里转换一次:
   *   - 篮球:直接显示剩余;
   *   - 足球:本节总时长 − 剩余 = 已经过去多少。
   * 锚点模型两边一样(都存"剩余"),所以服务端与客户端永远算得一致。
   */
  const football = isFootball(match);
  const clockTotal = periodDurationMs(rules);
  const clockShown = football
    ? Math.max(0, Math.min(clockTotal, clockTotal - clockRemainingMs))
    : clockRemainingMs;
  // 最后 1 分钟:倒着走是"剩余 ≤ 60s",正着走是"已用 ≥ 总长 − 60s"
  const clockLow = football
    ? clockShown > 0 && clockShown >= clockTotal - 60_000
    : clockRemainingMs > 0 && clockRemainingMs <= 60_000;

  const isFinal = match.status === 'finished';

  /*
   * 补时与中场休息(足球)。
   *
   * 补时表只在还有补时的时候亮出来;归零之后服务端把它清掉,
   * 这里也就跟着消失 —— 大屏上不会一直挂着一个 "+00:00"。
   */
  const showAddedTime = football && addedTimeRemainingMs > 0;
  const inHalftime = football && !!match.halftime;

  const homeBonus = rules.bonusFouls > 0 && home.fouls >= rules.bonusFouls;
  const awayBonus = rules.bonusFouls > 0 && away.fouls >= rules.bonusFouls;

  /*
   * 暂停倒计时。
   *
   * 倒计时归零后服务端会自动收尾,这里再按本地推算兜一层:
   * 万一断网没收到收尾消息,大屏上的"00"也会自己消失,不会一直挂着。
   */
  const timeoutTeam =
    match.timeout?.side === 'home' ? home : match.timeout?.side === 'away' ? away : null;
  const timeoutActive = !!match.timeout?.running && timeoutRemainingMs > 0;

  const startActive = startVisible;
  const startUrgent = startRemainingMs <= 10_000;

  return {
    title,
    showSponsor,
    showShot,
    shotLow,
    football,
    clockShown,
    clockLow,
    clockColor: clockLow ? '#ff4d5e' : accent,
    shotColor: shotLow ? '#ff4d5e' : accent,
    isFinal,
    showAddedTime,
    inHalftime,
    homeBonus,
    awayBonus,
    timeoutTeam,
    timeoutActive,
    startActive,
    startUrgent,
    periodLabel: match.clock.periodLabel || (football ? '1H' : 'Q1'),
  };
}
