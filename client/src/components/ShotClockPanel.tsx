/**
 * 进攻钟面板:24 秒倒计时。
 *
 * 规则上进攻钟随球权走 —— 比赛钟启动它跟着启动,比赛钟停它跟着停
 * (这条联动在服务端做,面板只负责显示与手动操作)。
 *
 * rules.useShotClock === false 时整块隐藏(由调用方决定)。
 */
import { useI18n } from '../i18n';
import { formatSeconds } from '../lib/format';
import { ConfirmButton } from './ConfirmButton';
import { SevenSegment } from './SevenSegment';
import { IconPause, IconPlay } from './icons';

export interface ShotClockPanelProps {
  remainingMs: number;
  running: boolean;
  /** 规则里的进攻钟秒数(用于"重置回 N 秒") */
  durationSeconds: number;
  onToggle: () => void;
  onAdjust: (deltaSeconds: number) => void;
  onReset: () => void;
  /**
   * 复位到规则时长并直接开表。
   *
   * 这是现场最常用的一下:投篮命中、进攻权还在原地 → 一次点完就重新计时,
   * 不用"先重置、再点开始"两下。
   */
  onResetAndStart?: () => void;
  /**
   * 复位到 14 秒并开表。
   *
   * 抢到进攻篮板、进攻权不变时用(FIBA 2014 起:进攻篮板后重置 14 秒)。
   */
  onReset14?: () => void;
  /**
   * 确认 24 秒违例:球权转给对方 + 进攻钟复位。
   *
   * 进攻钟归零时服务端已经自动停了表、记了日志、让大屏提示;
   * 这一步是计分员确认"球不在空中、确实是违例"之后按的。
   * 所以它是破坏性操作 —— 要二次确认。
   */
  onViolation?: () => void;
  disabled?: boolean;
}

export function ShotClockPanel({
  remainingMs,
  running,
  durationSeconds,
  onToggle,
  onAdjust,
  onReset,
  onResetAndStart,
  onReset14,
  onViolation,
  disabled = false,
}: ShotClockPanelProps) {
  const { t } = useI18n();
  const low = remainingMs > 0 && remainingMs <= 5_000;
  const color = low ? '#ff4d5e' : running ? '#ffb020' : '#9aa6c0';

  return (
    <div className={low ? 'clock-panel urgent' : 'clock-panel'}>
      <div className="panel-label">{t('shot.label', { n: durationSeconds })}</div>

      <div className="seg-wrap">
        <SevenSegment
          value={formatSeconds(remainingMs)}
          height={58}
          color={color}
          dimColor="rgba(255,255,255,0.07)"
          title={t('shot.title', { time: formatSeconds(remainingMs) })}
        />
      </div>

      <button
        type="button"
        className={running ? 'clock-toggle on' : 'clock-toggle off'}
        style={{ minHeight: 64, fontSize: 22 }}
        onClick={onToggle}
        disabled={disabled}
        title={t('shot.toggle.title')}
      >
        {running ? <IconPause size={26} /> : <IconPlay size={26} />}
        {running ? t('clock.pause') : t('clock.start')}
      </button>

      <div className="step-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <button type="button" className="step-btn plus" disabled={disabled} onClick={() => onAdjust(1)}>
          +1
        </button>
        <button type="button" className="step-btn plus" disabled={disabled} onClick={() => onAdjust(5)}>
          +5
        </button>
        <button type="button" className="step-btn minus" disabled={disabled} onClick={() => onAdjust(-1)}>
          −1
        </button>
        <button type="button" className="step-btn minus" disabled={disabled} onClick={() => onAdjust(-5)}>
          −5
        </button>
      </div>

      {/* 常用操作:复位并开表 / 14 秒 */}
      {onResetAndStart || onReset14 ? (
        <div className="clock-sub-row">
          {onResetAndStart ? (
            <button
              type="button"
              className="btn primary"
              disabled={disabled}
              onClick={onResetAndStart}
              title={t('shot.resetStart.title', { n: durationSeconds })}
            >
              {t('shot.resetStart')}
            </button>
          ) : null}
          {onReset14 ? (
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={onReset14}
              title={t('shot.reset14.title')}
            >
              {t('shot.reset14')}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 破坏性:重置 / 确认违例 */}
      <div className="clock-sub-row">
        <ConfirmButton
          label={t('shot.reset', { n: durationSeconds })}
          variant="danger"
          disabled={disabled}
          onConfirm={onReset}
          title={t('shot.reset.title')}
        />
        {onViolation ? (
          <ConfirmButton
            label={t('shot.violation')}
            variant="danger"
            disabled={disabled}
            onConfirm={onViolation}
            title={t('shot.violation.title')}
          />
        ) : null}
      </div>
    </div>
  );
}

export default ShotClockPanel;
