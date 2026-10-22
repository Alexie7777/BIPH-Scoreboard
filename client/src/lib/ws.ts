/**
 * WebSocket 客户端。
 *
 * 【本项目最核心的正确性保证】
 * 服务器只发"锚点",客户端用单调时钟(performance.now())本地推算剩余时间:
 *
 *   每收到一条带 serverTs 的消息:
 *     lastServerTs = msg.serverTs
 *     lastRecvPerf = performance.now()
 *
 *   当前服务器时间 = lastServerTs + (performance.now() - lastRecvPerf)
 *   显示剩余时间 = remainingMs(anchor, serverNow())
 *
 * 因此:
 *   - 绝不用 Date.now() 去算倒计时
 *   - 绝不自写 setInterval 递减计数器
 *   - 断网期间时钟照常走(锚点还在本地,只是收不到新的 tick)
 */
import type { ClientMsg, ClockAnchor, CommandType, EventKind, Match, Role, ServerMsg } from '@biph/shared';
import { estimatedServerNow } from './api';

export type SocketStatus = 'connecting' | 'online' | 'offline';

export interface MatchSocketOptions {
  matchId: string;
  role: Role;
  token?: string | null;
  onState(match: Match): void;
  onTick(clock: ClockAnchor, shotClock: ClockAnchor): void;
  onAck(cmdId: string, ok: boolean, error?: string): void;
  onEvent(kind: EventKind, message?: string): void;
  onStatus(status: SocketStatus): void;
  /** 每次(重)连上之后触发 —— 页面据此立刻拉一次全量状态 */
  onOpen(): void;
}

const BACKOFF_MS = [500, 1000, 2000, 4000];
const BACKOFF_CAP_MS = 5000;
const PING_INTERVAL_MS = 5000;

function buildWsUrl(matchId: string, role: Role, token?: string | null): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ role });
  if (token) params.set('t', token);
  return `${proto}//${window.location.host}/ws/${encodeURIComponent(matchId)}?${params.toString()}`;
}

function randomCmdId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export class MatchSocket {
  private readonly opts: MatchSocketOptions;
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private retryIndex = 0;
  private retryTimer: number | null = null;
  private pingTimer: number | null = null;
  private lastSeq = -1;

  /** 最近一次收到的服务器时刻 */
  private lastServerTs = 0;
  /** 最近一次收到该消息时的 performance.now() */
  private lastRecvPerf = 0;

  constructor(opts: MatchSocketOptions) {
    this.opts = opts;
  }

  /** 估算"当前服务器时间"(ms) */
  serverNow(): number {
    if (!this.lastServerTs) return estimatedServerNow();
    return this.lastServerTs + (performance.now() - this.lastRecvPerf);
  }

  /** 是否已经拿到过一个可信的服务器时刻 */
  hasServerTime(): boolean {
    return this.lastServerTs > 0;
  }

  /**
   * 手动用 REST 拿到的时间播种(连接建立前的第一帧也能正确显示)。
   *
   * 只在【还没有任何时间基准】时生效:一旦 WS 送来过 serverTs,
   * 本地推算就已经在跑了,再拿 REST 的值覆盖反而可能把连续的时间轴打断。
   */
  seedServerTime(serverTs: number): void {
    if (!Number.isFinite(serverTs) || serverTs <= 0) return;
    if (this.lastServerTs > 0) return;
    this.lastServerTs = serverTs;
    this.lastRecvPerf = performance.now();
  }

  connect(): void {
    this.closedByUser = false;
    this.opts.onStatus('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(buildWsUrl(this.opts.matchId, this.opts.role, this.opts.token));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retryIndex = 0;
      this.opts.onStatus('online');
      this.sendPing();
      this.startPingLoop();
      this.opts.onOpen();
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      this.handle(msg);
    };

    ws.onerror = () => {
      /* onclose 会随后触发,统一在那里处理重连 */
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      this.stopPingLoop();
      this.ws = null;
      if (this.closedByUser) return;
      this.opts.onStatus('offline');
      this.scheduleReconnect();
    };
  }

  close(): void {
    this.closedByUser = true;
    this.stopPingLoop();
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  /**
   * 下发命令。
   *
   * @returns 成功发出时返回本次命令的 cmdId(用来和服务端的 ack 对上号),
   *          未连接或发送失败时返回 null(调用方可提示用户)
   */
  send(type: CommandType, payload?: unknown): string | null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;
    const cmdId = randomCmdId();
    const msg: ClientMsg = { t: 'cmd', cmdId, type, payload };
    try {
      this.ws.send(JSON.stringify(msg));
      return cmdId;
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------- 内部 */

  private handle(msg: ServerMsg): void {
    if ('serverTs' in msg && typeof msg.serverTs === 'number') {
      this.lastServerTs = msg.serverTs;
      this.lastRecvPerf = performance.now();
    }

    switch (msg.t) {
      case 'state': {
        if (msg.seq <= this.lastSeq) return; // 乱序/重复,丢弃
        this.lastSeq = msg.seq;
        this.opts.onState(msg.match);
        break;
      }
      case 'tick': {
        if (msg.seq <= this.lastSeq) return;
        this.lastSeq = msg.seq;
        this.opts.onTick(msg.clock, msg.shotClock);
        break;
      }
      case 'ack': {
        this.opts.onAck(msg.cmdId, msg.ok, msg.error);
        break;
      }
      case 'event': {
        this.opts.onEvent(msg.kind, msg.message);
        break;
      }
      case 'pong': {
        // pong 自带 serverTs,上面已经更新过时间基准
        break;
      }
      default:
        break;
    }
  }

  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: ClientMsg = { t: 'ping', t0: Date.now() };
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingTimer = window.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    const base = BACKOFF_MS[Math.min(this.retryIndex, BACKOFF_MS.length - 1)] ?? BACKOFF_CAP_MS;
    const delay = Math.min(base, BACKOFF_CAP_MS);
    this.retryIndex += 1;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (!this.closedByUser) this.connect();
    }, delay);
  }
}
