/**
 * 记分按钮:大触控目标 + 触觉反馈(navigator.vibrate)。
 */
import type { ReactNode } from 'react';

export interface ScoreButtonProps {
  label: ReactNode;
  onPress: () => void;
  /** minus = 灰化;accent = 主色;danger = 危险 */
  variant?: 'default' | 'minus' | 'accent' | 'danger';
  disabled?: boolean;
  className?: string;
  title?: string;
  /** 触觉反馈时长(ms),传 0 关闭 */
  haptic?: number;
}

function vibrate(pattern: number) {
  if (pattern <= 0) return;
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    /* 不支持就算了 */
  }
}

export function ScoreButton({
  label,
  onPress,
  variant = 'default',
  disabled = false,
  className,
  title,
  haptic = 15,
}: ScoreButtonProps) {
  const classes = ['score-btn', variant !== 'default' ? variant : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled}
      title={title}
      onPointerDown={() => vibrate(haptic)}
      onClick={onPress}
    >
      {label}
    </button>
  );
}

export default ScoreButton;
