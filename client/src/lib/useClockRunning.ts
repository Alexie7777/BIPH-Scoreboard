/**
 * 订阅一场比赛的**比赛钟是否在跑**。
 *
 * 专给配置页用:配置页要决定「使用进攻钟」那个开关能不能勾,
 * 而它自己只在打开时拉一次全量(REST),之后就撒手不管了 ——
 * 比赛钟往往是几分钟后才开跑的,页面上的状态早就是旧的,
 * 拿它判断"现在能不能开进攻钟"会判错。
 *
 * 只往外抛一个布尔值:布尔值没变时 React 不会重渲染,
 * 所以这个订阅不会让配置页每秒重排一次
 * (配置页上有输入框,每秒重排一次太浪费,也会打断输入)。
 */
import { useEffect, useState } from 'react';
import { MatchSocket } from './ws';

export function useClockRunning(matchId: string | undefined): boolean {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!matchId) return;
    const socket = new MatchSocket({
      matchId,
      // 只读:配置页不需要令牌(大屏链接本来就是公开只读的)
      role: 'display',
      token: null,
      onState: (m) => setRunning(m.clock.running),
      onTick: (clock) => setRunning(clock.running),
      onAck: () => {},
      onEvent: () => {},
      onStatus: () => {},
      onOpen: () => {},
    });
    socket.connect();
    return () => socket.close();
  }, [matchId]);

  return running;
}
