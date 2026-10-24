/**
 * 大屏(/m/:id/display)—— 固定 1920×1080 设计画布 + 等比缩放。
 *
 * 缩放由 JS 计算并写入 CSS 变量:
 *   fit     : scale = min(innerWidth/1920, innerHeight/1080)
 *   stretch : 分别用 scaleX / scaleY 铺满
 *
 * 【自动蜂鸣】用本地推算的剩余时间,检测 "prev > 0 && now <= 0" 的那一刻
 * 在本机发声 —— 不依赖服务端 event 消息(断网时 event 根本收不到)。
 *
 * 【手动蜂鸣】反过来:计分员在 iPad 上按 buzzer,声音要在大屏这台机器上出
 * (现场喇叭接的是大屏电脑)。所以大屏额外订阅服务端的 'buzzer' 事件。
 * 手动蜂鸣本身就需要服务端中转记日志,不存在"断网也要响"的诉求。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Match } from '@biph/shared';
import { createBuzzer } from '../lib/audio';
import { setVenueLocaleRemote } from '../lib/api';
import { formatClock, formatSeconds, remainingMs, startCountdownMs } from '../lib/format';
import { standbyLabel } from '../lib/standby';
import { useMatch } from '../lib/useMatch';
import { useTicker } from '../lib/useTicker';
import { setScopedLocale, useI18n } from '../i18n';
import { LanguageToggle } from '../components/LanguageToggle';
import { BroadcastBoard } from '../templates/BroadcastBoard';
import { LedBoard } from '../templates/LedBoard';
import { SimpleBoard } from '../templates/SimpleBoard';

const DESIGN_W = 1920;
const DESIGN_H = 1080;

export default function Display() {
  const { id } = useParams<{ id: string }>();
  const matchId = id ?? '';
  const { t } = useI18n();

  const [clockMs, setClockMs] = useState(0);
  const [shotMs, setShotMs] = useState(0);
  const [timeoutMs, setTimeoutMs] = useState(0);
  /** 开赛倒计时剩余毫秒(0 = 现在不显示) */
  const [startMs, setStartMs] = useState(0);
  const [needGesture, setNeedGesture] = useState(false);

  const matchRef = useRef<Match | null>(null);
  const serverNowRef = useRef<() => number>(() => Date.now());
  const buzzerRef = useRef<ReturnType<typeof createBuzzer> | null>(null);
  if (!buzzerRef.current) buzzerRef.current = createBuzzer();

  const { match, status, serverNow } = useMatch({
    matchId,
    role: 'display',
    onEvent: (kind) => {
      // 手动蜂鸣:声音必须在大屏这台机器上出(现场喇叭接的是大屏电脑)。
      // 计分员按的是 iPad,那头的扬声器只够计分员自己听见。
      if (kind !== 'buzzer') return;
      if (matchRef.current?.presentation.soundEnabled) buzzerRef.current?.buzz('short');
    },
  });

  matchRef.current = match;
  serverNowRef.current = serverNow;

  /* ------------------------------------------------------ 跟随本场语言 */
  // 计分员在控制台切语言 → 语言写进本场配置 → 服务端广播 → 大屏跟着切。
  //
  // 清空 scope 只放在"卸载时":放在这个 effect 的 cleanup 里会在每次语言变化时
  // 先把 scope 清成 null,界面闪一下别的语言再切回来。
  useEffect(() => {
    setScopedLocale(match?.presentation.locale ?? null);
  }, [match?.presentation.locale]);
  useEffect(() => () => setScopedLocale(null), []);

  const prevClockRef = useRef<number | null>(null);
  const prevShotRef = useRef<number | null>(null);

  /* ------------------------------------------------------ 缩放:写入 CSS 变量 */
  useEffect(() => {
    const apply = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const scale = Math.min(w / DESIGN_W, h / DESIGN_H);
      const root = document.documentElement;
      root.style.setProperty('--scale', String(scale));
      root.style.setProperty('--scale-x', String(w / DESIGN_W));
      root.style.setProperty('--scale-y', String(h / DESIGN_H));
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);

  /* ------------------------------------------------------ 音效解锁探测 */
  useEffect(() => {
    void buzzerRef.current?.probe().then((ok) => setNeedGesture(!ok));
    return () => buzzerRef.current?.dispose();
  }, []);

  /* ------------------------------------------------------ 本地推算 + 自动蜂鸣 */
  useTicker(() => {
    const m = matchRef.current;
    if (!m) return;
    const now = serverNowRef.current();
    const c = remainingMs(m.clock, now);
    const s = remainingMs(m.shotClock, now);
    // 暂停倒计时:同样是锚点,断网时靠本地推算照样走秒
    const to = m.timeout ? remainingMs(m.timeout, now) : 0;
    /*
     * 开赛倒计时:赛程表上的墙钟时间(19:00),不是锚点 ——
     * 但同样在本地算,断网照常走。
     * 只在"还没开赛"时算:比赛一旦开始,就不该再显示"距开赛"。
     */
    const sc = m.status === 'scheduled' ? startCountdownMs(m.startTime, now) : null;
    const st = sc ?? 0;

    const soundOn = m.presentation.soundEnabled;

    const pc = prevClockRef.current;
    if (pc !== null && pc > 0 && c <= 0 && soundOn) {
      // 比赛钟归零 = 比赛结束,放 NBA 那种长鸣
      buzzerRef.current?.buzz('long');
    }
    prevClockRef.current = c;

    const ps = prevShotRef.current;
    if (ps !== null && ps > 0 && s <= 0 && m.rules.useShotClock && soundOn) {
      // 进攻钟归零 = 违例,短促一声
      buzzerRef.current?.buzz('short');
    }
    prevShotRef.current = s;

    setClockMs((prev) => (formatClock(prev) !== formatClock(c) ? c : prev));
    setShotMs((prev) => (formatSeconds(prev) !== formatSeconds(s) ? s : prev));
    setTimeoutMs((prev) => (prev !== to ? to : prev));
    setStartMs((prev) => (prev !== st ? st : prev));
  });

  /* ------------------------------------------------------ 全屏快捷键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
        else void document.exitFullscreen?.().catch(() => undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const template = match?.presentation.template ?? 'simple';
  const stretch = match?.presentation.autoFit === 'stretch';
  const offline = status === 'offline';

  const board = useMemo(() => {
    if (!match) return null;
    const props = {
      match,
      clockRemainingMs: clockMs,
      shotRemainingMs: shotMs,
      timeoutRemainingMs: timeoutMs,
      startRemainingMs: startMs,
      offline,
      stretch,
    };
    if (template === 'led') return <LedBoard {...props} />;
    if (template === 'broadcast') return <BroadcastBoard {...props} />;
    return <SimpleBoard {...props} />;
  }, [match, clockMs, shotMs, timeoutMs, startMs, offline, stretch, template]);

  /*
   * 待机层:还没开赛时铺满整个大屏。
   * 开赛倒计时亮着的时候不画它 —— 倒计时那一屏本身就是"即将开始",
   * 两层叠在一起只会互相挡。
   */
  const standby = !!match && match.status === 'scheduled' && startMs <= 0;

  return (
    <div className="display-root">
      {board}

      {standby ? (
        <div className="board-standby">
          <div className="s-title">{match?.presentation.titleText || match?.name || 'BIPH 场地管理台'}</div>
          <div className="s-sub">{standbyLabel(match?.startTime, t)}</div>
          {match?.court ? <div className="s-sub">{match.court}</div> : null}
        </div>
      ) : null}

      {!match && !standby ? (
        <div className="board-standby">
          <div className="s-title">BIPH 场地管理台</div>
          <div className="s-sub">{t('board.connecting')}</div>
        </div>
      ) : null}

      {/* 角落里的语言切换:平时几乎看不见,鼠标移上去才亮起来。
          现场只有大屏没有 iPad 时,可以直接在这里切 —— 切的是整个场馆的语言,
          服务端会广播给所有大屏与控制台。 */}
      <div className="display-lang">
        <LanguageToggle
          compact
          onChange={(next) => {
            void setVenueLocaleRemote(next).catch(() => {
              /* 写不进去就维持本机生效,大屏不至于卡住 */
            });
          }}
        />
      </div>

      {needGesture ? (
        <div
          className="audio-overlay"
          onClick={() => {
            // 只有真的解锁成功才收起遮罩;失败就继续提示,避免"看着像好了其实没声音"
            void buzzerRef.current?.unlock().then((ok) => {
              if (ok) setNeedGesture(false);
            });
            if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
          }}
        >
          <div className="inner">
            <div className="big">{t('board.audio.big')}</div>
            <div className="small">{t('board.audio.small')}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
