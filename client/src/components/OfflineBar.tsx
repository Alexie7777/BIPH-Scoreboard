/**
 * 断线提示条。
 *
 * 断开时显示醒目黄条,并明确告诉计分员"计时仍在继续"——
 * 这是本项目的核心承诺之一,不能让现场以为设备坏了。
 */
import type { SocketStatus } from '../lib/ws';
import { useI18n } from '../i18n';

export function OfflineBar({ status }: { status: SocketStatus }) {
  const { t } = useI18n();
  if (status === 'online') return null;
  if (status === 'connecting') {
    return <div className="offline-bar connecting">{t('offline.connecting')}</div>;
  }
  return <div className="offline-bar">{t('offline.down')}</div>;
}

export default OfflineBar;
