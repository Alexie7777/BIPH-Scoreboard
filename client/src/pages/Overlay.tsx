/**
 * OBS 叠加层(/m/:id/overlay)—— 直播画面上叠的那块记分条。
 *
 * 【和大屏(Display)的关系】
 * 这一页就是大屏的简化版:数据、计时口径全部照抄大屏那套,
 * 不另起炉灶。
 *   - useMatch({ role: 'display' }) 拿只读的比赛状态(公开可访问);
 *   - useTicker 每帧用 remainingMs(锚点, 服务器时间) 在本地推算,
 *     所以断网时比赛钟照样走秒 —— 直播最怕的就是网络一抖时间就停;
 *   - 篮球显示【剩余】,足球显示【已用】(与大屏 BoardCore 完全一致)。
 *
 * 【和大屏的差别只有两处】
 *   1. 页面背景完全透明:OBS「浏览器源」抠掉背景后,只剩这块记分条;
 *   2. 固定贴画面左下角,按 820×148 的设计画布等比缩放:
 *      scale = min(min(窗口宽,820)/820, min(窗口高,148)/148)。
 *      avail 取设计尺寸的上限,是为了让小尺寸的浏览器源能填满整个源,
 *      而 1920×1080 的全画布源里它就是左下角的一枚小角标。
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Match, Team } from '@biph/shared';
import { isFootball } from '@biph/shared';
import { SevenSegment } from '../components/SevenSegment';
import { readableAccent } from '../lib/colors';
import { cssVars } from '../lib/cssVars';
import { formatAddedTime, formatClock, periodDurationMs, remainingMs } from '../lib/format';
import { sportEmoji } from '../lib/sports';
import { useMatch } from '../lib/useMatch';
import { useTicker } from '../lib/useTicker';
import { setScopedLocale, useI18n } from '../i18n';
import '../styles/overlay.css';

/** 设计画布尺寸(记分条按这个尺寸排版,再整体缩放) */
const DESIGN_W = 820;
const DESIGN_H = 148;

/**
 * 挂到 <html> 上的标记类。
 *
 * 只有这一页在的时候才把 body 底色压成透明,
 * 管理台/控制台的深色底不受影响。
 */
const ACTIVE_CLASS = 'ov-active';

/** 一侧的队伍:队徽 + 队名简称 + 比分 */
function TeamSide({ team, away }: { team: Team; away?: boolean }) {
  const logo = team.logoUrl ? (
    <div className="ov-logo">
      <img className="ov-logo-img" src={team.logoUrl} alt="" />
    </div>
  ) : null;
  const name = (
    <div className="ov-name" title={team.name}>
      {team.shortName || team.name}
    </div>
  );
  const score = <div className="ov-score">{team.score}</div>;

  return (
    <div
      className={away ? 'ov-team ov-team--away' : 'ov-team'}
      style={cssVars({ '--team-color': readableAccent(team.color) })}
    >
      {/* 主队从左往右、客队从右往左:两边的比分都贴着中间的比分区 */}
      {away ? (
        <>
          {score}
          {name}
          {logo}
        </>
      ) : (
        <>
          {logo}
          {name}
          {score}
        </>
      )}
    </div>
  );
}

export default function Overlay() {
  const { id } = useParams<{ id: string }>();
  const matchId = id ?? '';
  const { t } = useI18n();

  const { match, serverNow } = useMatch({ matchId, role: 'display' });

  /* ------------------------------------------------------ 锚点 + 服务器时间 */
  // 和大屏一样:ref 里存最新状态,ticker 里按帧推算,断网照常走秒。
  const matchRef = useRef<Match | null>(null);
  const serverNowRef = useRef<() => number>(() => Date.now());
  matchRef.current = match;
  serverNowRef.current = serverNow;

  /** 比赛钟剩余毫秒 */
  const [clockMs, setClockMs] = useState(0);
  /** 补时剩余毫秒(足球) */
  const [addedMs, setAddedMs] = useState(0);
  /** 中场倒计时剩余毫秒(足球) */
  const [halftimeMs, setHalftimeMs] = useState(0);

  useTicker(() => {
    const m = matchRef.current;
    if (!m) return;
    const now = serverNowRef.current();
    const c = remainingMs(m.clock, now);
    const a = m.addedTime ? remainingMs(m.addedTime, now) : 0;
    const h = m.halftime ? remainingMs(m.halftime, now) : 0;
    // 只在显示出来的秒数变了才 setState,免得每帧都重渲染
    setClockMs((prev) => (formatClock(prev) !== formatClock(c) ? c : prev));
    setAddedMs((prev) => (prev !== a ? a : prev));
    setHalftimeMs((prev) => (prev !== h ? h : prev));
  });

  /* ------------------------------------------------------ 缩放 */
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const apply = () => {
      // avail 的上限就是设计尺寸:小源填满,大源保持左下角小角标
      const availW = Math.min(window.innerWidth, DESIGN_W);
      const availH = Math.min(window.innerHeight, DESIGN_H);
      const s = Math.min(availW / DESIGN_W, availH / DESIGN_H);
      setScale(s > 0 ? s : 1);
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);

  /* ------------------------------------------------------ 页面底色压成透明 */
  // 离开这一页时摘掉标记,别的页面照旧是深色底。
  useEffect(() => {
    document.documentElement.classList.add(ACTIVE_CLASS);
    return () => document.documentElement.classList.remove(ACTIVE_CLASS);
  }, []);

  /* ------------------------------------------------------ 跟随本场语言 */
  // 计分员在控制台切语言 → 语言写进本场配置 → 服务端广播 → 叠加层跟着切。
  useEffect(() => {
    setScopedLocale(match?.presentation.locale ?? null);
  }, [match?.presentation.locale]);
  useEffect(() => () => setScopedLocale(null), []);

  /* ------------------------------------------------------ 没有数据 */
  // 一行极简提示就够 —— 这会儿本来也没什么可显示的,不该挡住整个画面。
  if (!match) {
    return (
      <div className="ov-root">
        <div className="ov-hint">{t('overlay.connecting')}</div>
      </div>
    );
  }

  /*
   * 比赛钟口径与大屏 BoardCore 一致:
   *   - 篮球:显示剩余(45:00 → 00:00 往下走);
   *   - 足球:显示已用(本节总时长 − 剩余,夹在 [0, 总时长] 里)。
   * 两边的锚点模型相同(都存"剩余"),所以服务端与客户端算得一致。
   */
  const football = isFootball(match);
  const clockTotal = periodDurationMs(match.rules);
  const clockShown = football
    ? Math.max(0, Math.min(clockTotal, clockTotal - clockMs))
    : clockMs;
  const periodLabel = match.clock.periodLabel || (football ? '1H' : 'Q1');

  /** 中场休息:存在 halftime 锚点就算在休息中(哪怕倒计时还没开表) */
  const inHalftime = football && !!match.halftime;
  /** 补时只在还剩时间的时候显示 */
  const showAdded = football && addedMs > 0;

  return (
    <div className="ov-root" style={cssVars({ '--ov-scale': scale })}>
      <div className="ov-bar">
        <TeamSide team={match.home} />

        <div className="ov-center">
          <div className="ov-clock">
            <SevenSegment
              value={formatClock(clockShown)}
              height={54}
              color="#ffb020"
              dimColor="rgba(255,255,255,0.08)"
              title={t('board.clockTitle', { time: formatClock(clockShown) })}
            />
          </div>

          <div className="ov-status">
            {inHalftime ? (
              <>
                <span className="ov-pill">{t('board.halftime')}</span>
                <span
                  className="ov-htime"
                  title={t('board.halftime.title', { time: formatClock(halftimeMs) })}
                >
                  {formatClock(halftimeMs)}
                </span>
              </>
            ) : (
              <span className="ov-pill">{periodLabel}</span>
            )}

            <span className="ov-sport">
              {sportEmoji(match.sport)} {t(football ? 'sport.football' : 'sport.basketball')}
            </span>

            {showAdded ? (
              <span
                className="ov-added"
                title={t('board.addedTime.title', { time: formatAddedTime(addedMs) })}
              >
                {formatAddedTime(addedMs)}
              </span>
            ) : null}
          </div>
        </div>

        <TeamSide team={match.away} away />
      </div>
    </div>
  );
}
