/**
 * 破坏性操作按钮:长按 0.6s,或者"第一次点击 → 进入待确认状态 → 再点一次"。
 *
 * 两条路径都给,是为了照顾两种使用习惯:
 *   - 计分员熟悉 iOS 长按 → 长按直接生效(带进度条反馈)
 *   - 其他人 → 两次点击,不会误触
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';

export interface ConfirmButtonProps {
  label: ReactNode;
  onConfirm: () => void;
  /** 长按触发所需时长 */
  holdMs?: number;
  className?: string;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  title?: string;
  /** 第二次点击的间隔超时(毫秒),超时后退回待命 */
  armTimeoutMs?: number;
}

export function ConfirmButton({
  label,
  onConfirm,
  holdMs = 600,
  className,
  variant = 'default',
  disabled = false,
  title,
  armTimeoutMs = 3000,
}: ConfirmButtonProps) {
  const [progress, setProgress] = useState(0);
  const [armed, setArmed] = useState(false);
  const { t } = useI18n();
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const armTimerRef = useRef<number | null>(null);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    startRef.current = null;
    setProgress(0);
  }, []);

  const confirm = useCallback(() => {
    firedRef.current = true;
    stopLoop();
    setArmed(false);
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate([12, 40, 12]);
    } catch {
      /* ignore */
    }
    onConfirm();
  }, [onConfirm, stopLoop]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
    };
  }, []);

  const onPointerDown = useCallback(() => {
    if (disabled) return;
    firedRef.current = false;

    if (armed) {
      // 已经待确认 → 这次点击直接生效
      confirm();
      return;
    }

    startRef.current = performance.now();
    const tick = () => {
      const started = startRef.current;
      if (started === null) return;
      const elapsed = performance.now() - started;
      const ratio = Math.min(1, elapsed / holdMs);
      setProgress(ratio);
      if (ratio >= 1) {
        confirm();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [armed, confirm, disabled, holdMs]);

  const onPointerUp = useCallback(() => {
    if (firedRef.current) return;
    stopLoop();
    // 没长按够时长就松手 → 进入待确认,再点一次才生效
    setArmed(true);
    if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current);
    armTimerRef.current = window.setTimeout(() => setArmed(false), armTimeoutMs);
  }, [armTimeoutMs, stopLoop]);

  const classes = ['btn', 'hold-btn', variant === 'danger' ? 'danger' : '', armed ? 'armed' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled}
      title={title}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hold-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      <span style={{ position: 'relative' }}>{armed ? t('common.confirmAgain') : label}</span>
    </button>
  );
}

export default ConfirmButton;
