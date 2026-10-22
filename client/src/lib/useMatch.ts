/**
 * 单场比赛的实时状态 hook。
 *
 * 数据来源:
 *   - WebSocket:`state` 全量替换、`tick` 只换两个时钟锚点
 *   - REST:连接建立 / 重连后立刻补一次全量(契约里没有"拉状态"的 WS 指令)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClockAnchor, CommandType, EventKind, Match, Role } from '@biph/shared';
import { MatchSocket, type SocketStatus } from './ws';
import { estimatedServerNow, getMatch } from './api';

export interface UseMatchOptions {
  matchId: string | undefined;
  role: Role;
  token?: string | null;
  enabled?: boolean;
  /**
   * 服务端广播的事件(如手动蜂鸣 'buzzer')。
   * 注意:时钟归零的蜂鸣**不靠这里** —— 大屏用本地推算判断,断网也能响。
   */
  onEvent?: (kind: EventKind, message?: string) => void;
  /**
   * 命令回执:服务端对每条命令的答复。
   *
   * ok=true 表示"命令确实生效了",ok=false 时 error 是中文原因。
   * 控制台靠它弹"操作已生效"的提示 —— 没有它就只能凭空猜测命令有没有用。
   */
  onAck?: (cmdId: string, ok: boolean, error?: string) => void;
}

export interface UseMatchResult {
  match: Match | null;
  status: SocketStatus;
  /** 估算的当前服务器时间(ms) */
  serverNow: () => number;
  /**
   * 下发命令。
   * @returns 成功发出时返回本次命令的 cmdId(与 ack 一一对应);没发出去时返回 null
   */
  send: (type: CommandType, payload?: unknown) => string | null;
  /** 等待 ack 的命令数 */
  pending: number;
  /** 手动拉一次全量 */
  refresh: () => void;
}

export function useMatch(options: UseMatchOptions): UseMatchResult {
  const { matchId, role, token, enabled = true } = options;

  const [match, setMatch] = useState<Match | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [ackTick, setAckTick] = useState(0);

  const socketRef = useRef<MatchSocket | null>(null);
  const pendingRef = useRef<Set<string>>(new Set());
  // 事件回调放 ref:避免调用方每次渲染传新函数导致 WebSocket 被反复重建
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;
  // 同理:ack 回调也放 ref,否则每次渲染换新函数会让 WebSocket 反复重建
  const onAckRef = useRef(options.onAck);
  onAckRef.current = options.onAck;

  const pullFullState = useCallback(async () => {
    if (!matchId) return;
    try {
      const res = await getMatch(matchId);
      setMatch(res.match);
      // 用服务端给的时刻播种(不是本机 Date.now()),
      // 避免 iPad 与服务器存在时钟偏差时把倒计时整体带偏。
      socketRef.current?.seedServerTime(res.serverTs);
    } catch {
      /* 拉取失败不致命:WS 的 state 消息会补上 */
    }
  }, [matchId]);

  useEffect(() => {
    if (!matchId || !enabled) return;

    const socket = new MatchSocket({
      matchId,
      role,
      token: token ?? null,
      onState: (m) => setMatch(m),
      onTick: (clock: ClockAnchor, shotClock: ClockAnchor) => {
        setMatch((prev) => (prev ? { ...prev, clock, shotClock } : prev));
      },
      onAck: (cmdId, ok, err) => {
        pendingRef.current.delete(cmdId);
        setAckTick((n) => n + 1);
        onAckRef.current?.(cmdId, ok, err);
      },
      onEvent: (kind, message) => {
        // 默认不用事件:大屏的时钟归零蜂鸣完全靠本地推算,断网也能响。
        // 需要响应服务端广播(比如手动蜂鸣)时,由调用方传 onEvent 进来。
        onEventRef.current?.(kind, message);
      },
      onStatus: (s) => setStatus(s),
      onOpen: () => {
        void pullFullState();
      },
    });

    socketRef.current = socket;
    socket.connect();
    void pullFullState();

    return () => {
      socket.close();
      socketRef.current = null;
      pendingRef.current.clear();
    };
  }, [matchId, role, token, enabled, pullFullState]);

  const send = useCallback((type: CommandType, payload?: unknown): string | null => {
    const socket = socketRef.current;
    if (!socket) return null;
    const cmdId = socket.send(type, payload);
    if (cmdId) pendingRef.current.add(cmdId);
    return cmdId;
  }, []);

  const refresh = useCallback(() => {
    void pullFullState();
  }, [pullFullState]);

  const serverNow = useCallback(() => {
    const socket = socketRef.current;
    if (socket) return socket.serverNow();
    return estimatedServerNow();
  }, []);

  return useMemo(
    () => ({
      match,
      status,
      serverNow,
      send,
      pending: pendingRef.current.size,
      refresh,
    }),
    [match, status, serverNow, send, ackTick, refresh],
  );
}
