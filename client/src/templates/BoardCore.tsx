/**
 * 大屏的共享渲染逻辑。
 *
 * 三个模板(simple / led / broadcast)共用这一套 DOM,只靠 CSS 变量与
 * 少量类名区分风格,避免三份重复代码各自漂移。
 *
 * 所有尺寸都是【设计画布 1920×1080 坐标系】里的 px 值,
 * 整块画布由 Display 页统一 scale。
 *
 * 数据口径全部来自 boardData(纯函数),这套模板只负责"长什么样"。
 */
import { useI18n } from '../i18n';
import { SevenSegment } from '../components/SevenSegment';
import { IconChevron } from '../components/icons';
import { cssVars } from '../lib/cssVars';
import { readableAccent } from '../lib/colors';
import { formatClock, formatSeconds } from '../lib/format';
import { computeBoardData, type BoardProps } from './boardData';

export type { BoardProps };

export interface BoardCoreProps extends BoardProps {
  /** 点亮色(随模板变化) */
  accent: string;
}

export function BoardCore(props: BoardCoreProps) {
  const { match, offline, accent } = props;
  const d = computeBoardData(props, accent);
  const { rules, presentation, home, away } = match;
  const { t } = useI18n();

  const showShot = d.showShot;
  const shotLow = d.shotLow;

  // 补时与中场倒计时是可选字段,老库里没有 —— 缺了就当 0
  const addedTimeRemainingMs = props.addedTimeRemainingMs ?? 0;
  const halftimeRemainingMs = props.halftimeRemainingMs ?? 0;

  const startLabel = props.startRemainingMs > 0 ? t('board.startup.label') : t('board.startup.tipoff');

  return (
    <>
      <div className="board-top">
        <div className="board-title">{d.title}</div>
        {d.showSponsor ? (
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
            {match.possession === 'home' && rules.showPossession !== false ? (
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
          <div className="period">{d.periodLabel}</div>
          <SevenSegment
            value={formatClock(d.clockShown)}
            height={190}
            color={d.clockColor}
            dimColor="rgba(255,255,255,0.08)"
            title={t('board.clockTitle', { time: formatClock(d.clockShown) })}
          />
          {/*
            补时表(足球):主钟停在 45:00 不动,这块单独走。
            "+" 号用文字画 —— 七段数码管只认数字与冒号。
          */}
          {d.showAddedTime ? (
            <div className="added-wrap">
              <span className="added-sign">+</span>
              <SevenSegment
                value={formatClock(addedTimeRemainingMs)}
                height={64}
                color={accent}
                dimColor="rgba(255,255,255,0.08)"
                title={t('board.addedTime.title', { time: formatClock(addedTimeRemainingMs) })}
              />
            </div>
          ) : null}
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
                value={formatSeconds(props.shotRemainingMs)}
                height={86}
                color={d.shotColor}
                dimColor="rgba(255,255,255,0.08)"
                title={t('board.shotTitle', { time: formatSeconds(props.shotRemainingMs) })}
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
            {match.possession === 'away' && rules.showPossession !== false ? (
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

        {d.homeBonus ? <span className="badge bonus">BONUS · {home.shortName || home.name}</span> : null}
        {d.awayBonus ? <span className="badge bonus">BONUS · {away.shortName || away.name}</span> : null}
      </div>

      {d.isFinal ? <div className="board-final">{d.periodLabel}</div> : null}

      {/*
        开赛倒计时:开赛前 3 分钟铺满整个画面。
        放在画布内(而不是画布外的待机层),这样它跟着 1920×1080 一起缩放 ——
        4:3 投影仪和 16:9 大屏上,倒计时一样大。
      */}
      {d.startActive ? (
        <div className="board-startup">
          <div className="su-event">{d.title}</div>
          <div className="su-label">{startLabel}</div>
          <SevenSegment
            value={formatClock(props.startRemainingMs)}
            height={200}
            color={d.startUrgent ? '#ff4d5e' : accent}
            dimColor="rgba(255,255,255,0.08)"
            title={t('board.startup.title', { time: formatClock(props.startRemainingMs) })}
          />
          {/*
            底部那行只属于准点模式 —— 它写的是"赛程表上几点开球"。
            倒计时模式没有"几点"这回事(那是相对时长),写出来只会是假信息。
          */}
          {props.startMode === 'scheduled' && match.startTime ? (
            <div className="su-at">{t('board.startup.at', { time: match.startTime })}</div>
          ) : null}
          {match.court ? <div className="su-court">{match.court}</div> : null}
        </div>
      ) : null}

      {/*
        中场休息屏(足球):整屏显示中场倒计时。
        与开赛倒计时一样放在画布内 —— 跟着 1920×1080 一起缩放,
        投影仪和 LED 屏上一样大。

        归零之后画面留着(显示 00:00 +「等计分员开表」)——
        什么时候开下半场由计分员按,屏幕不替他做主。
      */}
      {d.inHalftime ? (
        <div className="board-halftime">
          <div className="hf-event">{d.title}</div>
          <div className="hf-label">{t('board.halftime')}</div>
          <SevenSegment
            value={formatClock(halftimeRemainingMs)}
            height={200}
            color={accent}
            dimColor="rgba(255,255,255,0.08)"
            title={t('board.halftime.title', { time: formatClock(halftimeRemainingMs) })}
          />
          <div className="hf-hint">
            {halftimeRemainingMs > 0 ? t('board.halftime.hint') : t('board.halftime.wait')}
          </div>
          {match.court ? <div className="hf-court">{match.court}</div> : null}
        </div>
      ) : null}

      {/*
        暂停倒计时:盖在画面中央的卡片。
        边框用请求方的队色 —— 观众一眼就知道是谁叫的暂停。
      */}
      {d.timeoutActive ? (
        <div className="board-timeout" style={cssVars({ '--team-color': d.timeoutTeam?.color ?? accent })}>
          <div className="to-label">{t('board.timeout.request', { team: d.timeoutTeam?.name ?? '' })}</div>
          <SevenSegment
            value={formatSeconds(props.timeoutRemainingMs)}
            height={150}
            color={accent}
            dimColor="rgba(255,255,255,0.08)"
            title={t('board.timeout.title', { time: formatSeconds(props.timeoutRemainingMs) })}
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
