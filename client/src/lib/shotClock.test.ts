/**
 * 「使用进攻钟」开关能不能勾 —— 判定口径。
 *
 * 客户端与服务端共用 `canTurnOnShotClock` 这一份(在 shared 里),
 * 两边必须一模一样:界面上灰掉了,服务端也得拒;反过来也一样。
 * 这个测试盯住客户端这一侧的用法。
 */
import { describe, expect, it } from 'vitest';
import { canTurnOnShotClock } from '@biph/shared';

describe('比赛钟在跑的时候不许开启进攻钟', () => {
  it('跑着 + 还没开 → 不许开', () => {
    expect(canTurnOnShotClock({ clockRunning: true, useShotClock: false })).toBe(false);
  });

  it('跑着 + 已经开着 → 不受影响(关掉随时都行)', () => {
    expect(canTurnOnShotClock({ clockRunning: true, useShotClock: true })).toBe(true);
  });

  it('停着 → 可以开', () => {
    expect(canTurnOnShotClock({ clockRunning: false, useShotClock: false })).toBe(true);
    expect(canTurnOnShotClock({ clockRunning: false, useShotClock: true })).toBe(true);
  });
});
