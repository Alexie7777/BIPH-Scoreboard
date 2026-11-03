import {
  buildPeriodLabel,
  periodDurationMs,
  remainingMs as sharedRemaining,
  type AddedTimeAnchor,
  type ClockAnchor,
  type HalftimeAnchor,
  type MatchRules,
  type MatchStatus,
  type Side,
  type SportId,
  type TimeAnchor,
  type TimeoutAnchor,
} from '@biph/shared';

/* ============================================================================
 * 服务器权威时钟
 * ----------------------------------------------------------------------------
 * 用「启动时的墙钟 + 单调时钟增量」构造,而不是直接用 Date.now()。
 *
 * 原因:Date.now() 会被 NTP 校时突然向前/向后跳。一旦跳了,已经下发的锚点
 * (anchorServerTs)与之后的 serverNow 就会对不上,正在走的计时器会突然跳几秒。
 *
 * 这里的 serverNow() 单调递增,绝不会因为系统校时而错乱;同时它与客户端之间
 * 仍可通过 serverTs 对齐(客户端用 performance.now() 推算)。
 * 代价是服务器时钟会与 NTP 逐渐漂移 —— 对比赛计时毫无影响,毫秒级都无所谓。
 * ========================================================================== */

/** 单调时钟,毫秒 */
export function monotonicMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

const bootWall = Date.now();
const bootMono = monotonicMs();

/** 服务器当前权威时间(单调、跨机可比) */
export function serverNow(): number {
  return bootWall + (monotonicMs() - bootMono);
}

/* ============================================================================
 * 锚点操作
 * ----------------------------------------------------------------------------
 * 全部操作都遵循同一条铁律:
 *   【任何改变时钟的操作,都必须重建锚点】
 * 重建锚点 = 把「当前的真实剩余量」固化成新的 (remainingMs, anchorServerTs) 组合。
 * 这样客户端拿到新锚点时,只需 remainingMs - (serverNow - anchorServerTs) 就能
 * 算出正确剩余量,且旧锚点的语义不会残留。
 * ========================================================================== */

export interface AnchorInit {
  remainingMs: number;
  running: boolean;
  period: number;
  periodLabel: string;
  now: number;
}

/**
 * 节次标签的额外上下文。
 *
 * 篮球的标签只由 (period, periods, status) 决定;足球还要知道
 * 「是不是处于中场休息」—— 那是 HT,不是 1H/2H。
 */
export interface LabelOptions {
  sport?: SportId | null;
  halftime?: boolean;
}

export function createAnchor(init: AnchorInit): ClockAnchor {
  return {
    running: init.running,
    remainingMs: Math.max(0, Math.round(init.remainingMs)),
    anchorServerTs: init.now,
    period: init.period,
    periodLabel: init.periodLabel,
  };
}

/** 锚点在 now 时刻的剩余毫秒 */
export function currentRemaining(anchor: TimeAnchor, now: number): number {
  return sharedRemaining(anchor, now);
}

/** 开始计时 */
export function startClock(anchor: ClockAnchor, now: number): ClockAnchor {
  if (anchor.running) return anchor;
  return createAnchor({
    remainingMs: currentRemaining(anchor, now),
    running: true,
    period: anchor.period,
    periodLabel: anchor.periodLabel,
    now,
  });
}

/** 暂停计时(冻结当前剩余) */
export function pauseClock(anchor: ClockAnchor, now: number): ClockAnchor {
  if (!anchor.running) return anchor;
  return createAnchor({
    remainingMs: currentRemaining(anchor, now),
    running: false,
    period: anchor.period,
    periodLabel: anchor.periodLabel,
    now,
  });
}

/** 启停切换 */
export function toggleClock(anchor: ClockAnchor, now: number): ClockAnchor {
  return anchor.running ? pauseClock(anchor, now) : startClock(anchor, now);
}

/**
 * 调整剩余时间(正负)。
 * 注意:先取「当前真实剩余」再加 delta,再重建锚点 —— 这样调整只生效一次。
 */
export function adjustClock(anchor: ClockAnchor, deltaMs: number, now: number): ClockAnchor {
  return createAnchor({
    remainingMs: currentRemaining(anchor, now) + deltaMs,
    running: anchor.running,
    period: anchor.period,
    periodLabel: anchor.periodLabel,
    now,
  });
}

/** 直接设定剩余时间 */
export function setClock(anchor: ClockAnchor, ms: number, now: number): ClockAnchor {
  return createAnchor({
    remainingMs: ms,
    running: anchor.running,
    period: anchor.period,
    periodLabel: anchor.periodLabel,
    now,
  });
}

/** 重置到本节总时长并停止 */
export function resetClock(
  anchor: ClockAnchor,
  rules: MatchRules,
  status: MatchStatus,
  now: number,
  opts?: LabelOptions,
): ClockAnchor {
  return createAnchor({
    remainingMs: periodDurationMs(rules),
    running: false,
    period: anchor.period,
    periodLabel: buildPeriodLabel(anchor.period, rules.periods, status, opts),
    now,
  });
}

/**
 * 切换节次。
 * 新的节次一律「停止 + 满时长」,由计分员显式按开始 —— 避免自动跳节造成的误判。
 */
export function setPeriod(
  anchor: ClockAnchor,
  period: number,
  rules: MatchRules,
  status: MatchStatus,
  now: number,
  opts?: LabelOptions,
): ClockAnchor {
  const p = Math.max(1, period);
  return createAnchor({
    remainingMs: periodDurationMs(rules),
    running: false,
    period: p,
    periodLabel: buildPeriodLabel(p, rules.periods, status, opts),
    now,
  });
}

/* --------------------------- 进攻钟 --------------------------- */

export function startShotClock(anchor: ClockAnchor, now: number): ClockAnchor {
  if (anchor.running) return anchor;
  return createAnchor({
    remainingMs: currentRemaining(anchor, now),
    running: true,
    period: anchor.period,
    periodLabel: anchor.periodLabel,
    now,
  });
}

export function pauseShotClock(anchor: ClockAnchor, now: number): ClockAnchor {
  if (!anchor.running) return anchor;
  return createAnchor({
    remainingMs: currentRemaining(anchor, now),
    running: false,
    period: anchor.period,
    periodLabel: anchor.periodLabel,
    now,
  });
}

export function toggleShotClock(anchor: ClockAnchor, now: number): ClockAnchor {
  return anchor.running ? pauseShotClock(anchor, now) : startShotClock(anchor, now);
}

export function adjustShotClock(anchor: ClockAnchor, deltaMs: number, now: number): ClockAnchor {
  return createAnchor({
    remainingMs: currentRemaining(anchor, now) + deltaMs,
    running: anchor.running,
    period: anchor.period,
    periodLabel: anchor.periodLabel,
    now,
  });
}

export function setShotClock(anchor: ClockAnchor, ms: number, now: number): ClockAnchor {
  return createAnchor({
    remainingMs: ms,
    running: anchor.running,
    period: anchor.period,
    periodLabel: anchor.periodLabel,
    now,
  });
}

/**
 * 重置进攻钟。
 *
 * `start` 为 true 时**重置完直接开表** —— 现场最常用的是"投篮命中,
 * 复位并开表",一次点完就行,不用重置之后再按一次开始。
 * 默认 false(重置完是停的),保持老行为。
 */
export function resetShotClock(
  anchor: ClockAnchor,
  rules: MatchRules,
  now: number,
  start = false,
): ClockAnchor {
  return createAnchor({
    remainingMs: rules.shotClockSeconds * 1000,
    running: start,
    period: anchor.period,
    periodLabel: anchor.periodLabel,
    now,
  });
}

/* --------------------------- 暂停倒计时 ---------------------------
 * 暂停倒计时与大屏上的比赛钟、进攻钟是同一种东西:一个锚点。
 * 服务端只存「锚点时刻还剩多少」,客户端用单调时钟本地推算,
 * 所以断网时大屏上的倒计时照样一秒一秒地走。
 * --------------------------------------------------------------- */

/** 开始一次暂停倒计时 */
export function startTimeoutAnchor(seconds: number, side: Side, now: number): TimeoutAnchor {
  return {
    running: true,
    remainingMs: Math.max(0, Math.round(seconds * 1000)),
    anchorServerTs: now,
    side,
  };
}

/** 结束暂停(清空倒计时) */
export function endTimeoutAnchor(): TimeoutAnchor {
  return { running: false, remainingMs: 0, anchorServerTs: 0, side: null };
}

/** 暂停倒计时在 now 时刻的剩余毫秒 */
export function currentTimeoutRemaining(anchor: TimeoutAnchor, now: number): number {
  return sharedRemaining(anchor, now);
}

/* --------------------------- 足球:补时 / 中场 ---------------------------
 * 足球有两个额外的表:
 *   - 补时表:主钟 45:00 停表后,裁判宣布的伤停补时走这张表;
 *   - 中场倒计时:中场休息 15 分钟。
 * 两者和比赛钟一样是【锚点】—— 服务端只广播锚点,客户端本地推算,断网也走秒。
 * ------------------------------------------------------------------- */

/** 设补时(seconds 秒),start=true 时设完直接开表 */
export function setAddedTime(seconds: number, now: number, start = false): AddedTimeAnchor {
  const durationMs = Math.max(0, Math.round(seconds * 1000));
  return {
    running: start && durationMs > 0,
    remainingMs: durationMs,
    anchorServerTs: now,
    durationMs,
  };
}

/** 补时开表(冻结当前剩余后继续走) */
export function startAddedTime(anchor: AddedTimeAnchor, now: number): AddedTimeAnchor {
  if (anchor.running) return anchor;
  return {
    running: true,
    remainingMs: currentRemaining(anchor, now),
    anchorServerTs: now,
    durationMs: anchor.durationMs,
  };
}

/** 补时停表 */
export function pauseAddedTime(anchor: AddedTimeAnchor, now: number): AddedTimeAnchor {
  if (!anchor.running) return anchor;
  return {
    running: false,
    remainingMs: currentRemaining(anchor, now),
    anchorServerTs: now,
    durationMs: anchor.durationMs,
  };
}

/** 补时启停切换 */
export function toggleAddedTime(anchor: AddedTimeAnchor, now: number): AddedTimeAnchor {
  return anchor.running ? pauseAddedTime(anchor, now) : startAddedTime(anchor, now);
}

/** 进入中场休息(durationMs 总时长),倒计时停着等计分员开表 */
export function enterHalftime(durationMs: number, now: number): HalftimeAnchor {
  const total = Math.max(0, Math.round(durationMs));
  return {
    running: false,
    remainingMs: total,
    anchorServerTs: now,
    durationMs: total,
  };
}

/** 中场倒计时开表 */
export function startHalftime(anchor: HalftimeAnchor, now: number): HalftimeAnchor {
  if (anchor.running) return anchor;
  return {
    running: true,
    remainingMs: currentRemaining(anchor, now),
    anchorServerTs: now,
    durationMs: anchor.durationMs,
  };
}

/** 中场倒计时停表 */
export function pauseHalftime(anchor: HalftimeAnchor, now: number): HalftimeAnchor {
  if (!anchor.running) return anchor;
  return {
    running: false,
    remainingMs: currentRemaining(anchor, now),
    anchorServerTs: now,
    durationMs: anchor.durationMs,
  };
}

/** 中场倒计时启停切换 */
export function toggleHalftime(anchor: HalftimeAnchor, now: number): HalftimeAnchor {
  return anchor.running ? pauseHalftime(anchor, now) : startHalftime(anchor, now);
}

/**
 * 中场倒计时重新计时。
 *
 * 归零之后计分员再按一次「开始中场休息」= 中场延时,重新走满全场时长。
 */
export function rearmHalftime(anchor: HalftimeAnchor, now: number): HalftimeAnchor {
  const total = Math.max(0, Math.round(anchor.durationMs));
  return {
    running: true,
    remainingMs: total,
    anchorServerTs: now,
    durationMs: total,
  };
}
