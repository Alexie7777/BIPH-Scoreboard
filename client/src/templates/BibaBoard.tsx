/**
 * 「总决赛」大屏模板 —— 电竞转播风。
 *
 * 版式照着 BIBA SEMIFINALS 的转播画面做的,和前三套模板最大的不同是
 * **信息是竖着堆在中间的**:
 *
 *        赛事 logo(皇冠 + 笔刷字)
 *              ↓
 *        金色斜切框:比赛钟 + 节次
 *              ↓
 *        两个斜切比分框(主队蓝 / 客队金)+ 中间一列圆点
 *
 * 队名退到两侧中线位置,两侧各有一队主视觉插画(鲨鱼 / 虎鲸),
 * 犯规与暂停收到最底下一条横栏里。
 *
 * 三件事说明一下:
 *
 * 1. **数据口径不重新算**。比分、时钟、犯规、暂停全部走 boardData
 *    (和简洁 / LED / 现代转播同一份纯函数),这块只管长什么样。
 *
 * 2. **插画是本地素材**,不联网也不依赖外链:
 *    public/biba-art-left.jpg、biba-art-right.jpg、biba-crown.png、biba-wordmark.png。
 *    前两张用 screen 混合模式叠在深底上,黑的地方自然透掉,边缘用遮罩淡出。
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

/** 主队侧:蓝 */
const HOME_COLOR = '#2ea3ff';
/** 客队侧:金 */
const AWAY_COLOR = '#ffc400';

/**
 * 把赛事名拆成"笔刷字素材 + 实时文字"两半。
 *
 * 中央那块 "BIBA" 是固定素材(参考图里的笔刷字),赛事名里开头的那段
 * 由素材承担,剩下的(SEMIFINALS / FINALS / 2026 …)实时显示 ——
 * 这样同一块屏既能打半决赛也能打总决赛,不用换图。
 *
 * 赛事名里没有 "BIBA" 开头时(比如"校内联赛")就不出笔刷字,
 * 整串都实时显示 —— 免得顶着别家联赛的 logo。
 */
function splitLogoText(title: string): { wordmark: boolean; rest: string } {
  const trimmed = title.trim();
  const m = /^BIBA\b/i.exec(trimmed);
  if (!m) return { wordmark: false, rest: trimmed };
  return { wordmark: true, rest: trimmed.slice(m[0].length).trim() };
}

export function BibaBoard({ stretch, ...rest }: BoardProps) {
  const { t } = useI18n();
  const d = computeBoardData(rest, '#ffffff');
  const { match } = rest;
  const { home, away, rules, presentation } = match;

  const { wordmark, rest: logoText } = splitLogoText(d.title);
  // 赛事名里第一段用蓝、第二段用白(参考图就是这个配色:SEMIFINALS 蓝、2026 白)
  const [logoLead, ...logoTail] = logoText ? logoText.split(/\s+/) : [];
  const logoTailText = logoTail.join(' ');

  const startLabel = rest.startRemainingMs > 0 ? t('board.startup.label') : t('board.startup.tipoff');
  // 中场倒计时是可选字段,老库里没有 —— 缺了就当 0
  const halftimeRemainingMs = rest.halftimeRemainingMs ?? 0;

  return (
    <div className={`board-canvas tpl-biba${stretch ? ' stretch' : ''}`}>
      {/* ---------------- 背景层:光晕 + 网格 + 两侧插画 ---------------- */}
      <div className="biba-bg" aria-hidden="true">
        <div className="biba-glow biba-glow--blue" />
        <div className="biba-glow biba-glow--gold" />
        <div className="biba-shaft" />
        <div className="biba-grid" />
        <div className="biba-art biba-art--home" />
        <div className="biba-art biba-art--away" />
      </div>

      {/* ---------------- 顶栏 ---------------- */}
      <div className="biba-header">
        <div className="biba-head-left">
          <div className="biba-head-title">{d.title}</div>
          <div className="biba-head-underline" />
        </div>
        {d.showSponsor ? (
          <div className="biba-head-right">
            {presentation.sponsorName ? <div className="biba-brand">{presentation.sponsorName}</div> : null}
            {presentation.sponsorText ? <div className="biba-brand-sub">{presentation.sponsorText}</div> : null}
          </div>
        ) : null}
      </div>

      {/* ---------------- 中央竖排主视觉 ---------------- */}
      <div className="biba-stage">
        <div className="biba-logo">
          <img className="biba-crown" src="/biba-crown.png" alt="" />
          {wordmark ? <img className="biba-wordmark" src="/biba-wordmark.png" alt="" /> : null}
          {logoText ? (
            <div className="biba-logo-sub">
              <span className="biba-sub-lead">{logoLead}</span>
              {logoTailText ? <span className="biba-sub-tail">{logoTailText}</span> : null}
            </div>
          ) : null}
        </div>

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

        {/* 两侧队名 + 中间两个比分框,分属网格的三列 */}
        {/* 主队:左侧 */}
        <div className="biba-team biba-team--home">
            <div className="biba-team-bar" style={cssVars({ '--team-color': HOME_COLOR })} />
            <div className="biba-team-name">
              {home.logoUrl ? <img className="biba-team-logo" src={home.logoUrl} alt="" /> : null}
              <span className="biba-team-name-text">{home.name}</span>
              {match.possession === 'home' && rules.showPossession !== false ? (
                <span className="biba-poss">
                  <IconChevron size={26} />
                </span>
              ) : null}
            </div>
          </div>

          {/* 两个比分框 + 中间一列圆点 */}
          <div className="biba-scores">
            <div className="biba-frame biba-frame--blue biba-score-frame">
              <div className="biba-frame-face" />
              <div className="biba-score-num">{home.score}</div>
            </div>
            <div className="biba-dots">
              <i />
              <i />
            </div>
            <div className="biba-frame biba-frame--gold biba-score-frame">
              <div className="biba-frame-face" />
              <div className="biba-score-num">{away.score}</div>
            </div>
          </div>

          {/* 客队:右侧 */}
          <div className="biba-team biba-team--away">
            <div className="biba-team-bar" style={cssVars({ '--team-color': AWAY_COLOR })} />
            <div className="biba-team-name">
              {away.logoUrl ? <img className="biba-team-logo" src={away.logoUrl} alt="" /> : null}
              <span className="biba-team-name-text">{away.name}</span>
              {match.possession === 'away' && rules.showPossession !== false ? (
                <span className="biba-poss">
                  <IconChevron size={26} />
                </span>
              ) : null}
            </div>
          </div>
      </div>

      {/* ---------------- 底部横栏:犯规 / 暂停 ---------------- */}
      <div className="biba-bottom">
        <div className="biba-bottom-row">
          <div className="biba-stat-group" style={cssVars({ '--team-color': HOME_COLOR })}>
            <span className="biba-stat-name">{home.name}</span>
            {rules.showTeamFouls ? (
              <span className="biba-stat">
                {t('board.fouls')} <b>{home.fouls}</b>
              </span>
            ) : null}
            {rules.showTimeouts ? (
              <span className="biba-stat">
                {t('board.timeouts')} <b>{home.timeouts}</b>
                {rules.timeoutsPerTeam > 0 ? <span className="biba-stat-dim">/{rules.timeoutsPerTeam}</span> : null}
              </span>
            ) : null}
            {d.homeBonus ? <span className="biba-bonus">BONUS</span> : null}
          </div>

          <div className="biba-bottom-divider" />

          <div className="biba-stat-group" style={cssVars({ '--team-color': AWAY_COLOR })}>
            <span className="biba-stat-name">{away.name}</span>
            {rules.showTeamFouls ? (
              <span className="biba-stat">
                {t('board.fouls')} <b>{away.fouls}</b>
              </span>
            ) : null}
            {rules.showTimeouts ? (
              <span className="biba-stat">
                {t('board.timeouts')} <b>{away.timeouts}</b>
                {rules.timeoutsPerTeam > 0 ? <span className="biba-stat-dim">/{rules.timeoutsPerTeam}</span> : null}
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
            dimColor="rgba(255,255,255,0.10)"
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
            dimColor="rgba(255,255,255,0.10)"
            title={t('board.halftime.title', { time: formatClock(halftimeRemainingMs) })}
          />
          <div className="biba-overlay-sub">
            {halftimeRemainingMs > 0 ? t('board.halftime.hint') : t('board.halftime.wait')}
          </div>
        </div>
      ) : null}

      {d.timeoutActive ? (
        <div className="biba-overlay biba-overlay--timeout" style={cssVars({ '--team-color': d.timeoutTeam?.color ?? HOME_COLOR })}>
          <div className="biba-overlay-label">{t('board.timeout.request', { team: d.timeoutTeam?.name ?? '' })}</div>
          <SevenSegment
            value={formatSeconds(rest.timeoutRemainingMs)}
            height={150}
            color="#ffffff"
            dimColor="rgba(255,255,255,0.10)"
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
