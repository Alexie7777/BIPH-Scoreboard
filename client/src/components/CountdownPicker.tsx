/**
 * 开赛倒计时的「选择器」—— 倒计时模式的对等物。
 *
 * 为什么需要它:准点模式用的是浏览器原生的 `<input type="time">`,
 * 点右边的时钟图标会弹出一个时间选择面板,现场填"几点开球"很方便。
 * 倒计时模式没有原生对应物(原生 time 输入框装不下"还有 90 分钟"这种时长),
 * 现场就只剩手打 "15:00" 这一条路 —— 站在场边用手指戳键盘,慢且容易打错。
 *
 * 这里补一个同脾气的东西:
 *   - 常用时长一键选(1/2/3/5/10/15/20/30/45/60 分钟 —— 现场最常说的那几句);
 *   - 要精确到秒,用两个数字输入框(浏览器自带的 ▲▼ 微调器,触屏会出数字键盘);
 *   - 面板贴着输入框弹出,不是全屏模态:跟原生时间选择器一样,
 *     看得见旁边的大屏,知道自己在干嘛。
 *
 * 选完直接把值交出去(由调用方填进输入框并起算),本组件不碰服务端。
 */
import { useEffect, useState } from 'react';
import { MAX_START_COUNTDOWN_MS, formatStartCountdownInput } from '@biph/shared';
import { useI18n } from '../i18n';

/** 现场最常说的那几句:还有 5 分钟 / 10 分钟 / 15 分钟…… */
export const COUNTDOWN_PRESET_MINUTES = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60];

/** 常用时长 → 毫秒 */
export function presetDurationMs(minutes: number): number {
  return minutes * 60_000;
}

export interface CountdownPickerProps {
  /** 当前已设定的时长(ms);null = 还没设过 */
  value: number | null;
  /** 选好了(单位 ms) */
  onPick: (ms: number) => void;
  /** 关闭面板 */
  onClose: () => void;
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function CountdownPicker({ value, onPick, onClose }: CountdownPickerProps) {
  const { t } = useI18n();
  const initial = value ?? 15 * 60_000;
  const [minutes, setMinutes] = useState(() => Math.floor(initial / 60_000));
  const [seconds, setSeconds] = useState(() => Math.round((initial % 60_000) / 1000));

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const total = minutes * 60_000 + seconds * 1000;
  const canApply = total > 0 && total <= MAX_START_COUNTDOWN_MS;

  return (
    <div className="cd-picker" role="dialog" aria-label={t('setup.info.startCountdown.picker')}>
      <div className="cd-picker-head">
        <span className="cd-picker-title">{t('setup.info.startCountdown.picker')}</span>
        <span className="cd-picker-preview">
          {canApply
            ? t('setup.info.startCountdown.preview', { time: formatStartCountdownInput(total) })
            : t('setup.info.startCountdown.previewEmpty')}
        </span>
      </div>

      <div className="cd-picker-quick">
        {COUNTDOWN_PRESET_MINUTES.map((m) => (
          <button
            key={m}
            type="button"
            className="cd-chip"
            onClick={() => {
              onPick(presetDurationMs(m));
              onClose();
            }}
          >
            {m} {t('setup.info.startCountdown.min')}
          </button>
        ))}
      </div>

      <div className="cd-picker-exact">
        <label>
          <span>{t('setup.info.startCountdown.minutes')}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={999}
            value={minutes}
            onChange={(e) => setMinutes(clampInt(e.target.value, 0, 999, minutes))}
          />
        </label>
        <label>
          <span>{t('setup.info.startCountdown.seconds')}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            value={seconds}
            onChange={(e) => setSeconds(clampInt(e.target.value, 0, 59, seconds))}
          />
        </label>
      </div>

      <div className="cd-picker-actions">
        {value !== null ? (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              onPick(value);
              onClose();
            }}
          >
            {t('setup.info.startCountdown.rearm')}
          </button>
        ) : null}
        <span className="spacer" />
        <button type="button" className="btn small" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn small primary"
          disabled={!canApply}
          onClick={() => {
            onPick(total);
            onClose();
          }}
        >
          {t('setup.info.startCountdown.apply')}
        </button>
      </div>
    </div>
  );
}

export default CountdownPicker;
