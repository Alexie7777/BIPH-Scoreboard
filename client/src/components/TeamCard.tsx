/**
 * 队伍卡片:队名(带队色)+ 大比分 + 计分按钮 + 犯规 / 暂停计数。
 */
import type { MatchRules, Team } from '@biph/shared';
import { useI18n } from '../i18n';
import { cssVars } from '../lib/cssVars';
import { ScoreButton } from './ScoreButton';
import { IconChevron } from './icons';

export interface TeamCardProps {
  team: Team;
  rules: MatchRules;
  /** 该队是否持有进攻权 */
  hasPossession: boolean;
  onScore: (points: 1 | 2 | 3) => void;
  onScoreSub: () => void;
  onFoul: (delta: 1 | -1) => void;
  onTimeout: (delta: 1 | -1) => void;
  /** 请求暂停(大屏进入暂停倒计时) */
  onRequestTimeout: () => void;
  /** 继续比赛(结束本次暂停,大屏回到比赛计时器,计时器保持停止) */
  onResumeMatch: () => void;
  /** 该队当前是否正在暂停中 —— 此时按钮变成「继续比赛」 */
  timeoutActive?: boolean;
  /** 是否已有暂停在进行中(别的队叫的)—— 本队不能再请求 */
  timeoutLocked?: boolean;
  disabled?: boolean;
}

export function TeamCard({
  team,
  rules,
  hasPossession,
  onScore,
  onScoreSub,
  onFoul,
  onTimeout,
  onRequestTimeout,
  onResumeMatch,
  timeoutActive = false,
  timeoutLocked = false,
  disabled = false,
}: TeamCardProps) {
  const { t } = useI18n();
  const bonus = rules.bonusFouls > 0 && team.fouls >= rules.bonusFouls;
  // 暂停计数 = 剩余次数。用光了就不能再"用掉一次"。
  const timeoutUsedUp = team.timeouts <= 0;
  /*
   * 按钮有三种状态:
   *   - 本队正在暂停中 → 「继续比赛」,必须可点(哪怕额度已用完)
   *   - 别的队正在暂停 → 「请求暂停」置灰(服务端本来也会拒绝,不如直接不让点)
   *   - 正常 → 「请求暂停」,额度用完则置灰
   */
  const requestBlocked = disabled || (!timeoutActive && (timeoutUsedUp || timeoutLocked));
  const requestTitle = timeoutActive
    ? t('team.timeout.resume.title')
    : timeoutLocked
      ? t('team.timeout.locked')
      : timeoutUsedUp
        ? t('team.timeout.used')
        : t('team.timeout.request.title');

  return (
    <div className="team-card" style={cssVars({ '--team-color': team.color, '--team-text': team.textColor })}>
      <div className="team-head">
        {team.logoUrl ? <img className="logo" src={team.logoUrl} alt="" /> : null}
        <span className="name">{team.name}</span>
        {hasPossession ? <IconChevron size={26} aria-label={t('team.possession')} /> : null}
      </div>

      <div className="team-body">
        <div className="big-score">{team.score}</div>
        <div className="team-controls">
          <ScoreButton label="+1" onPress={() => onScore(1)} disabled={disabled} title={t('team.add1')} />
          <ScoreButton label="+2" onPress={() => onScore(2)} disabled={disabled} title={t('team.add2')} />
          <ScoreButton label="+3" onPress={() => onScore(3)} disabled={disabled} title={t('team.add3')} />
          <ScoreButton label="-1" variant="minus" onPress={onScoreSub} disabled={disabled} title={t('team.sub1')} />
          {/* 请求暂停 / 继续比赛:放在比分按钮正下方,现场一眼就能摸到 */}
          <button
            type="button"
            className={timeoutActive ? 'timeout-request active' : 'timeout-request'}
            disabled={requestBlocked}
            title={requestTitle}
            onPointerDown={() => {
              try {
                if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
              } catch {
                /* ignore */
              }
            }}
            onClick={timeoutActive ? onResumeMatch : onRequestTimeout}
          >
            {timeoutActive ? t('team.timeout.resume') : t('team.timeout.request')}
          </button>
        </div>
      </div>

      <div className="counters">
        <div className={bonus ? 'counter bonus' : 'counter'}>
          <span className="counter-label">{t('team.fouls')}</span>
          <button
            type="button"
            className="mini-btn"
            disabled={disabled}
            onPointerDown={() => {
              try {
                if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
              } catch {
                /* ignore */
              }
            }}
            onClick={() => onFoul(1)}
            title={t('team.foul.add')}
          >
            +
          </button>
          <span className="counter-value">
            {team.fouls}
            <span style={{ fontSize: 13, color: 'var(--text-faint)' }}> / {rules.bonusFouls}</span>
          </span>
          <button
            type="button"
            className="mini-btn"
            disabled={disabled}
            onClick={() => onFoul(-1)}
            title={t('team.foul.sub')}
          >
            −
          </button>
          {bonus ? <span className="badge bonus">BONUS</span> : null}
        </div>

        <div className="counter">
          <span className="counter-label">{t('team.timeouts')}</span>
          <button
            type="button"
            className="mini-btn"
            disabled={disabled || timeoutUsedUp}
            onPointerDown={() => {
              try {
                if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
              } catch {
                /* ignore */
              }
            }}
            onClick={() => onTimeout(1)}
            title={timeoutUsedUp ? t('team.timeout.used') : t('team.timeout.use')}
          >
            +
          </button>
          <span
            className="counter-value"
            title={t('team.timeout.remain', { n: team.timeouts, m: rules.timeoutsPerTeam })}
          >
            {team.timeouts}
            <span style={{ fontSize: 13, color: 'var(--text-faint)' }}> / {rules.timeoutsPerTeam}</span>
          </span>
          <button
            type="button"
            className="mini-btn"
            disabled={disabled}
            onClick={() => onTimeout(-1)}
            title={t('team.timeout.undo')}
          >
            −
          </button>
        </div>
      </div>
    </div>
  );
}

export default TeamCard;
