import {
  DEFAULT_PRESENTATION,
  DEFAULT_TIMEOUT_SECONDS,
  MAX_ADDED_TIME_SECONDS,
  MAX_START_COUNTDOWN_MS,
  buildPeriodLabel,
  canTurnOnShotClock,
  defaultRulesFor,
  formatAddedTime,
  halftimeDurationMs,
  isFootball,
  isSportId,
  isValidStartMode,
  isValidStartTime,
  periodDurationMs,
  resolveSport,
  shotClockDurationMs,
  shotClockEnabled,
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
  type SportId,
  type Team,
} from '@biph/shared';
import {
  adjustClock,
  adjustShotClock,
  createAnchor,
  currentRemaining,
  endTimeoutAnchor,
  enterHalftime,
  pauseAddedTime,
  pauseClock,
  pauseHalftime,
  pauseShotClock,
  rearmHalftime,
  resetClock,
  resetShotClock,
  serverNow,
  setAddedTime,
  setClock,
  setPeriod,
  setShotClock,
  startAddedTime,
  startClock,
  startHalftime,
  startShotClock,
  startTimeoutAnchor,
  toggleAddedTime,
  toggleClock,
  toggleHalftime,
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
  // 项目决定默认规则:篮球 4×10,足球 2×45。
  // 客户端只传"要改的部分",没传的按项目的默认来 —— 两边算出来的默认值
  // 必须一致(shared/defaultRulesFor 就是为此存在的)。
  const sport: SportId = resolveSport({ sport: req.sport });
  const rules: MatchRules = {
    ...defaultRulesFor(sport),
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
    // 老库里的比赛没有这个字段,前端按篮球兜底
    sport,
    rules,
    home,
    away,
    clock: createAnchor({
      remainingMs: periodDurationMs(rules),
      running: false,
      period: 1,
      periodLabel: buildPeriodLabel(1, rules.periods, 'scheduled', { sport }),
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
    ...(m.addedTime ? { addedTime: { ...m.addedTime } } : {}),
    ...(m.halftime ? { halftime: { ...m.halftime } } : {}),
    presentation: { ...m.presentation },
  };
}

/**
 * 重算节次标签。
 *
 * 足球还要看「是不是在中场休息」—— 那是 HT,不是 1H/2H。
 */
function relabel(m: Match): void {
  m.clock = {
    ...m.clock,
    periodLabel: buildPeriodLabel(m.clock.period, m.rules.periods, m.status, {
      sport: m.sport,
      halftime: !!m.halftime,
    }),
  };
}

/**
 * 本半场是否已经结束(主钟停在 0 且停着)。
 *
 * 足球用它守住两件事:
 *   - 没结束就不许进中场休息;
 *   - 没结束就不许"设补时并开表"(补时是半场结束之后才宣布的)。
 */
function halfEnded(m: Match, now: number): boolean {
  return currentRemaining(m.clock, now) <= 0 && !m.clock.running;
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
  /*
   * 本场不使用进攻钟 → 进攻钟不许被带起来。
   *
   * 校赛不打 24 秒时,计分员会在配置页取消勾选「使用进攻钟」。
   * 早先这里完全不看这个标志位:取消勾选之后,再按一次「开始比赛」,
   * 进攻钟照样满 24 秒跑起来,归零又被判成「24 秒违例」——
   * 现场看到的就是"明明关掉了,表还在响"。
   */
  if (!shotClockEnabled(m)) {
    m.shotClock = pauseShotClock(m.shotClock, now);
    return;
  }
  if (tipOff || currentRemaining(m.shotClock, now) <= 0) {
    m.shotClock = resetShotClock(m.shotClock, m.rules, now, true);
    return;
  }
  if (!m.shotClock.running) {
    m.shotClock = startShotClock(m.shotClock, now);
  }
}

/**
 * 开进攻钟 —— 并保证比赛钟也在走。
 *
 * 篮球里进攻钟数的是【比赛时间】:比赛钟停着的时候,场上没有时间在流逝,
 * 进攻钟不可能自己在走。所以"开进攻钟"这件事必须连带把比赛钟带起来 ——
 * 早先「重置并开表」只开进攻钟,于是出现"进攻钟在跑、比赛钟停着",
 * 两个钟对不上,现场看着就是出了事故。
 *
 * 比赛钟本来就在跑时(现场最常见:投篮命中,比赛钟一直在走)这里什么都不做,
 * 也**不重设它的锚点** —— 重设会让表"顿"一下,现场看得出来。
 *
 * 返回值告诉调用方这一下顺带做了什么:
 *   - `started`:这次把比赛钟带起来了
 *   - `tipOff` :带起来的同时是开球(原来 status 不是 live)—— 进攻钟要满表起步
 */
function ensureGameClockRunning(
  m: Match,
  now: number,
): { started: boolean; tipOff: boolean } {
  if (m.clock.running) return { started: false, tipOff: false };
  const tipOff = m.status !== 'live';
  m.clock = startClock(m.clock, now);
  m.status = 'live';
  return { started: true, tipOff };
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
    /*
     * 篮球与足球在这里分流:
     *   - 篮球:开球时进攻钟要满 24 秒起步,暂停时进攻钟也要停;
     *   - 足球:没有进攻钟,主钟一个走到底。
     * 进球**不停表**(和篮球一样),那是裁判的事。
     */
    case 'clock.start': {
      // 还没开赛(status 不是 live)→ 这一下就是开球:进攻钟满 24 秒起步
      const tipOff = m.status !== 'live';
      m.clock = startClock(m.clock, now);
      m.status = 'live';
      if (!isFootball(m)) followShotClock(m, now, tipOff);
      log = tipOff
        ? isFootball(m)
          ? '开球:比赛钟开始'
          : '开球:比赛钟与进攻钟同时开始'
        : '比赛钟开始';
      break;
    }
    case 'clock.pause':
      m.clock = pauseClock(m.clock, now);
      // 比赛钟停,进攻钟也得停 —— 否则暂停期间进攻钟白走一截
      if (!isFootball(m)) m.shotClock = pauseShotClock(m.shotClock, now);
      log = '比赛钟暂停';
      break;
    case 'clock.toggle': {
      const willRun = !m.clock.running;
      const tipOff = willRun && m.status !== 'live';
      m.clock = toggleClock(m.clock, now);
      m.status = 'live';
      if (!isFootball(m)) {
        if (willRun) followShotClock(m, now, tipOff);
        else m.shotClock = pauseShotClock(m.shotClock, now);
      }
      log = m.clock.running
        ? tipOff
          ? isFootball(m)
            ? '开球:比赛钟开始'
            : '开球:比赛钟与进攻钟同时开始'
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
    case 'clock.reset': {
      /*
       * 重置本节 = 本节从头开始。
       *
       * 比赛钟回到本节总时长、进攻钟回到满时长,**两个钟都停着** ——
       * 计分员按「开始比赛」时两个钟一起走,跟换节一个规矩。
       *
       * 早先这里只发 clock.set(只设比赛钟),进攻钟原样留着 ——
       * 比赛钟拉满到 10:00、进攻钟却还剩 16 秒在走,两个钟对不上,
       * 现场看着就是出了事故。
       */
      if (isFootball(m)) {
        // 足球没有进攻钟。补时一并清掉:补时属于刚刚作废的那一段时间,
        // 留着它,下一个半场的补时就串了。
        m.clock = resetClock(m.clock, m.rules, m.status, now, {
          sport: m.sport,
          halftime: !!m.halftime,
        });
        m.addedTime = null;
        log = '比赛钟已重置(补时已清空)';
        break;
      }
      m.clock = resetClock(m.clock, m.rules, m.status, now);
      /*
       * 不使用进攻钟时不去动它的锚点。
       *
       * 复位进攻钟用的是规则里的 `shotClockSeconds`;校赛不打 24 秒时
       * 这个值常常是 0,复位出来的锚点 remainingMs=0 —— 那会让服务端的
       * 归零检测误以为"进攻钟刚归零",凭空判一次违例。
       */
      if (shotClockEnabled(m)) {
        m.shotClock = resetShotClock(m.shotClock, m.rules, now, false);
        log = '比赛钟与进攻钟已重置';
      } else {
        log = '比赛钟已重置';
      }
      break;
    }
    case 'clock.nextPeriod': {
      if (isFootball(m)) {
        // 足球的"下一个节"就是下半场:主钟回到 45:00 停着,补时清空,
        // 等计分员按「开始比赛」。
        m.status = 'live';
        m.halftime = null;
        m.clock = setPeriod(m.clock, 2, m.rules, m.status, now, { sport: m.sport });
        m.addedTime = null;
        log = '进入下半场';
        break;
      }
      const next = m.clock.period + 1;
      // 先定状态再算标签:否则从「已结束」直接跳节,标签会沿用旧的 FINAL
      m.status = 'live';
      m.clock = setPeriod(m.clock, next, m.rules, m.status, now);
      // 新节次是跳球开球:进攻钟复位到 24(停着),
      // 等计分员按「开始」时两个钟一起走
      // (本场不用进攻钟时不复位 —— 复位出来的剩余值可能是 0,会被误判成归零)
      if (shotClockEnabled(m)) {
        m.shotClock = resetShotClock(m.shotClock, m.rules, now, false);
      }
      log = `进入 ${m.clock.periodLabel}`;
      events.push({ kind: 'periodEnd' });
      break;
    }
    case 'clock.prevPeriod': {
      if (isFootball(m)) {
        // 回到上半场(主要用于把"点错进下半场"退回来)
        m.status = 'live';
        m.halftime = null;
        m.clock = setPeriod(m.clock, 1, m.rules, m.status, now, { sport: m.sport });
        m.addedTime = null;
        log = '回到上半场';
        destructive = true;
        break;
      }
      const prev = Math.max(1, m.clock.period - 1);
      m.clock = setPeriod(m.clock, prev, m.rules, m.status, now);
      log = `回到 ${m.clock.periodLabel}`;
      destructive = true;
      break;
    }

    /* ---------------------------- 进攻时钟 ---------------------------- */
    /*
     * 进攻钟不能自己开:开进攻钟必须连带把比赛钟带起来(见 ensureGameClockRunning)。
     * 早先这三个命令都只动进攻钟,于是"进攻钟在跑、比赛钟停着"是能按出来的状态。
     */
    case 'shot.start': {
      const kick = ensureGameClockRunning(m, now);
      if (kick.tipOff) followShotClock(m, now, true); // 开球:满 24 秒起步
      else m.shotClock = startShotClock(m.shotClock, now);
      log = kick.started ? '进攻钟开始(比赛钟同时开始)' : '进攻钟开始';
      break;
    }
    case 'shot.pause':
      m.shotClock = pauseShotClock(m.shotClock, now);
      log = '进攻钟暂停';
      break;
    case 'shot.toggle': {
      if (m.shotClock.running) {
        m.shotClock = pauseShotClock(m.shotClock, now);
        log = '进攻钟暂停';
      } else {
        const kick = ensureGameClockRunning(m, now);
        if (kick.tipOff) followShotClock(m, now, true);
        else m.shotClock = startShotClock(m.shotClock, now);
        log = kick.started ? '进攻钟开始(比赛钟同时开始)' : '进攻钟开始';
      }
      break;
    }
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
      // 「重置并开表」= 两个钟一起走:比赛钟停着就把它带起来。
      // (篮球里进攻钟数的是比赛时间,比赛钟停着的时候进攻钟不该自己在走)
      const kick = start ? ensureGameClockRunning(m, now) : { started: false, tipOff: false };
      m.shotClock = resetShotClock(m.shotClock, { ...m.rules, shotClockSeconds: seconds }, now, start);
      log = start
        ? kick.started
          ? `进攻钟重置 ${seconds}s 并开始(比赛钟同时开始)`
          : `进攻钟重置 ${seconds}s 并开始`
        : `进攻钟重置 ${seconds}s`;
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

    /* --------------------- 足球:半场 / 补时 / 中场 --------------------- */
    /*
     * 足球比篮球多两个表,球场上的流程是这样:
     *
     *   上半场 00:00 → 45:00(主钟到点自动停表,服务端在 hub 循环里做)
     *        → 裁判宣布补时 4 分钟(补时表开走,主钟停在 45:00)
     *        → 补时归零 → **自动进入中场休息**(倒计时停着,等计分员按开始)
     *        → 中场 15 分钟归零 → 停表(**绝不自动开始下半场**)
     *        → 计分员按「结束中场休息」→ 下半场,主钟回到 45:00 停着
     *
     * 三个表各走各的:主钟、补时表、中场倒计时,互不干扰。
     * 进球不停表 —— 什么时候停由裁判决定,计分员按「暂停」即可。
     */
    case 'half.end': {
      // 上半场结束:主钟停表并停在 45:00(足球的表往上走,到点就是 45:00)
      m.status = 'live';
      m.clock = setClock(pauseClock(m.clock, now), 0, now);
      log = '上半场结束';
      break;
    }
    case 'addedTime.set': {
      const seconds = Number(p.seconds ?? 0);
      const start = p.start === true;
      if (seconds <= 0) {
        // 0 = 清除补时
        m.addedTime = null;
        log = '已清除补时';
        break;
      }
      const anchor = setAddedTime(seconds, now, start);
      m.addedTime = anchor;
      log = start
        ? `补时 ${formatAddedTime(anchor.durationMs)} 并开始`
        : `补时 ${formatAddedTime(anchor.durationMs)}`;
      break;
    }
    case 'addedTime.toggle': {
      if (!m.addedTime) {
        log = '还没有设补时';
        break;
      }
      m.addedTime = toggleAddedTime(m.addedTime, now);
      log = m.addedTime.running ? '补时开始' : '补时暂停';
      break;
    }
    case 'halftime.start': {
      if (!m.halftime) {
        // 第一次按 = 进入中场休息(倒计时先停着)
        m.halftime = enterHalftime(halftimeDurationMs(m.rules), now);
      }
      const left = currentRemaining(m.halftime, now);
      // 倒计时已经归零还按 = 重新计时(中场延时)
      m.halftime = left <= 0 ? rearmHalftime(m.halftime, now) : startHalftime(m.halftime, now);
      log = '中场休息开始';
      break;
    }
    case 'halftime.toggle': {
      if (!m.halftime) {
        log = '当前不在中场休息';
        break;
      }
      m.halftime = toggleHalftime(m.halftime, now);
      log = m.halftime.running ? '中场倒计时继续' : '中场倒计时暂停';
      break;
    }
    case 'halftime.end': {
      // 中场结束 → 下半场:主钟回到 45:00 停着,等计分员按「开始比赛」。
      // 绝不自动开表 —— 球员还没回场,表不能自己开始走。
      m.status = 'live';
      m.halftime = null;
      m.addedTime = null;
      m.clock = setPeriod(m.clock, 2, m.rules, m.status, now, { sport: m.sport });
      log = '中场结束,进入下半场';
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
        // 足球:中场休息屏与补时也要撤下来 —— 否则大屏上会盖着
        // "中场休息 15:00",底下却是全场结束,自相矛盾。
        m.halftime = null;
        m.addedTime = null;
      }
      log = st === 'finished' ? '比赛结束' : st === 'live' ? '比赛开始' : '比赛未开始';
      break;
    }
    case 'match.final': {
      m.status = 'finished';
      m.clock = pauseClock(m.clock, now);
      m.shotClock = pauseShotClock(m.shotClock, now);
      m.timeout = endTimeoutAnchor();
      m.halftime = null;
      m.addedTime = null;
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
      if (isSportId(patch.sport)) next.sport = patch.sport;
      /*
       * 换项目 → 规则跟着换成新项目的默认(2×45 而不是 4×10),
       * 再让客户端明确传过来的部分盖上去。
       */
      if (patch.sport && patch.sport !== m.sport) {
        next.rules = { ...defaultRulesFor(patch.sport), ...(patch.rules ?? {}) };
      } else if (patch.rules) {
        next.rules = { ...next.rules, ...patch.rules };
      }
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
      relabel(next);
      /*
       * 取消勾选「使用进攻钟」→ **立刻把还在跑的进攻钟停住**。
       *
       * 早先这里只改了规则里的标志位,进攻钟的锚点照旧在跑:
       * 界面上进攻钟面板没了(客户端按标志位藏的),可服务端那边它还在倒数,
       * 十几秒后归零 → 判成「24 秒违例」→ 停比赛钟 + 大屏整屏红闪长鸣。
       * 现场看到的现象就是"明明把进攻钟关了,还是响了一声违例"。
       *
       * 停住时保留当前剩余值(不算成 0):重新勾选回来还能接着用,
       * 要满表起步由计分员按「重置并开表」决定。
       */
      if (!shotClockEnabled(next) && next.shotClock.running) {
        next.shotClock = pauseShotClock(next.shotClock, now);
      }
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

  // 节次标签恒由 (period, periods, status, 项目, 是否中场) 推导,放在出口统一重算。
  // 否则状态在命令之间来回切(如「比赛结束 → 重新开打」)时,标签会残留旧的 FINAL,
  // 大屏会在 Q2 走表时仍显示 FINAL。
  relabel(m);

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
export function rejectReason(
  m: Match,
  type: CommandType,
  payload: unknown,
  now: number = serverNow(),
): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const side: Side = p.side === 'away' ? 'away' : 'home';
  const team = side === 'home' ? m.home : m.away;

  switch (type) {
    /*
     * 本场不用进攻钟 → 进攻钟的命令一律拒掉。
     *
     * 界面上进攻钟面板已经藏起来了,正常不会有人按到;
     * 但服务端也得有自己的判断 —— 命令通道是公开的(拿控制令牌就能发),
     * 而且"按错了还给个绿灯"比"直接拒掉"糟得多。
     */
    case 'shot.start':
    case 'shot.pause':
    case 'shot.toggle':
    case 'shot.adjust':
    case 'shot.set':
    case 'shot.reset':
    case 'shot.violation':
      if (!shotClockEnabled(m)) return '本场不使用进攻钟';
      return null;
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
      /*
       * 比赛钟在跑的时候**不许开启**进攻钟。
       *
       * 进攻钟数的是比赛时间:表已经在走了这时把它拉起来,两个钟对不上,
       * 而且开球那一下的"满 24 秒起步"也没法给(球权早就开始了)。
       * 要开:先暂停比赛钟 → 勾上 → 再按「开始比赛」。
       *
       * 只管"开启":已经开着时运行中**可以关**(校赛临时改规矩);
       * 控制台的「重置并开表」也不受这条限制 —— 那是场上做的事,不是配置开关。
       */
      const rulePatch = patch.rules as { useShotClock?: unknown } | undefined;
      if (
        rulePatch &&
        rulePatch.useShotClock === true &&
        !canTurnOnShotClock({ clockRunning: m.clock.running, useShotClock: m.rules.useShotClock })
      ) {
        return '比赛钟在跑,先暂停比赛钟再开启进攻钟';
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
    /* ------------------- 足球:半场 / 补时 / 中场 ------------------- */
    /*
     * 这些拒绝理由是给现场看的,说人话:
     * 计分员按错顺序(比如上半场还没打完就按「开始中场休息」)时,
     * 界面会弹这句中文,而不是默默按下去没反应。
     */
    case 'half.end': {
      if (!isFootball(m)) return '本场不是足球比赛';
      if (m.halftime) return '已经在中场休息';
      if (m.clock.period >= 2) return '已经是下半场';
      return null;
    }
    case 'addedTime.set': {
      if (!isFootball(m)) return '本场不是足球比赛';
      if (m.halftime) return '中场休息期间不能设补时';
      const seconds = Number(p.seconds ?? 0);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_ADDED_TIME_SECONDS) {
        return `补时应在 0 到 ${Math.round(MAX_ADDED_TIME_SECONDS / 60)} 分钟之间`;
      }
      // 补时是半场结束之后才宣布的:主钟还在跑就开补时表,那是把两个表搞混了
      if (p.start === true && !halfEnded(m, now)) {
        return m.clock.period >= 2 ? '下半场还没结束' : '上半场还没结束';
      }
      return null;
    }
    case 'addedTime.toggle': {
      if (!isFootball(m)) return '本场不是足球比赛';
      if (m.halftime) return '中场休息期间不能设补时';
      if (!m.addedTime) return '还没有设补时';
      return null;
    }
    case 'halftime.start': {
      if (!isFootball(m)) return '本场不是足球比赛';
      if (m.halftime) return null; // 已经在中场 → 就是把倒计时开起来
      if (m.clock.period >= 2) return '已经是下半场';
      if (!halfEnded(m, now)) return '上半场还没结束';
      // 补时还在跑 → 半场其实没完,不能进中场
      if (m.addedTime?.running && currentRemaining(m.addedTime, now) > 0) {
        return '补时还没结束';
      }
      return null;
    }
    case 'halftime.toggle':
    case 'halftime.end': {
      if (!isFootball(m)) return '本场不是足球比赛';
      if (!m.halftime) return '当前不在中场休息';
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
    periodLabel: buildPeriodLabel(1, m.rules.periods, 'scheduled', { sport: m.sport }),
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
  // 足球:补时与中场休息一并回到"没有"的状态
  m.addedTime = null;
  m.halftime = null;
  m.seq = current.seq + 1;
  m.updatedAt = now;
  m.lastEvent = '比赛已重置';
  return m;
}

export { currentRemaining };
