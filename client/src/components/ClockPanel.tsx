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
  /**
   * 是否显示「上一节 / 下一节」。
   *
   * 足球没有"节"这个概念 —— 它是上半场/下半场,由足球面板上的
   * 「结束中场休息 → 下半场」按钮推进,所以这里整行隐藏。
   */
  showPeriodNav?: boolean;
  /**
   * 表是不是【往上走】。
   *
   * 篮球的表是倒着走(显示还剩多少),足球的表是正着走(显示已经过去多少)。
   * 面板收到的仍然是"剩余毫秒"(服务端锚点的原始语义),往上走时
   * 由 totalMs 换算出已用时间显示 —— 显示口径只有这一处转换,
   * 免得服务端与客户端各算各的。
   */
  countUp?: boolean;
  /** 本节总时长(ms)—— countUp 为 true 时用它换算已用时间 */
  totalMs?: number;
  /** 自定义标题(不传就用「比赛钟 · {节次}」) */
  label?: string;
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
  showPeriodNav = true,
  countUp = false,
  totalMs = 0,
  label,
  disabled = false,
}: ClockPanelProps) {
  const { t } = useI18n();
  /*
   * 往上走(足球)时显示的是"已经过去多少":剩余越少,显示越大。
   * 夹在本节时长之内 —— 表停了以后剩余不会变,但也不该越界。
   */
  const shown = countUp && totalMs > 0
    ? Math.max(0, Math.min(totalMs, totalMs - remainingMs))
    : remainingMs;
  // 最后 1 分钟:倒着走是"剩余 ≤ 60s",正着走是"已用 ≥ 总长 − 60s"
  const urgent = countUp && totalMs > 0
    ? shown > 0 && shown >= totalMs - 60_000
    : running && remainingMs > 0 && remainingMs <= 60_000;
  const classes = ['clock-panel', running ? 'running' : '', urgent ? 'urgent' : ''].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div className="panel-label">{label ?? t('clock.label', { period: periodLabel })}</div>

      <div className="seg-wrap">
        <SevenSegment
          value={formatClock(shown)}
          height={92}
          color={running ? '#ffb020' : '#9aa6c0'}
          dimColor="rgba(255,255,255,0.07)"
          title={t('clock.title', { time: formatClock(shown) })}
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
            onClick={() => onAdjust(countUp ? -s : s)}
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
            onClick={() => onAdjust(countUp ? s : -s)}
          >
            −{s}
          </button>
        ))}
      </div>

      <div className="clock-sub-row">
        {showPeriodNav ? (
          <>
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
          </>
        ) : (
          <>
            <ConfirmButton
              label={t('clock.reset')}
              variant="danger"
              disabled={disabled}
              onConfirm={onReset}
              title={t('clock.reset.title')}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default ClockPanel;
