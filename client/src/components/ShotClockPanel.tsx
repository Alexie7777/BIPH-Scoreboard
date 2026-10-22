/**
 * 进攻钟面板:24 秒倒计时,独立于比赛钟。
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
  disabled?: boolean;
}

export function ShotClockPanel({
  remainingMs,
  running,
  durationSeconds,
  onToggle,
  onAdjust,
  onReset,
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

      <div className="clock-sub-row">
        <ConfirmButton
          label={t('shot.reset', { n: durationSeconds })}
          variant="danger"
          disabled={disabled}
          onConfirm={onReset}
          title={t('shot.reset.title')}
        />
      </div>
    </div>
  );
}

export default ShotClockPanel;
