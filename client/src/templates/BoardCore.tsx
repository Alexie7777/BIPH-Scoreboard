/**
 * 大屏的共享渲染逻辑。
 *
 * 三个模板(simple / led / broadcast)共用这一套 DOM,只靠 CSS 变量与
 * 少量类名区分风格,避免三份重复代码各自漂移。
 *
 * 所有尺寸都是【设计画布 1920×1080 坐标系】里的 px 值,
 * 整块画布由 Display 页统一 scale。
 */
import type { Match, StartMode } from '@biph/shared';
import { cssVars } from '../lib/cssVars';
import { readableAccent } from '../lib/colors';
import { formatClock, formatSeconds } from '../lib/format';
import { useI18n } from '../i18n';
import { SevenSegment } from '../components/SevenSegment';
import { IconChevron } from '../components/icons';

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

export interface BoardCoreProps extends BoardProps {
  /** 点亮色(随模板变化) */
  accent: string;
}

export function BoardCore({
  match,
  clockRemainingMs,
  shotRemainingMs,
  timeoutRemainingMs,
  startRemainingMs,
  startVisible,
  startMode,
  offline,
  accent,
}: BoardCoreProps) {
  const { rules, presentation, home, away } = match;
  const { t } = useI18n();

  const title = presentation.titleText || match.name;
  const showSponsor = !!(presentation.sponsorName || presentation.sponsorText);
  const showShot = rules.useShotClock;
  const shotLow = shotRemainingMs > 0 && shotRemainingMs <= 5_000;
  const clockLow = clockRemainingMs > 0 && clockRemainingMs <= 60_000;
  const clockColor = clockLow ? '#ff4d5e' : accent;
  const shotColor = shotLow ? '#ff4d5e' : accent;
  const isFinal = match.status === 'finished';

  const homeBonus = rules.bonusFouls > 0 && home.fouls >= rules.bonusFouls;
  const awayBonus = rules.bonusFouls > 0 && away.fouls >= rules.bonusFouls;

  /*
   * 暂停倒计时。
   *
   * 倒计时归零后服务端会自动收尾,这里再按本地推算兜一层:
   * 万一断网没收到收尾消息,大屏上的"00"也会自己消失,不会一直挂着。
   */
  const timeoutTeam = match.timeout?.side === 'home' ? home : match.timeout?.side === 'away' ? away : null;
  const timeoutActive = !!match.timeout?.running && timeoutRemainingMs > 0;

  /*
   * 开赛倒计时。
   *
   * 两种模式最后都落到这一屏:
   *   - 准点模式:赛程表上写着 19:00 开赛,大屏就在开赛前 3 分钟切到这一屏;
   *   - 倒计时模式:从设定那一刻起就一直显示,归零后留在这一屏显示「开赛」。
   * 判定在本地做,断网也照常走。
   * 最后 10 秒转红,跟比赛钟/进攻钟的"最后阶段变红"一个规矩。
   */
  const startActive = startVisible;
  const startUrgent = startRemainingMs <= 10_000;
  // 归零之后不再是"距开赛",而是"开赛" —— 该由计分员按开始,屏幕不替他做主
  const startLabel = startRemainingMs > 0 ? t('board.startup.label') : t('board.startup.tipoff');

  return (
    <>
      <div className="board-top">
        <div className="board-title">{title}</div>
        {showSponsor ? (
          <div className="board-sponsor">
            {presentation.sponsorName ? <div className="s-name">{presentation.sponsorName}</div> : null}
            {presentation.sponsorText ? <div className="s-text">{presentation.sponsorText}</div> : null}
          </div>
        ) : null}
      </div>

      <div className="board-main">
        <div className="board-team" style={cssVars({ '--team-color': home.color })}>
          <div className="t-color" />
          <div className="t-name">
            {home.logoUrl ? <img className="t-logo" src={home.logoUrl} alt="" /> : null}
            <span className="t-name-text">{home.name}</span>
          </div>
          <div className="t-score">{home.score}</div>
          <div className="t-poss">
            {match.possession === 'home' ? (
              <>
                <IconChevron size={44} />
                {t('board.possession')}
              </>
            ) : (
              ''
            )}
          </div>
        </div>

        <div className="board-center">
          <div className="period">{match.clock.periodLabel || 'Q1'}</div>
          <SevenSegment
            value={formatClock(clockRemainingMs)}
            height={190}
            color={clockColor}
            dimColor="rgba(255,255,255,0.08)"
            title={t('board.clockTitle', { time: formatClock(clockRemainingMs) })}
          />
          {showShot ? (
            /*
             * 进攻钟区只放倒计时数字。
             *
             * 早先这里还画了一个固定的"24"(本场设定的进攻钟时长),
             * 跟倒计时数字同字号同粗体并排放着,看着像数字的一部分
             * ("2416"),现场没人认得出它是干什么的 —— 已经去掉。
             * 规则值在管理台里看就够了,大屏只管走秒。
             */
            <div className={shotLow ? 'shot-wrap low' : 'shot-wrap'}>
              <SevenSegment
                value={formatSeconds(shotRemainingMs)}
                height={86}
                color={shotColor}
                dimColor="rgba(255,255,255,0.08)"
                title={t('board.shotTitle', { time: formatSeconds(shotRemainingMs) })}
              />
            </div>
          ) : null}
        </div>

        <div className="board-team board-team--away" style={cssVars({ '--team-color': away.color })}>
          <div className="t-color" />
          <div className="t-name">
            {away.logoUrl ? <img className="t-logo" src={away.logoUrl} alt="" /> : null}
            <span className="t-name-text">{away.name}</span>
          </div>
          <div className="t-score">{away.score}</div>
          <div className="t-poss">
            {match.possession === 'away' ? (
              <>
                <IconChevron size={44} />
                {t('board.possession')}
              </>
            ) : (
              ''
            )}
          </div>
        </div>
      </div>

      <div className="board-bottom">
        {rules.showTeamFouls ? (
          <>
            <div className="b-item">
              <span style={{ color: readableAccent(home.color) }}>{home.shortName || home.name}</span>
              {t('board.fouls')} <b>{home.fouls}</b>
            </div>
            <div className="b-item">
              <span style={{ color: readableAccent(away.color) }}>{away.shortName || away.name}</span>
              {t('board.fouls')} <b>{away.fouls}</b>
            </div>
          </>
        ) : null}

        {rules.showTimeouts ? (
          <>
            <div className="b-item">
              <span style={{ color: readableAccent(home.color) }}>{home.shortName || home.name}</span>
              {t('board.timeouts')} <b>{home.timeouts}</b>
              {rules.timeoutsPerTeam > 0 ? (
                <span className="b-dim">/{rules.timeoutsPerTeam}</span>
              ) : null}
            </div>
            <div className="b-item">
              <span style={{ color: readableAccent(away.color) }}>{away.shortName || away.name}</span>
              {t('board.timeouts')} <b>{away.timeouts}</b>
              {rules.timeoutsPerTeam > 0 ? (
                <span className="b-dim">/{rules.timeoutsPerTeam}</span>
              ) : null}
            </div>
          </>
        ) : null}

        {homeBonus ? <span className="badge bonus">BONUS · {home.shortName || home.name}</span> : null}
        {awayBonus ? <span className="badge bonus">BONUS · {away.shortName || away.name}</span> : null}
      </div>

      {isFinal ? <div className="board-final">FINAL</div> : null}

      {/*
        开赛倒计时:开赛前 3 分钟铺满整个画面。
        放在画布内(而不是画布外的待机层),这样它跟着 1920×1080 一起缩放 ——
        4:3 投影仪和 16:9 大屏上,倒计时一样大。
      */}
      {startActive ? (
        <div className="board-startup">
          <div className="su-event">{title}</div>
          <div className="su-label">{startLabel}</div>
          <SevenSegment
            value={formatClock(startRemainingMs)}
            height={200}
            color={startUrgent ? '#ff4d5e' : accent}
            dimColor="rgba(255,255,255,0.08)"
            title={t('board.startup.title', { time: formatClock(startRemainingMs) })}
          />
          {/*
            底部那行只属于准点模式 —— 它写的是"赛程表上几点开球"。
            倒计时模式没有"几点"这回事(那是相对时长),写出来只会是假信息。
          */}
          {startMode === 'scheduled' && match.startTime ? (
            <div className="su-at">{t('board.startup.at', { time: match.startTime })}</div>
          ) : null}
          {match.court ? <div className="su-court">{match.court}</div> : null}
        </div>
      ) : null}

      {/*
        暂停倒计时:盖在画面中央的卡片。
        边框用请求方的队色 —— 观众一眼就知道是谁叫的暂停。
      */}
      {timeoutActive ? (
        <div
          className="board-timeout"
          style={cssVars({ '--team-color': timeoutTeam?.color ?? accent })}
        >
          <div className="to-label">{t('board.timeout.request', { team: timeoutTeam?.name ?? '' })}</div>
          <SevenSegment
            value={formatSeconds(timeoutRemainingMs)}
            height={150}
            color={accent}
            dimColor="rgba(255,255,255,0.08)"
            title={t('board.timeout.title', { time: formatSeconds(timeoutRemainingMs) })}
          />
        </div>
      ) : null}

      {offline ? <div className="board-offline" title={t('board.offline.title')} /> : null}

      {/*
        页脚落款(提供方署名)。
        放在画布最底部而不是页面底部 —— 这样它跟着 1920×1080 一起缩放,
        投影到任何分辨率的大屏上位置和字号都一致。
      */}
      <div className="board-footer">{t('footer.poweredBy')}</div>
    </>
  );
}

export default BoardCore;
