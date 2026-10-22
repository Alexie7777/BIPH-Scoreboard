/**
 * 服务器当前时间(墙钟)。
 *
 * 管理台右上角与控制台左上角显示的是**同一个钟**,所以做成一个组件:
 * 以后要改格式、加时区,只改这一处,两处不会走偏。
 *
 * 三条约定:
 *   - 值来自**服务器时间**(WS 或 REST 校准过的),不是本机 Date.now() ——
 *     iPad 的系统时间经常不准,计分员要靠这个对表;
 *   - 用**本机时区**渲染(校内机器都是北京时间);
 *   - 格式固定 `HH:MM:SS`,和比赛钟一个风格,不随系统/语言变化。
 */
import { formatClockTime } from '../i18n';

export interface ServerClockProps {
  /** 服务器当前时间(ms) */
  now: number;
  /** 悬停提示 */
  title?: string;
  /** 额外的类名(各页面自己定样式) */
  className?: string;
}

export function ServerClock({ now, title, className }: ServerClockProps) {
  const classes = ['server-clock', className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes} title={title}>
      {formatClockTime(now)}
    </span>
  );
}

export default ServerClock;
