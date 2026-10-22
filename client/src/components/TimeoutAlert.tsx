/**
 * 暂停倒计时警示(控制台顶部横幅)。
 *
 * 两个阶段:
 *   urgent —— 剩最后 5 秒:红色 + 读秒,呼吸闪烁,等裁判/计分员抬头
 *   ended  —— 倒计时走完:绿色收尾,提醒"可以准备开赛了"
 *
 * 放在控制台顶部整条横幅(和断线黄条同一个位置):
 *   - 横向占满,余光扫得到
 *   - 不挡队卡的记分按钮,也不挡底部操作行(拇指区)
 */
import { useI18n } from '../i18n';

export interface TimeoutAlertData {
  phase: 'urgent' | 'ended';
  /** 还剩几秒(urgent 阶段用) */
  seconds: number;
}

export interface TimeoutAlertProps {
  alert: TimeoutAlertData | null;
}

export function TimeoutAlert({ alert }: TimeoutAlertProps) {
  const { t } = useI18n();
  if (!alert) return null;

  return (
    <div className={`timeout-alert ${alert.phase}`} role="alert" aria-live="assertive">
      <span className="timeout-alert-mark" aria-hidden="true">
        {alert.phase === 'urgent' ? '⏱' : '✓'}
      </span>
      <span className="timeout-alert-text">
        {alert.phase === 'urgent'
          ? t('control.timeout.urgent', { n: alert.seconds })
          : t('control.timeout.ended')}
      </span>
    </div>
  );
}

export default TimeoutAlert;
