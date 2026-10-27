import {
  DEFAULT_PRESENTATION,
  DEFAULT_RULES,
  DEFAULT_TIMEOUT_SECONDS,
  MAX_START_COUNTDOWN_MS,
  buildPeriodLabel,
  isValidStartMode,
  isValidStartTime,
  periodDurationMs,
  shotClockDurationMs,
  type CommandType,
  type CreateMatchRequest,
  type EventKind,
  type Match,
  type MatchRules,
  type MatchStatus,
  type MatchUpdatePatch,
  type Possession,
  type Presentation,
  type Side,
  type Team,
} from '@biph/shared';
import {
  adjustClock,
  adjustShotClock,
  createAnchor,
  currentRemaining,
  endTimeoutAnchor,
  pauseClock,
  pauseShotClock,
  resetClock,
  resetShotClock,
  setClock,
  setPeriod,
  setShotClock,
  startClock,
  startShotClock,
  startTimeoutAnchor,
  toggleClock,
  toggleShotClock,
} from './clock.js';

/* ============================================================================
 * 比赛创建
 * ========================================================================== */

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const HOME_DEFAULT = { name: '主队', shortName: 'H', color: '#1d428a', textColor: '#ffffff' };
const AWAY_DEFAULT = { name: '客队', shortName: 'A', color: '#fdb927', textColor: '#14171e' };

export function createMatch(req: CreateMatchRequest, now: number, id = newId()): Match {
  const rules: MatchRules = {
    ...DEFAULT_RULES,
    ...(req.rules ?? {}),
  };
  const presentation: Presentation = {
    ...DEFAULT_PRESENTATION,
    ...(req.presentation ?? {}),
  };

  const home: Team = {
    id: `${id}-home`,
    name: req.homeName ?? HOME_DEFAULT.name,
    shortName: req.homeName ? req.homeName.slice(0, 3) : HOME_DEFAULT.shortName,
    color: req.homeColor ?? HOME_DEFAULT.color,
    textColor: req.homeTextColor ?? HOME_DEFAULT.textColor,
    logoUrl: null,
    score: 0,
    fouls: 0,
    // 暂停计数 = 【剩余次数】(开赛时把整场额度用满,见 REQUIREMENTS FR-6.1)
    timeouts: rules.timeoutsPerTeam,
  };

  const away: Team = {
    id: `${id}-away`,
    name: req.awayName ?? AWAY_DEFAULT.name,
    shortName: req.awayName ? req.awayName.slice(0, 3) : AWAY_DEFAULT.shortName,
    color: req.awayColor ?? AWAY_DEFAULT.color,
    textColor: req.awayTextColor ?? AWAY_DEFAULT.textColor,
    logoUrl: null,
    score: 0,
    fouls: 0,
    timeouts: rules.timeoutsPerTeam,
  };

  return {
    id,
    name: req.name ?? `${home.name} vs ${away.name}`,
    venue: req.venue ?? '',
    court: req.court ?? '',
    status: 'scheduled',
    // 目前只有篮球;老库里的比赛没有这个字段,前端按篮球兜底
    sport: req.sport ?? 'basketball',
    rules,
    home,
    away,
    clock: createAnchor({
      remainingMs: periodDurationMs(rules),
      running: false,
      period: 1,
      periodLabel: buildPeriodLabel(1, rules.periods, 'scheduled'),
      now,
    }),
    shotClock: createAnchor({
      remainingMs: shotClockDurationMs(rules),
      running: false,
      period: 1,
      periodLabel: '',
      now,
    }),
    timeout: endTimeoutAnchor(),
    possession: null,
    presentation,
    seq: 0,
    createdAt: now,
    updatedAt: now,
    lastEvent: null,
  };
}

/* ============================================================================
 * 命令归约(纯函数)
 * ----------------------------------------------------------------------------
 * 输入:当前比赛 + 命令 + 当前服务器时间
 * 输出:新的比赛 + 需要广播的事件 + 日志文案
 *
 * 纯函数,不碰数据库、不碰网络 —— 便于单元测试。
 * ========================================================================== */

export interface CommandResult {
  match: Match;
  events: { kind: EventKind; message?: string }[];
  log: string | null;
  /** 是否是破坏性操作(不可轻易撤销) */
  destructive: boolean;
}

const NOOP: CommandResult = {
  match: null as unknown as Match,
  events: [],
  log: null,
  destructive: false,
};

function clone(m: Match): Match {
  return {
    ...m,
    rules: { ...m.rules },
    home: { ...m.home },
    away: { ...m.away },
    clock: { ...m.clock },
    shotClock: { ...m.shotClock },
    ...(m.timeout ? { timeout: { ...m.timeout } } : {}),
    presentation: { ...m.presentation },
  };
}

function sideOf(m: Match, side: Side): Team {
  return side === 'home' ? m.home : m.away;
}

function setSide(m: Match, side: Side, patch: Partial<Team>): void {
  if (side === 'home') m.home = { ...m.home, ...patch };
  else m.away = { ...m.away, ...patch };
}

/**
 * 让进攻钟跟着比赛钟一起走。
 *
 * 规则依据:进攻钟随球权走,**比赛钟停它也得停**
 * (FIBA:The shot clock stops any time the game clock stops)。
 *
 * 三个边界,每一个都是现场真会踩的坑:
 *
 *  - **开球**(tipOff):满 24 秒起步,不是接着上一次的剩余值。
 *    开球是新的进攻权,必须满表。
 *  - **已经归零**:不能从 0 开始跑 —— 那样会立刻再次归零,变成死循环。
 *    归零意味着这个进攻权已经结束了,直接复位到满。
 *  - **本来就在跑**:不重复 start。重设锚点会带来微小跳变,
 *    表会"顿"一下,现场看得出来。
 */
function followShotClock(m: Match, now: number, tipOff: boolean): void {
  if (tipOff || currentRemaining(m.shotClock, now) <= 0) {
    m.shotClock = resetShotClock(m.shotClock, m.rules, now, true);
    return;
  }
  if (!m.shotClock.running) {
    m.shotClock = startShotClock(m.shotClock, now);
  }
}

/**
 * 只把【配置类】的队伍字段合并进来。
 *
 * score / fouls / timeouts 只能通过各自的计分命令改变 ——
 * 否则一条 match.update 就能把比分偷偷改掉,撤销栈与日志也全都对不上。
 */
export function mergeTeamConfig(team: Team, patch: Partial<Team>): Team {
  const next: Team = { ...team };
  if (typeof patch.name === 'string') next.name = patch.name;
  if (typeof patch.shortName === 'string') next.shortName = patch.shortName;
  if (typeof patch.color === 'string') next.color = patch.color;
  if (typeof patch.textColor === 'string') next.textColor = patch.textColor;
  if (typeof patch.logoUrl === 'string' || patch.logoUrl === null) next.logoUrl = patch.logoUrl;
  return next;
}

export function applyCommand(
  current: Match,
  type: CommandType,
  payload: unknown,
  now: number,
): CommandResult {
  let m = clone(current);
  const events: { kind: EventKind; message?: string }[] = [];
  let log: string | null = null;
  let destructive = false;

  const p = (payload ?? {}) as Record<string, unknown>;

  switch (type) {
    /* ------------------------------ 比分 ------------------------------ */
    case 'score.add': {
      const side = p.side as Side;
      const points = (p.points as 1 | 2 | 3) ?? 1;
      const t = sideOf(m, side);
      setSide(m, side, { score: Math.max(0, t.score + points) });
      log = `${t.name} +${points}`;
      break;
    }
    case 'score.sub': {
      const side = p.side as Side;
      const t = sideOf(m, side);
      setSide(m, side, { score: Math.max(0, t.score - 1) });
      log = `${t.name} -1`;
      destructive = true;
      break;
    }

    /* ---------------------------- 比赛时钟 ---------------------------- */
    case 'clock.start': {
      // 还没开赛(status 不是 live)→ 这一下就是开球:进攻钟满 24 秒起步
      const tipOff = m.status !== 'live';
      m.clock = startClock(m.clock, now);
      m.status = 'live';
      followShotClock(m, now, tipOff);
      log = tipOff ? '开球:比赛钟与进攻钟同时开始' : '比赛钟开始';
      break;
    }
    case 'clock.pause':
      m.clock = pauseClock(m.clock, now);
      // 比赛钟停,进攻钟也得停 —— 否则暂停期间进攻钟白走一截
      m.shotClock = pauseShotClock(m.shotClock, now);
      log = '比赛钟暂停';
      break;
    case 'clock.toggle': {
      const willRun = !m.clock.running;
      const tipOff = willRun && m.status !== 'live';
      m.clock = toggleClock(m.clock, now);
      m.status = 'live';
      if (willRun) followShotClock(m, now, tipOff);
      else m.shotClock = pauseShotClock(m.shotClock, now);
      log = m.clock.running
        ? tipOff
          ? '开球:比赛钟与进攻钟同时开始'
          : '比赛钟开始'
        : '比赛钟暂停';
      break;
    }
    case 'clock.adjust': {
      const delta = Number(p.deltaMs ?? 0);
      m.clock = adjustClock(m.clock, delta, now);
      log = `比赛钟 ${delta >= 0 ? '+' : ''}${Math.round(delta / 1000)}s`;
      break;
    }
    case 'clock.set': {
      const ms = Number(p.ms ?? 0);
      m.clock = setClock(m.clock, ms, now);
      log = '比赛钟设定';
      break;
    }
    case 'clock.nextPeriod': {
      const next = m.clock.period + 1;
      // 先定状态再算标签:否则从「已结束」直接跳节,标签会沿用旧的 FINAL
      m.status = 'live';
      m.clock = setPeriod(m.clock, next, m.rules, m.status, now);
      // 新节次是跳球开球:进攻钟复位到 24(停着),
      // 等计分员按「开始」时两个钟一起走
      m.shotClock = resetShotClock(m.shotClock, m.rules, now, false);
      log = `进入 ${m.clock.periodLabel}`;
      events.push({ kind: 'periodEnd' });
      break;
    }
    case 'clock.prevPeriod': {
      const prev = Math.max(1, m.clock.period - 1);
      m.clock = setPeriod(m.clock, prev, m.rules, m.status, now);
      log = `回到 ${m.clock.periodLabel}`;
      destructive = true;
      break;
    }

    /* ---------------------------- 进攻时钟 ---------------------------- */
    case 'shot.start':
      m.shotClock = startShotClock(m.shotClock, now);
      log = '进攻钟开始';
      break;
    case 'shot.pause':
      m.shotClock = pauseShotClock(m.shotClock, now);
      log = '进攻钟暂停';
      break;
    case 'shot.toggle':
      m.shotClock = toggleShotClock(m.shotClock, now);
      log = m.shotClock.running ? '进攻钟开始' : '进攻钟暂停';
      break;
    case 'shot.adjust': {
      const delta = Number(p.deltaMs ?? 0);
      m.shotClock = adjustShotClock(m.shotClock, delta, now);
      log = `进攻钟 ${delta >= 0 ? '+' : ''}${Math.round(delta / 1000)}s`;
      break;
    }
    case 'shot.set': {
      const ms = Number(p.ms ?? 0);
      m.shotClock = setShotClock(m.shotClock, ms, now);
      log = '进攻钟设定';
      break;
    }
    case 'shot.reset': {
      const seconds = typeof p.seconds === 'number' ? p.seconds : m.rules.shotClockSeconds;
      // start=true → 复位完直接开表(投篮命中后最常用的一次点击)
      const start = p.start === true;
      m.shotClock = resetShotClock(m.shotClock, { ...m.rules, shotClockSeconds: seconds }, now, start);
      log = start ? `进攻钟重置 ${seconds}s 并开始` : `进攻钟重置 ${seconds}s`;
      break;
    }
    /*
     * 24 秒违例。
     *
     * 进攻钟归零时,服务端已经自动停了比赛钟、记了日志、让大屏提示。
     * 这条命令是计分员确认「球不在空中,确实是违例」之后按的。
     *
     * 为什么球权转交和复位要人工确认:FIBA 有一条例外 ——
     * 球在空中、进攻钟归零前已离手、随后碰到篮筐的,**不算违例**。
     * 自动判罚会在这种情况下误判,所以最后这一步留给计分员。
     *
     * 做完之后:比赛钟停着、进攻钟复位到 24(停着),
     * 计分员按「开始比赛」时两个钟一起走。
     */
    case 'shot.violation': {
      const before = m.possession;
      // 球权转给对方。原来是 null(进攻权没设)就不擅自给,
      // 只复位进攻钟 —— 让计分员自己按「设置球权」。
      let after: Possession = before;
      if (before === 'home') after = 'away';
      else if (before === 'away') after = 'home';
      m.possession = after;
      m.clock = pauseClock(m.clock, now);
      m.shotClock = resetShotClock(m.shotClock, m.rules, now, false);
      log = before !== null && after !== null
        ? `24 秒违例,${sideOf(m, after).name}获得球权`
        : '24 秒违例,进攻钟复位 24s';
      break;
    }

    /* ---------------------------- 犯规/暂停 ---------------------------- */
    case 'foul.add': {
      const side = p.side as Side;
      const t = sideOf(m, side);
      setSide(m, side, { fouls: t.fouls + 1 });
      log = `${t.name} 犯规 ${t.fouls + 1}`;
      break;
    }
    case 'foul.sub': {
      const side = p.side as Side;
      const t = sideOf(m, side);
      setSide(m, side, { fouls: Math.max(0, t.fouls - 1) });
      log = `${t.name} 犯规 ${Math.max(0, t.fouls - 1)}`;
      destructive = true;
      break;
    }
    /*
     * 暂停计数 = 【剩余次数】(REQUIREMENTS FR-6.1)。
     *
     * timeout.add 的语义是"又用掉了一次暂停"(+1 TO),所以剩余次数要减;
     * timeout.sub 是"撤销一次误操作",剩余次数加回来。
     *
     * 上下限都夹住:剩余不可能为负,也不允许超过本场额度,
     * 否则大屏上会出现"暂停 7 / 4"这种自相矛盾的读数。
     * timeoutsPerTeam = 0 表示不限制额度(有些校内赛不设暂停)。
     */
    case 'timeout.add': {
      const side = p.side as Side;
      const t = sideOf(m, side);
      if (t.timeouts <= 0) {
        log = `${t.name} 暂停已用完`;
        break;
      }
      setSide(m, side, { timeouts: t.timeouts - 1 });
      log = `${t.name} 用掉一次暂停(剩 ${t.timeouts - 1})`;
      break;
    }
    case 'timeout.sub': {
      const side = p.side as Side;
      const t = sideOf(m, side);
      const limit = Number(m.rules.timeoutsPerTeam) || 0;
      const next = limit > 0 ? Math.min(limit, t.timeouts + 1) : t.timeouts + 1;
      setSide(m, side, { timeouts: next });
      log = `${t.name} 撤销一次暂停(剩 ${next})`;
      destructive = true;
      break;
    }

    /*
     * 请求暂停 —— 一次点击做三件事:
     *   1) 消耗该队的一次暂停额度(没有额度就不给叫,与队卡上的「+」按钮同一口径)
     *   2) 自动暂停比赛钟与进攻钟(暂停期间时间不流逝)
     *   3) 启动大屏上的暂停倒计时(锚点模型,断网也照走秒)
     *
     * 暂停结束后**不会自动恢复比赛钟** —— 什么时候开打由裁判/计分员说了算,
     * 计分员在控制台按「开始」即可。这样也避免了"倒计时一归零比赛就自己跑起来"
     * 这种现场事故(球员还没回到场上,表已经开始走)。
     */
    case 'timeout.request': {
      const side = p.side as Side;
      const t = sideOf(m, side);
      // 已经有暂停在进行:不重复计时(队卡上的按钮此时是禁用的,这里只是兜底)
      if (m.timeout?.running) {
        log = '暂停进行中';
        break;
      }
      if (t.timeouts <= 0) {
        log = `${t.name} 暂停已用完`;
        break;
      }
      setSide(m, side, { timeouts: t.timeouts - 1 });
      m.clock = pauseClock(m.clock, now);
      m.shotClock = pauseShotClock(m.shotClock, now);
      m.timeout = startTimeoutAnchor(
        m.rules.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
        side,
        now,
      );
      log = `${t.name} 请求暂停`;
      break;
    }
    /*
     * 结束暂停 —— 控制台上叫「继续比赛」。
     *
     * 做两件事:
     *   1) 撤下大屏上的暂停倒计时(大屏回到比赛计时器)
     *   2) **保证比赛钟与进攻钟处于停止状态**
     *
     * 第 2 条为什么要在服务端兜底:暂停期间比赛钟本来就是停的,
     * 但计分员有可能在暂停中误按了「开始」,表就跑起来了。
     * 「继续比赛」的语义是"回到比赛画面、等待开打",所以这里把表停回去 ——
     * 什么时候真正开打,仍然由计分员显式按「开始」决定,绝不自作主张。
     */
    case 'timeout.end': {
      m.timeout = endTimeoutAnchor();
      m.clock = pauseClock(m.clock, now);
      m.shotClock = pauseShotClock(m.shotClock, now);
      log = '暂停结束';
      break;
    }

    /* ------------------------------ 比赛 ------------------------------ */
    case 'possession.set': {
      m.possession = (p.side ?? null) as Possession;
      log = m.possession ? `${sideOf(m, m.possession).name} 进攻` : '进攻权清空';
      break;
    }
    case 'sides.swap': {
      const h = m.home;
      m.home = m.away;
      m.away = h;
      // 进攻权跟着【队伍】走,不能留在 home 这个槽位上 ——
      // 否则换边之后,原本持球的那队会突然变成"对方在进攻"。
      if (m.possession === 'home') m.possession = 'away';
      else if (m.possession === 'away') m.possession = 'home';
      log = '主客队交换';
      destructive = true;
      break;
    }
    case 'match.status': {
      const st = (p.status ?? 'scheduled') as MatchStatus;
      m.status = st;
      if (st === 'finished') {
        m.clock = pauseClock(m.clock, now);
        m.shotClock = pauseShotClock(m.shotClock, now);
        // 比赛结束就不必再倒计时了
        m.timeout = endTimeoutAnchor();
      }
      log = st === 'finished' ? '比赛结束' : st === 'live' ? '比赛开始' : '比赛未开始';
      break;
    }
    case 'match.final': {
      m.status = 'finished';
      m.clock = pauseClock(m.clock, now);
      m.shotClock = pauseShotClock(m.shotClock, now);
      m.timeout = endTimeoutAnchor();
      log = '比赛结束';
      destructive = true;
      break;
    }
    case 'buzzer': {
      events.push({ kind: 'buzzer' });
      log = '蜂鸣';
      break;
    }
    case 'match.update': {
      const patch = (p.patch ?? {}) as MatchUpdatePatch;
      // 只允许改配置类字段,不允许通过这条命令改比分/时钟
      const next = clone(m);
      if (typeof patch.name === 'string') next.name = patch.name;
      if (typeof patch.venue === 'string') next.venue = patch.venue;
      if (typeof patch.court === 'string') next.court = patch.court;
      if (patch.sport === 'basketball') next.sport = patch.sport;
      if (patch.rules) next.rules = { ...next.rules, ...patch.rules };
      if (patch.presentation) next.presentation = { ...next.presentation, ...patch.presentation };
      if (patch.home) next.home = mergeTeamConfig(next.home, patch.home);
      if (patch.away) next.away = mergeTeamConfig(next.away, patch.away);
      // 计划开赛时间:只认 "HH:MM";传 null 表示清空(不显示开赛倒计时)
      if (patch.startTime === null) next.startTime = null;
      else if (typeof patch.startTime === 'string') next.startTime = patch.startTime.trim();
      // 开赛模式:准点(墙钟)还是倒计时(相对时长)
      if (isValidStartMode(patch.startMode)) next.startMode = patch.startMode;
      /*
       * 开赛倒计时:客户端只给【时长】,"从什么时候开始算"必须由服务端打点 ——
       * 客户端的时钟不能当真,现场几台设备的钟未必一样准。
       */
      if (patch.startCountdownMs === null) next.startCountdown = null;
      else if (typeof patch.startCountdownMs === 'number') {
        next.startCountdown = { durationMs: patch.startCountdownMs, anchorServerTs: now };
      }
      // 规则变化后,节次标签要跟着重算
      next.clock = {
        ...next.clock,
        periodLabel: buildPeriodLabel(next.clock.period, next.rules.periods, next.status),
      };
      log = '更新比赛配置';
      m = next;
      break;
    }
    default:
      return NOOP;
  }

  m.seq = current.seq + 1;
  m.updatedAt = now;
  m.lastEvent = log;

  // 节次标签恒由 (period, periods, status) 推导,放在出口统一重算。
  // 否则状态在命令之间来回切(如「比赛结束 → 重新开打」)时,标签会残留旧的 FINAL,
  // 大屏会在 Q2 走表时仍显示 FINAL。
  m.clock = {
    ...m.clock,
    periodLabel: buildPeriodLabel(m.clock.period, m.rules.periods, m.status),
  };

  return { match: m, events, log, destructive };
}

/**
 * 这条命令会不会被拒绝。
 *
 * 返回拒绝原因(null = 允许执行)。
 *
 * 为什么需要它:归约函数 applyCommand 对"做不了"的命令是"照常返回一份状态、
 * 但什么都不改"(比如暂停额度已经用完)。对界面来说这等于"按了没反应",
 * 而命令通道必须如实回答"到底生效了没有" —— 所以这里先把明显的拒绝挑出来,
 * 由服务端回 ok:false,界面弹错误提示,而不是弹一个假的"已生效"。
 *
 * 放在纯函数这一层(而不是写进 applyCommand 的 switch)有两个好处:
 *   - applyCommand 保持"只描述状态怎么变",不掺协议语义
 *   - 拒绝时不压撤销栈(撤销栈在 hub 里压),现场按错了没东西可撤销
 */
export function rejectReason(m: Match, type: CommandType, payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const side: Side = p.side === 'away' ? 'away' : 'home';
  const team = side === 'home' ? m.home : m.away;

  switch (type) {
    case 'timeout.request':
      // 已经有暂停在进行:不重复计时(队卡上的按钮此时是禁用的,这里只是兜底)
      if (m.timeout?.running) return '暂停进行中';
      if (team.timeouts <= 0) return '暂停已用完';
      return null;
    case 'timeout.add':
      if (team.timeouts <= 0) return '暂停已用完';
      return null;
    case 'match.update': {
      // 开赛时间格式不对就拒掉 —— 脏数据会让大屏算出一个莫名其妙的倒计时
      const patch = (p.patch ?? {}) as Record<string, unknown>;
      const st = patch.startTime;
      if (st !== undefined && st !== null && !isValidStartTime(st)) {
        return '开赛时间格式应为 HH:MM';
      }
      // 开赛模式只认这两个值,别的当成脏数据
      const mode = patch.startMode;
      if (mode !== undefined && mode !== null && !isValidStartMode(mode)) {
        return '开赛模式只能是 scheduled 或 countdown';
      }
      // 倒计时时长:正数、上限 24 小时
      const sc = patch.startCountdownMs;
      if (sc !== undefined && sc !== null) {
        if (
          typeof sc !== 'number' ||
          !Number.isFinite(sc) ||
          sc <= 0 ||
          sc > MAX_START_COUNTDOWN_MS
        ) {
          return '倒计时时长应在 0 到 24 小时之间';
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/** 把比赛重置回初始状态(保留配置) */
export function resetMatch(current: Match, now: number): Match {
  const m = clone(current);
  m.home = { ...m.home, score: 0, fouls: 0, timeouts: m.rules.timeoutsPerTeam };
  m.away = { ...m.away, score: 0, fouls: 0, timeouts: m.rules.timeoutsPerTeam };
  m.status = 'scheduled';
  m.possession = null;
  m.clock = createAnchor({
    remainingMs: periodDurationMs(m.rules),
    running: false,
    period: 1,
    periodLabel: buildPeriodLabel(1, m.rules.periods, 'scheduled'),
    now,
  });
  m.shotClock = createAnchor({
    remainingMs: shotClockDurationMs(m.rules),
    running: false,
    period: 1,
    periodLabel: '',
    now,
  });
  m.timeout = endTimeoutAnchor();
  m.seq = current.seq + 1;
  m.updatedAt = now;
  m.lastEvent = '比赛已重置';
  return m;
}

export { currentRemaining };
