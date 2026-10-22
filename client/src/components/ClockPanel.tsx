/**
 * 比赛钟面板:七段数码管 + 启停大按钮 + 秒级增减 + 节次切换。
 */
import { useI18n } from '../i18n';
import { formatClock } from '../lib/format';
import { ConfirmButton } from './ConfirmButton';
import { SevenSegment } from './SevenSegment';
import { IconPause, IconPlay } from './icons';

export interface ClockPanelProps {
  remainingMs: number;
  running: boolean;
  periodLabel: string;
  onToggle: () => void;
  /** delta 为秒,正负都支持 */
  onAdjust: (deltaSeconds: number) => void;
  /** 重置回本节总时长 */
  onReset: () => void;
  onNextPeriod: () => void;
  onPrevPeriod: () => void;
  disabled?: boolean;
}

const STEPS = [1, 5, 10, 60];

export function ClockPanel({
  remainingMs,
  running,
  periodLabel,
  onToggle,
  onAdjust,
  onReset,
  onNextPeriod,
  onPrevPeriod,
  disabled = false,
}: ClockPanelProps) {
  const { t } = useI18n();
  const urgent = running && remainingMs > 0 && remainingMs <= 60_000;
  const classes = ['clock-panel', running ? 'running' : '', urgent ? 'urgent' : ''].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div className="panel-label">{t('clock.label', { period: periodLabel })}</div>

      <div className="seg-wrap">
        <SevenSegment
          value={formatClock(remainingMs)}
          height={92}
          color={running ? '#ffb020' : '#9aa6c0'}
          dimColor="rgba(255,255,255,0.07)"
          title={t('clock.title', { time: formatClock(remainingMs) })}
        />
      </div>

      <button
        type="button"
        className={running ? 'clock-toggle on' : 'clock-toggle off'}
        onClick={onToggle}
        disabled={disabled}
        title={t('clock.toggle.title')}
      >
        {running ? <IconPause size={30} /> : <IconPlay size={30} />}
        {running ? t('clock.pause') : t('clock.start')}
      </button>

      <div className="step-grid">
        {STEPS.map((s) => (
          <button
            key={`p${s}`}
            type="button"
            className="step-btn plus"
            disabled={disabled}
            onClick={() => onAdjust(s)}
          >
            +{s}
          </button>
        ))}
        {STEPS.map((s) => (
          <button
            key={`m${s}`}
            type="button"
            className="step-btn minus"
            disabled={disabled}
            onClick={() => onAdjust(-s)}
          >
            −{s}
          </button>
        ))}
      </div>

      <div className="clock-sub-row">
        <button type="button" className="btn" disabled={disabled} onClick={onPrevPeriod}>
          {t('clock.prevPeriod')}
        </button>
        <ConfirmButton
          label={t('clock.reset')}
          variant="danger"
          disabled={disabled}
          onConfirm={onReset}
          title={t('clock.reset.title')}
        />
        <button type="button" className="btn" disabled={disabled} onClick={onNextPeriod}>
          {t('clock.nextPeriod')}
        </button>
      </div>
    </div>
  );
}

export default ClockPanel;
