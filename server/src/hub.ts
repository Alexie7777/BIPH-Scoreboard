import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_VENUE_LOCALE,
  buildPeriodLabel,
  isLocale,
  type ClientMsg,
  type CommandType,
  type Locale,
  type Match,
  type MatchHealth,
  type Role,
  type ServerMsg,
} from '@biph/shared';
import { config } from './config.js';
import { currentRemaining, endTimeoutAnchor, pauseClock, pauseShotClock, serverNow } from './clock.js';
import { applyCommand, createMatch, newId, rejectReason, resetMatch } from './match.js';
import type { Store } from './db.js';

/** 场馆语言在设置表里的键 */
const VENUE_LOCALE_KEY = 'venueLocale';

export interface Conn {
  id: string;
  ws: WebSocket;
  matchId: string;
  role: Role;
  token: string | null;
}

interface Runtime {
  match: Match;
  operatorToken: string;
  graphicsToken: string;
  /** 上一次循环时的比赛钟剩余(ms),用于检测归零瞬间 */
  lastRemaining: number;
  lastShotRemaining: number;
  lastCommandAt: number;
  lastSyncAt: number;
  /** 命令去重(幂等) */
  seenCmdIds: Set<string>;
  /** 撤销栈索引 */
  undoIdx: number;
}

export function randomToken(): string {
  return randomBytes(16).toString('hex');
}

export class Hub {
  private readonly store: Store;
  private readonly runtimes = new Map<string, Runtime>();
  private readonly conns = new Map<string, Conn>();
  private readonly byMatch = new Map<string, Set<string>>();
  private loopTimer: NodeJS.Timeout | null = null;
  private lastTickSecond = -1;
  /**
   * 场馆语言(整个服务器一个)。
   *
   * 为什么语言要提到"场馆"这一层:
   * 管理台(场地清单)没有"本场"概念,控制台/大屏却有。
   * 如果语言只存在每场比赛里,就会出现"管理台是中文、控制台是英文"
   * 这种同一次比赛里两种语言的情况 —— 现场看着像坏了。
   * 所以语言以这里为准,再镜像到每场比赛的 presentation.locale:
   * 大屏/控制台继续读本场字段(协议不变),但它们的值永远一致。
   */
  private venueLocale: Locale = DEFAULT_VENUE_LOCALE;

  constructor(store: Store) {
    this.store = store;
  }

  /* ------------------------------ 启动 ------------------------------ */

  /** 从数据库恢复所有比赛(服务器重启不丢比赛) */
  load(): void {
    const stored = this.store.getSetting(VENUE_LOCALE_KEY);
    // 场馆语言始终是具体的:没存过就用默认值。
    // "各设备各看各的本机偏好"那种模式会让管理台与控制台对不上,不能留。
    this.venueLocale = stored && isLocale(stored) ? stored : DEFAULT_VENUE_LOCALE;

    for (const row of this.store.listRows()) {
      const match = JSON.parse(row.data) as Match;
      const now = serverNow();
      // 归一化节次标签:标签恒由 (period, periods, status) 推导。
      // 旧库可能存着状态回退前残留的 FINAL,这里按当前状态重算一次。
      match.clock = {
        ...match.clock,
        periodLabel: buildPeriodLabel(match.clock.period, match.rules.periods, match.status),
      };
      // 老库里没有运动项目字段,统一按篮球补上
      if (!match.sport) match.sport = 'basketball';
      // 老库里没有暂停时长与暂停倒计时,统一补上默认值
      if (!Number.isFinite(match.rules.timeoutSeconds) || (match.rules.timeoutSeconds ?? 0) <= 0) {
        match.rules.timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
      }
      if (!match.timeout) match.timeout = endTimeoutAnchor();
      // 语言以场馆为准:老库里各场比赛存的语言可能五花八门,启动时统一成场馆语言
      const localeDirty = match.presentation.locale !== this.venueLocale;
      match.presentation = { ...match.presentation, locale: this.venueLocale };
      this.runtimes.set(match.id, {
        match,
        operatorToken: row.operator_token,
        graphicsToken: row.graphics_token,
        lastRemaining: currentRemaining(match.clock, now),
        lastShotRemaining: currentRemaining(match.shotClock, now),
        lastCommandAt: match.updatedAt,
        lastSyncAt: now,
        seenCmdIds: new Set(),
        undoIdx: this.store.countUndo(match.id),
      });
      // 只在语言真的变了的时候才回写,避免每次启动都无谓地动所有行
      if (localeDirty) this.store.updateMatch(match);
    }
  }

  start(): void {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => this.loop(), config.loopIntervalMs);
    this.loopTimer.unref?.();
  }

  stop(): void {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  /* ------------------------------ 查询 ------------------------------ */

  getMatch(id: string): Match | null {
    return this.runtimes.get(id)?.match ?? null;
  }

  listMatches(): Match[] {
    return [...this.runtimes.values()]
      .map((r) => r.match)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  health(): Record<string, MatchHealth> {
    const out: Record<string, MatchHealth> = {};
    for (const [id, rt] of this.runtimes) {
      const set = this.byMatch.get(id);
      let controls = 0;
      let displays = 0;
      if (set) {
        for (const cid of set) {
          const c = this.conns.get(cid);
          if (!c) continue;
          if (c.role === 'control') controls += 1;
          else displays += 1;
        }
      }
      out[id] = {
        clients: set?.size ?? 0,
        controls,
        displays,
        lastSyncAt: rt.lastSyncAt,
        lastCommandAt: rt.lastCommandAt,
      };
    }
    return out;
  }

  tokensOf(id: string): { operatorToken: string; graphicsToken: string } | null {
    const rt = this.runtimes.get(id);
    return rt ? { operatorToken: rt.operatorToken, graphicsToken: rt.graphicsToken } : null;
  }

  /* ------------------------------ 场馆语言 ------------------------------ */

  /** 当前场馆语言 */
  getVenueLocale(): Locale {
    return this.venueLocale;
  }

  /**
   * 设置场馆语言,并镜像到每一场比赛。
   *
   * 镜像的意义:大屏与控制台读的是"本场"的 presentation.locale(协议不变),
   * 但服务端保证每场比赛的值都等于场馆语言 —— 于是
   * 「管理台(场馆级)」「控制台(本场级)」「大屏(本场级)」永远是同一个语言。
   *
   * null 一律归一成默认值:场馆语言必须是具体的,
   * 否则各设备会退回各看各的本机偏好,管理台与控制台又对不上了。
   */
  setVenueLocale(locale: Locale | null): Locale {
    const next = locale ?? DEFAULT_VENUE_LOCALE;
    this.venueLocale = next;
    this.store.setSetting(VENUE_LOCALE_KEY, next);

    const now = serverNow();
    for (const [id, rt] of this.runtimes) {
      if ((rt.match.presentation.locale ?? null) === next) continue;
      rt.match = {
        ...rt.match,
        presentation: { ...rt.match.presentation, locale: next },
        seq: rt.match.seq + 1,
        updatedAt: now,
      };
      this.persist(rt);
      // 每场比赛各自广播:它们连的是各自的频道
      this.broadcastState(id);
    }
    return next;
  }

  /* ------------------------------ 比赛管理 ------------------------------ */

  createMatch(req: Parameters<typeof createMatch>[0]): {
    match: Match;
    operatorToken: string;
    graphicsToken: string;
  } {
    const now = serverNow();
    const match = createMatch(req, now, newId());
    // 新比赛直接继承场馆语言,免得刚建出来就与别的场不一致
    match.presentation = { ...match.presentation, locale: this.venueLocale };
    const operatorToken = randomToken();
    const graphicsToken = randomToken();
    this.store.insertMatch(match, operatorToken, graphicsToken);
    this.runtimes.set(match.id, {
      match,
      operatorToken,
      graphicsToken,
      lastRemaining: match.clock.remainingMs,
      lastShotRemaining: match.shotClock.remainingMs,
      lastCommandAt: now,
      lastSyncAt: now,
      seenCmdIds: new Set(),
      undoIdx: 0,
    });
    return { match, operatorToken, graphicsToken };
  }

  deleteMatch(id: string): boolean {
    if (!this.runtimes.has(id)) return false;
    this.store.deleteMatch(id);
    this.runtimes.delete(id);
    for (const cid of this.byMatch.get(id) ?? []) {
      const c = this.conns.get(cid);
      if (c) this.closeConn(c);
    }
    this.byMatch.delete(id);
    return true;
  }

  resetMatch(id: string): Match | null {
    const rt = this.runtimes.get(id);
    if (!rt) return null;
    const now = serverNow();
    this.snapshot(rt);
    rt.match = resetMatch(rt.match, now);
    this.persist(rt);
    this.broadcastState(id);
    return rt.match;
  }

  /** 直接替换比赛(配置编辑用) */
  replaceMatch(match: Match): void {
    const rt = this.runtimes.get(match.id);
    if (!rt) return;
    const prevLocale = rt.match.presentation.locale ?? null;
    rt.match = { ...match, seq: rt.match.seq + 1, updatedAt: serverNow() };
    this.persist(rt);
    this.broadcastState(match.id);
    // 改了语言 = 改了场馆语言:其他场次一起跟上
    if ((rt.match.presentation.locale ?? null) !== prevLocale) {
      this.setVenueLocale(rt.match.presentation.locale ?? null);
    }
  }

  /* ------------------------------ 连接 ------------------------------ */

  addConn(ws: WebSocket, matchId: string, role: Role, token: string | null): Conn | null {
    const rt = this.runtimes.get(matchId);
    if (!rt) return null;

    // 权限校验
    if (role === 'control' && token !== rt.operatorToken) return null;
    if (role === 'graphics' && token !== rt.graphicsToken && token !== rt.operatorToken) {
      return null;
    }

    const conn: Conn = { id: randomToken(), ws, matchId, role, token };
    this.conns.set(conn.id, conn);
    let set = this.byMatch.get(matchId);
    if (!set) {
      set = new Set();
      this.byMatch.set(matchId, set);
    }
    set.add(conn.id);

    this.send(conn, { t: 'state', seq: rt.match.seq, serverTs: serverNow(), match: rt.match });
    return conn;
  }

  removeConn(conn: Conn): void {
    this.conns.delete(conn.id);
    const set = this.byMatch.get(conn.matchId);
    if (set) {
      set.delete(conn.id);
      if (set.size === 0) this.byMatch.delete(conn.matchId);
    }
  }

  closeConn(conn: Conn): void {
    try {
      conn.ws.close();
    } catch {
      /* ignore */
    }
    this.removeConn(conn);
  }

  /* ------------------------------ 消息处理 ------------------------------ */

  handleMessage(conn: Conn, raw: string): void {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }

    if (msg.t === 'ping') {
      this.send(conn, { t: 'pong', t0: msg.t0, serverTs: serverNow() });
      return;
    }

    if (msg.t !== 'cmd') return;
    if (conn.role === 'display') {
      this.send(conn, {
        t: 'ack',
        cmdId: msg.cmdId,
        seq: this.runtimes.get(conn.matchId)?.match.seq ?? 0,
        ok: false,
        error: 'display 角色为只读',
      });
      return;
    }

    const result = this.applyCommand(conn.matchId, msg.cmdId, msg.type, msg.payload);
    const rt = this.runtimes.get(conn.matchId);
    this.send(conn, {
      t: 'ack',
      cmdId: msg.cmdId,
      seq: rt?.match.seq ?? 0,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
    });
  }

  /**
   * 应用一条命令。
   * 幂等:同一个 cmdId 重复提交只生效一次(网络重试场景)。
   */
  applyCommand(
    matchId: string,
    cmdId: string,
    type: CommandType,
    payload: unknown,
  ): { ok: boolean; error?: string } {
    const rt = this.runtimes.get(matchId);
    if (!rt) return { ok: false, error: '比赛不存在' };

    if (rt.seenCmdIds.has(cmdId)) {
      return { ok: true }; // 已处理过,直接幂等返回
    }
    rt.seenCmdIds.add(cmdId);
    if (rt.seenCmdIds.size > 500) {
      // 保留最近的 250 条
      const keep = [...rt.seenCmdIds].slice(-250);
      rt.seenCmdIds = new Set(keep);
    }

    const now = serverNow();

    // undo 特殊处理:从栈里还原
    if (type === 'undo') {
      const restored = this.store.popUndo(matchId);
      if (!restored) return { ok: false, error: '没有可撤销的操作' };
      rt.undoIdx = Math.max(0, rt.undoIdx - 1);
      rt.match = { ...restored, seq: rt.match.seq + 1, updatedAt: now };
      this.persist(rt);
      this.broadcastState(matchId);
      this.store.appendLog(matchId, now, `撤销: ${rt.match.lastEvent ?? ''}`);
      return { ok: true };
    }

    // 会被拒绝的命令:直接回失败。
    // 放在压撤销栈之前 —— 按了没生效的操作不该出现在撤销栈里。
    const reason = rejectReason(rt.match, type, payload);
    if (reason) return { ok: false, error: reason };

    // 撤销前先压栈
    this.snapshot(rt);
    this.store.pushUndo(matchId, rt.undoIdx, JSON.stringify(rt.match));
    rt.undoIdx += 1;
    this.store.trimUndo(matchId, config.undoDepth);

    const result = applyCommand(rt.match, type, payload, now);
    if (!result.match) return { ok: false, error: '未知命令' };

    const prevLocale = rt.match.presentation.locale ?? null;
    rt.match = result.match;
    rt.lastCommandAt = now;
    this.persist(rt);

    if (result.log) this.store.appendLog(matchId, now, result.log);
    for (const ev of result.events) {
      this.broadcast(matchId, { t: 'event', kind: ev.kind, at: now, message: ev.message });
    }

    this.broadcastState(matchId);
    /*
     * 改了语言 = 改了场馆语言。
     *
     * 计分员在 iPad 上切语言时,这里把整个场馆都切过去:
     * 别的场次的大屏与控制台一起跟上,管理台(场馆级)也跟着变。
     * 否则会出现"管理台是中文、控制台是英文"这种看着像坏了的情况。
     */
    if ((rt.match.presentation.locale ?? null) !== prevLocale) {
      this.setVenueLocale(rt.match.presentation.locale ?? null);
    }
    return { ok: true };
  }

  /* ------------------------------ 广播 ------------------------------ */

  broadcastState(matchId: string): void {
    const rt = this.runtimes.get(matchId);
    if (!rt) return;
    const now = serverNow();
    rt.lastSyncAt = now;
    this.broadcast(matchId, { t: 'state', seq: rt.match.seq, serverTs: now, match: rt.match });
  }

  broadcast(matchId: string, msg: ServerMsg): void {
    const set = this.byMatch.get(matchId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const cid of set) {
      const c = this.conns.get(cid);
      if (!c) continue;
      this.sendRaw(c, data);
    }
  }

  private send(conn: Conn, msg: ServerMsg): void {
    this.sendRaw(conn, JSON.stringify(msg));
  }

  private sendRaw(conn: Conn, data: string): void {
    if (conn.ws.readyState !== 1) return; // 1 = OPEN
    try {
      conn.ws.send(data);
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------ 内部循环 ------------------------------ */

  /**
   * 周期循环:
   *  1. 每秒广播一次轻量 tick(只带两个锚点)—— 客户端据此自愈
   *  2. 检测比赛钟/进攻钟归零的瞬间,广播事件(用于大屏视觉提示)
   */
  private loop(): void {
    const now = serverNow();

    for (const [matchId, rt] of this.runtimes) {
      const rem = currentRemaining(rt.match.clock, now);
      const shotRem = currentRemaining(rt.match.shotClock, now);

      // 归零检测:从 >0 变成 0
      if (rt.lastRemaining > 0 && rem === 0) {
        this.broadcast(matchId, { t: 'event', kind: 'clockZero', at: now });
      }
      if (rt.lastShotRemaining > 0 && shotRem === 0) {
        /*
         * 24 秒违例 —— 进攻钟归零的那一刻自动做三件事:
         *   1) 停比赛钟(球权要转移,表不能继续跑)
         *   2) 记一条日志
         *   3) 广播事件,让大屏红闪 + 蜂鸣
         *
         * 球权转交与复位【不自动做】:FIBA 有一条例外 ——
         * 球在空中、进攻钟归零前已离手、随后碰到篮筐的,不算违例。
         * 自动判罚会在这种情况下误判,所以最后这一步交给计分员
         * 按控制台上的「24 秒违例」按钮。
         *
         * 这一步不走命令通道(不压撤销栈):它是时间流逝的自然结果,
         * 不是"计分员做的一个操作" —— 和下面暂停倒计时归零自动收尾一个道理。
         */
        rt.match = {
          ...rt.match,
          clock: pauseClock(rt.match.clock, now),
          shotClock: pauseShotClock(rt.match.shotClock, now),
          seq: rt.match.seq + 1,
          updatedAt: now,
          lastEvent: '24 秒违例',
        };
        this.persist(rt);
        this.store.appendLog(matchId, now, '24 秒违例');
        this.broadcast(matchId, { t: 'event', kind: 'shotClockZero', at: now });
        this.broadcastState(matchId);
      }
      rt.lastRemaining = rem;
      rt.lastShotRemaining = shotRem;

      /*
       * 暂停倒计时归零 → 自动收尾:大屏撤下倒计时。
       *
       * 这一步不走命令通道(不压撤销栈):它是时间流逝的自然结果,
       * 不是"计分员做的一个操作",不该出现在撤销历史里。
       * 比赛钟保持暂停 —— 球员没回场,表不能自己开始走。
       */
      const to = rt.match.timeout;
      if (to?.running && currentRemaining(to, now) <= 0) {
        rt.match = {
          ...rt.match,
          timeout: endTimeoutAnchor(),
          seq: rt.match.seq + 1,
          updatedAt: now,
        };
        this.persist(rt);
        this.broadcastState(matchId);
      }
    }

    // 每秒广播一次 tick
    const second = Math.floor(now / 1000);
    if (second !== this.lastTickSecond) {
      this.lastTickSecond = second;
      for (const [matchId, rt] of this.runtimes) {
        if (!this.byMatch.has(matchId)) continue;
        this.broadcast(matchId, {
          t: 'tick',
          seq: rt.match.seq,
          serverTs: now,
          clock: rt.match.clock,
          shotClock: rt.match.shotClock,
        });
      }
    }
  }

  /* ------------------------------ 持久化 ------------------------------ */

  private snapshot(rt: Runtime): void {
    // 撤销栈由 store 管理,这里仅保留当前态
  }

  private persist(rt: Runtime): void {
    this.store.updateMatch(rt.match);
  }
}
