/**
 * 「总决赛(电竞风)」大屏模板 —— 电竞转播风。
 *
 * 版式(1920×1080 设计画布):
 *
 *        [皇冠]
 *          BIBA                    ← 场馆/品牌(赞助商名)
 *     ─── BIBA FINALS ───         ← 赛事名(顶栏标题),金黄
 *      MEGS   vs   ORCAS          ← 对阵行,两队各用队色
 *        ╔══════════╗             ← 金色斜切框:比赛钟 + 节次
 *        ║ 10:00 Q1 ║
 *        ╚══════════╝
 *  MEGALODONS  ╔════╗   ╔════╗   ORCAS
 *  MEGS        ║ 0  ║ : ║ 0  ║   ORCAS
 *  ~~~~~~~     ╚════╝   ╚════╝   ~~~~~~~
 *
 *  ────────────────────────────────────────────
 *   MEGS FOULS 0 TIMEOUTS 4/4 │ ORCAS FOULS 0 TIMEOUTS 4/4
 *
 * 三件事说明一下:
 *
 * 1. **数据口径不重新算**。比分、时钟、犯规、暂停全部走 boardData
 *    (和简洁 / LED / 现代转播同一份纯函数),这块只管长什么样。
 *
 * 2. **插画是本地素材**,不联网也不依赖外链:
 *    public/biba-art-left.jpg、biba-art-right.jpg、biba-crown.png。
 *    前两张用 screen 混合模式叠在深底上,黑的地方自然透掉,边缘的渐隐
 *    是**烤进图片**的(像素乘暗 = 淡出),不挑浏览器版本。
 *
 * 3. **进攻钟默认不显示**。本场勾掉「使用进攻钟」时这块完全不出现;
 *    万一哪场要用,它会缩在主钟框左侧的小窗里(和真转播一样)。
 */
import { formatClock, formatSeconds } from '@biph/shared';
import { useI18n } from '../i18n';
import { SevenSegment } from '../components/SevenSegment';
import { IconChevron } from '../components/icons';
import { cssVars } from '../lib/cssVars';
import { computeBoardData, type BoardProps } from './boardData';

/** 主队侧:洋红 */
const HOME_COLOR = '#ff45a8';
/** 客队侧:青蓝 */
const AWAY_COLOR = '#22d9f0';
/** 中央标题:金黄 */
const GOLD_COLOR = '#fce87a';

/** 队名底下那道弧形色带 */
function Swoosh({ id, color }: { id: string; color: string }) {
  return (
    <svg className="biba-swoosh" viewBox="0 0 420 52" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.05" />
          <stop offset="26%" stopColor={color} stopOpacity="0.9" />
          <stop offset="62%" stopColor={color} stopOpacity="1" />
          <stop offset="88%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <path d="M0 38 C 110 46 250 22 420 4 L 420 20 C 270 32 130 52 0 50 Z" fill={`url(#${id})`} />
    </svg>
  );
}

export function BibaBoard({ stretch, ...rest }: BoardProps) {
  const { t } = useI18n();
  const d = computeBoardData(rest, '#ffffff');
  const { match } = rest;
  const { home, away, rules, presentation } = match;

  /*
   * 队名有两个层次:
   *   - 大字 = 简称(`shortName`),比分框旁边那个大字就是它;
   *   - 小字 = 全名(`name`),大字上面那一行字母间距很宽的小字。
   * 简称没配时退回全名(不能空着)。
   */
  const homeShort = home.shortName || home.name;
  const awayShort = away.shortName || away.name;

  const startLabel = rest.startRemainingMs > 0 ? t('board.startup.label') : t('board.startup.tipoff');
  // 中场倒计时是可选字段,老库里没有 —— 缺了就当 0
  const halftimeRemainingMs = rest.halftimeRemainingMs ?? 0;

  return (
    <div className={`board-canvas tpl-biba${stretch ? ' stretch' : ''}`}>
      {/* ---------------- 背景层:能量光晕 + 两侧插画 ---------------- */}
      <div className="biba-bg" aria-hidden="true">
        <div className="biba-glow biba-glow--home" />
        <div className="biba-glow biba-glow--away" />
        <div className="biba-shaft" />
        <div className="biba-grid" />
        <div className="biba-art biba-art--home" />
        <div className="biba-art biba-art--away" />
      </div>

      {/* ---------------- 中央竖排主视觉 ---------------- */}
      <div className="biba-stage">
        {/* 赛事标识:皇冠 + 场馆名 + 赛事名 */}
        <div className="biba-logo">
          <img className="biba-crown" src="/biba-crown.png" alt="" />
          {presentation.sponsorName ? <div className="biba-brand">{presentation.sponsorName}</div> : null}
          <div className="biba-event">
            <i className="biba-event-line" />
            <span className="biba-event-text">{d.title}</span>
            <i className="biba-event-line" />
          </div>
        </div>

        {/* 对阵行 */}
        <div className="biba-versus">
          <span className="biba-versus-side biba-versus-side--home">{homeShort}</span>
          <span className="biba-versus-vs">vs</span>
          <span className="biba-versus-side biba-versus-side--away">{awayShort}</span>
        </div>

        {/* 比赛钟 */}
        <div className="biba-clock-row">
          <div className="biba-frame biba-frame--gold">
            <div className="biba-frame-face" />
            {d.showShot ? (
              <div className="biba-shot">
                <div className="biba-shot-label">{t('board.shot')}</div>
                <SevenSegment
                  value={formatSeconds(rest.shotRemainingMs)}
                  height={52}
                  color={d.shotColor}
                  dimColor="rgba(255,255,255,0.10)"
                  title={t('board.shotTitle', { time: formatSeconds(rest.shotRemainingMs) })}
                />
              </div>
            ) : null}
            <div className="biba-clock-content">
              <SevenSegment
                value={formatClock(d.clockShown)}
                height={92}
                color={d.clockColor}
                dimColor="rgba(255,255,255,0.02)"
                title={t('board.clockTitle', { time: formatClock(d.clockShown) })}
              />
              <div className="biba-period">{d.periodLabel}</div>
            </div>
          </div>
        </div>

        {/* 两个比分框 + 中间的冒号 */}
        <div className="biba-scores">
          <div className="biba-frame biba-frame--home biba-score-frame">
            <div className="biba-frame-face" />
            <div className="biba-score-num">{home.score}</div>
          </div>
          <div className="biba-colon">
            <i />
            <i />
          </div>
          <div className="biba-frame biba-frame--away biba-score-frame">
            <div className="biba-frame-face" />
            <div className="biba-score-num">{away.score}</div>
          </div>
        </div>

        {/* 左侧队名 */}
        <div className="biba-team biba-team--home" style={cssVars({ '--team-color': HOME_COLOR })}>
          <div className="biba-team-bar" />
          <div className="biba-team-name-row">
            <div className="biba-team-full">{home.name}</div>
            <div className="biba-team-short">
              {home.logoUrl ? <img className="biba-team-logo" src={home.logoUrl} alt="" /> : null}
              <span>{homeShort}</span>
              {match.possession === 'home' && rules.showPossession !== false ? (
                <span className="biba-poss">
                  <IconChevron size={28} />
                </span>
              ) : null}
            </div>
          </div>
          <Swoosh id="biba-swoosh-home" color={HOME_COLOR} />
        </div>

        {/* 右侧队名 */}
        <div className="biba-team biba-team--away" style={cssVars({ '--team-color': AWAY_COLOR })}>
          <div className="biba-team-bar" />
          <div className="biba-team-name-row">
            <div className="biba-team-full">{away.name}</div>
            <div className="biba-team-short">
              {away.logoUrl ? <img className="biba-team-logo" src={away.logoUrl} alt="" /> : null}
              <span>{awayShort}</span>
              {match.possession === 'away' && rules.showPossession !== false ? (
                <span className="biba-poss">
                  <IconChevron size={28} />
                </span>
              ) : null}
            </div>
          </div>
          <Swoosh id="biba-swoosh-away" color={AWAY_COLOR} />
        </div>
      </div>

      {/* ---------------- 底部横栏:犯规 / 暂停 ---------------- */}
      <div className="biba-bottom">
        <div className="biba-bottom-rule" />
        <div className="biba-bottom-row">
          <div className="biba-stat-group" style={cssVars({ '--team-color': HOME_COLOR })}>
            <span className="biba-stat-name">{homeShort}</span>
            {rules.showTeamFouls ? (
              <span className="biba-stat">
                {t('board.fouls')} <b>{home.fouls}</b>
              </span>
            ) : null}
            {rules.showTimeouts ? (
              <span className="biba-stat">
                {t('board.timeouts')} <b>{home.timeouts}</b>
                {rules.timeoutsPerTeam > 0 ? (
                  <span className="biba-stat-dim">/{rules.timeoutsPerTeam}</span>
                ) : null}
              </span>
            ) : null}
            {d.homeBonus ? <span className="biba-bonus">BONUS</span> : null}
          </div>

          <div className="biba-bottom-divider" />

          <div className="biba-stat-group" style={cssVars({ '--team-color': AWAY_COLOR })}>
            <span className="biba-stat-name">{awayShort}</span>
            {rules.showTeamFouls ? (
              <span className="biba-stat">
                {t('board.fouls')} <b>{away.fouls}</b>
              </span>
            ) : null}
            {rules.showTimeouts ? (
              <span className="biba-stat">
                {t('board.timeouts')} <b>{away.timeouts}</b>
                {rules.timeoutsPerTeam > 0 ? (
                  <span className="biba-stat-dim">/{rules.timeoutsPerTeam}</span>
                ) : null}
              </span>
            ) : null}
            {d.awayBonus ? <span className="biba-bonus">BONUS</span> : null}
          </div>
        </div>
      </div>

      {/* ---------------- 各种整屏覆盖层 ---------------- */}
      {d.isFinal ? <div className="biba-final">{d.periodLabel}</div> : null}

      {d.startActive ? (
        <div className="biba-overlay">
          <img className="biba-crown biba-crown--overlay" src="/biba-crown.png" alt="" />
          <div className="biba-overlay-title">{d.title}</div>
          <div className="biba-overlay-label">{startLabel}</div>
          <SevenSegment
            value={formatClock(rest.startRemainingMs)}
            height={170}
            color={d.startUrgent ? '#ff4d5e' : '#ffffff'}
            dimColor="rgba(255,255,255,0.02)"
            title={t('board.startup.title', { time: formatClock(rest.startRemainingMs) })}
          />
          {rest.startMode === 'scheduled' && match.startTime ? (
            <div className="biba-overlay-sub">{t('board.startup.at', { time: match.startTime })}</div>
          ) : null}
          {match.court ? <div className="biba-overlay-sub">{match.court}</div> : null}
        </div>
      ) : null}

      {d.inHalftime ? (
        <div className="biba-overlay">
          <div className="biba-overlay-title">{d.title}</div>
          <div className="biba-overlay-label">{t('board.halftime')}</div>
          <SevenSegment
            value={formatClock(halftimeRemainingMs)}
            height={170}
            color="#ffffff"
            dimColor="rgba(255,255,255,0.02)"
            title={t('board.halftime.title', { time: formatClock(halftimeRemainingMs) })}
          />
          <div className="biba-overlay-sub">
            {halftimeRemainingMs > 0 ? t('board.halftime.hint') : t('board.halftime.wait')}
          </div>
        </div>
      ) : null}

      {d.timeoutActive ? (
        <div
          className="biba-overlay biba-overlay--timeout"
          style={cssVars({ '--team-color': d.timeoutTeam?.color ?? HOME_COLOR })}
        >
          <div className="biba-overlay-label">{t('board.timeout.request', { team: d.timeoutTeam?.name ?? '' })}</div>
          <SevenSegment
            value={formatSeconds(rest.timeoutRemainingMs)}
            height={150}
            color="#ffffff"
            dimColor="rgba(255,255,255,0.02)"
            title={t('board.timeout.title', { time: formatSeconds(rest.timeoutRemainingMs) })}
          />
        </div>
      ) : null}

      {rest.offline ? <div className="board-offline" title={t('board.offline.title')} /> : null}

      <div className="board-footer biba-footer">{t('footer.poweredBy')}</div>
    </div>
  );
}

export default BibaBoard;
