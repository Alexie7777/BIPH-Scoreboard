/**
 * iPad 控制台(/m/:id/control)—— 记分核心界面。
 *
 * 横屏:左栏 = 比赛钟 + 进攻钟(拇指区),右栏 = 主队卡 + 客队卡(上下堆叠)。
 * 竖屏:单栏纵向 —— 比分条 → 比赛钟 → 进攻钟 → 主队卡 → 客队卡 → 固定操作行。
 *
 * 计时显示完全依赖本地推算(锚点 + 服务器时间估计),断网时照常走秒。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { Locale, Side } from '@biph/shared';
import { createBuzzer } from '../lib/audio';
import { estimatedServerNow, getQr, readStoredTokens, writeStoredTokens } from '../lib/api';
import { formatClock, formatSeconds, periodDurationMs, remainingMs } from '../lib/format';
import { useMatch } from '../lib/useMatch';
import { useTicker } from '../lib/useTicker';
import { useWakeLock } from '../lib/useWakeLock';
import { describeCommand, type ToastAction } from '../lib/toasts';
import {
  IDLE_TIMEOUT_WATCH,
  stepTimeoutWatch,
  type TimeoutWatch,
} from '../lib/timeoutAlert';
import { setScopedLocale, translateServerError, useI18n } from '../i18n';
import { ClockPanel } from '../components/ClockPanel';
import { ConfirmButton } from '../components/ConfirmButton';
import { LanguageToggle } from '../components/LanguageToggle';
import { OfflineBar } from '../components/OfflineBar';
import { ServerClock } from '../components/ServerClock';
import { ShotClockPanel } from '../components/ShotClockPanel';
import { TeamCard } from '../components/TeamCard';
import { TimeoutAlert, type TimeoutAlertData } from '../components/TimeoutAlert';
import { ToastStack, type ToastItem, type ToastKind } from '../components/ToastStack';
import { IconBuzzer, IconExternal, IconFlag, IconSwap, IconUndo } from '../components/icons';

/** 同时最多显示几条提示(多了会挡住控制台) */
const MAX_TOASTS = 4;
/** 成功提示停留多久(ms) */
const TOAST_MS = 2400;
/** 失败提示停留多久(ms) —— 出错时人得多看两眼 */
const TOAST_ERR_MS = 4200;
/** 「暂停时间结束」提示停留多久(ms) */
const TIMEOUT_ENDED_MS = 3000;

export default function Control() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const matchId = id ?? '';

  const [token, setToken] = useState<string | null>(() => {
    const fromUrl = searchParams.get('t');
    if (fromUrl) return fromUrl;
    return readStoredTokens(matchId).controlToken ?? null;
  });
  const [tokenInput, setTokenInput] = useState('');
  const [tokenErr, setTokenErr] = useState<string | null>(null);
  const [autoFetching, setAutoFetching] = useState(false);

  const { t, locale } = useI18n();

  /**
   * 自动获取控制令牌。
   *
   * 二维码接口是公开的(它本来就必须公开 —— 打印出来的二维码要让计分员扫码即用),
   * 返回的控制台链接里带着 ?t=<控制令牌>。这里只是把其中的令牌取出来填上,
   * 让人不用手输、不用找管理员,也能在本机打开控制台。
   */
  async function autoFetchToken() {
    setAutoFetching(true);
    setTokenErr(null);
    try {
      const res = await getQr(matchId, 'control');
      const tok = new URL(res.url).searchParams.get('t');
      if (!tok) throw new Error('no token in url');
      writeStoredTokens(matchId, { controlToken: tok });
      setToken(tok);
    } catch {
      setTokenErr(t('control.autoTokenErr'));
    } finally {
      setAutoFetching(false);
    }
  }

  /* --------------------------------------------------- 操作提示(右上角) */
  /*
   * 按完按钮必须马上知道"到底生效了没有" —— 这一摞提示就是干这件事的。
   *
   * 提示的唯一真相来源是服务端的回执(ack):
   *   ok=true  → 绿勾,说明这条命令确实执行了
   *   ok=false → 红色,带上服务端给的原因(比如"暂停已用完")
   * 所以提示不会凭空乐观 —— 按了没反应的时候它会说实话。
   */
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeqRef = useRef(0);
  /** cmdId → 提示文案。发送时记下,ack 回来时取出来弹。 */
  const pendingCmdsRef = useRef(new Map<string, ToastAction>());

  /* --------------------------------------------------- 暂停倒计时警示 */
  /*
   * 暂停倒计时进到最后 5 秒、以及倒计时归零,控制台都要说一声。
   *
   * 判定完全在本地做(锚点推算),**断网也准时** ——
   * 服务端归零自动收尾那条路不发事件,客户端只能靠前后两次采样的差异判断;
   * 反正锚点就在本地,自己算最准。
   */
  const [timeoutAlert, setTimeoutAlert] = useState<TimeoutAlertData | null>(null);
  const timeoutWatchRef = useRef<TimeoutWatch>(IDLE_TIMEOUT_WATCH);
  const timeoutClearRef = useRef<number | null>(null);

  const pushToast = useCallback((text: string, kind: ToastKind) => {
    const id = ++toastSeqRef.current;
    setToasts((prev) => [...prev, { id, text, kind }].slice(-MAX_TOASTS));
    window.setTimeout(
      () => setToasts((prev) => prev.filter((x) => x.id !== id)),
      kind === 'err' ? TOAST_ERR_MS : TOAST_MS,
    );
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  /**
   * 服务端回执 = 操作的唯一真相。
   *
   * 失败原因服务端给的是中文原文,按当前语言翻一遍
   * (认不出来的原样显示,不会变成空白)。
   */
  const handleAck = useCallback(
    (cmdId: string, ok: boolean, err?: string) => {
      const action = pendingCmdsRef.current.get(cmdId);
      pendingCmdsRef.current.delete(cmdId);
      if (!ok) {
        pushToast(err ? translateServerError(locale, err) : t('error.commandFailed'), 'err');
        return;
      }
      if (!action) return;
      pushToast(t(action.key, action.vars), 'ok');
    },
    [pushToast, t, locale],
  );

  const { match, status, serverNow, send } = useMatch({
    matchId,
    role: 'control',
    token,
    onAck: handleAck,
  });

  const [clockMs, setClockMs] = useState(0);
  const [shotMs, setShotMs] = useState(0);

  /**
   * 墙钟(本地时间)。
   *
   * 与管理台右上角那个是同一个组件、同一个口径:显示的是**服务器当前时间**,
   * 只是用本机时区渲染(校内机器都是北京时间)。
   * 走 WS 估出来的服务器时间,断网时照样往前走 ——
   * iPad 的系统时间经常不准,计分员要靠这个对表。
   */
  const [wallNow, setWallNow] = useState(() => estimatedServerNow());
  const [soundOn, setSoundOn] = useState(true);

  const matchRef = useRef(match);
  matchRef.current = match;
  const serverNowRef = useRef(serverNow);
  serverNowRef.current = serverNow;

  const buzzerRef = useRef<ReturnType<typeof createBuzzer> | null>(null);
  if (!buzzerRef.current) buzzerRef.current = createBuzzer();

  useWakeLock(true);

  /* --------------------------------------------------- 跟随本场语言设置 */
  // 比赛配置里的语言优先于本机偏好:现场是"大屏 + iPad"两台设备,
  // 切语言应该整场一起切。
  //
  // 注意:清空 scope 只放在"卸载时",不能放在这个 effect 的 cleanup 里 ——
  // cleanup 在每次语言变化时也会先跑一遍,于是会短暂地 scope=null,
  // 界面闪一下别的语言再切回来。
  useEffect(() => {
    setScopedLocale(match?.presentation.locale ?? null);
  }, [match?.presentation.locale]);
  useEffect(() => () => setScopedLocale(null), []);

  /* --------------------------------------------------- 本地推算 + 每秒刷新显示 */
  useTicker(() => {
    const now = serverNowRef.current();

    // 墙钟:与管理台右上角同一个组件、同一口径(服务器当前时间,本机时区渲染)
    setWallNow((prev) => (Math.floor(prev / 1000) === Math.floor(now / 1000) ? prev : now));

    const m = matchRef.current;
    if (!m) return;
    const c = remainingMs(m.clock, now);
    const s = remainingMs(m.shotClock, now);
    setClockMs((prev) => (formatClock(prev) !== formatClock(c) ? c : prev));
    setShotMs((prev) => (formatSeconds(prev) !== formatSeconds(s) ? s : prev));

    /* ---- 暂停倒计时:最后 5 秒开始警示,归零时收尾 ---- */
    const anchor = m.timeout;
    const running = !!anchor?.running;
    const left = running && anchor ? remainingMs(anchor, now) : 0;
    const step = stepTimeoutWatch(timeoutWatchRef.current, { running, left });
    timeoutWatchRef.current = step.watch;
    if (step.transition.type === 'urgent') {
      setTimeoutAlert({ phase: 'urgent', seconds: step.transition.seconds });
    } else if (step.transition.type === 'ended') {
      setTimeoutAlert({ phase: 'ended', seconds: 0 });
      if (timeoutClearRef.current !== null) window.clearTimeout(timeoutClearRef.current);
      timeoutClearRef.current = window.setTimeout(() => {
        timeoutClearRef.current = null;
        setTimeoutAlert(null);
      }, TIMEOUT_ENDED_MS);
    } else if (step.transition.type === 'cleared') {
      setTimeoutAlert(null);
    }
  });

  /* --------------------------------------------------- 首次交互解锁音频 */
  useEffect(() => {
    const onFirstTouch = () => {
      void buzzerRef.current?.unlock().then((ok) => setSoundOn(ok));
      window.removeEventListener('pointerdown', onFirstTouch);
    };
    window.addEventListener('pointerdown', onFirstTouch);
    return () => window.removeEventListener('pointerdown', onFirstTouch);
  }, []);

  useEffect(() => {
    return () => buzzerRef.current?.dispose();
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutClearRef.current !== null) window.clearTimeout(timeoutClearRef.current);
    };
  }, []);

  /* --------------------------------------------------- 指令 */
  /**
   * 发一条命令。
   *
   * 提示文案在【发送这一刻】就用当时的比赛快照生成:
   * 等 ack 回来时队伍名可能已经变了,那时候再取名就弹错名字了。
   */
  const doSend = useCallback(
    (type: Parameters<typeof send>[0], payload?: unknown) => {
      const cmdId = send(type, payload);
      if (!cmdId) {
        // 没发出去(没连上服务器):命令根本没到服务端,谈不上生效
        pushToast(t('error.notConnected'), 'err');
        return;
      }
      const action = describeCommand(type, payload, matchRef.current);
      if (action) pendingCmdsRef.current.set(cmdId, action);
    },
    [send, pushToast, t],
  );

  /* --------------------------------------------------- 空格键 = 比赛钟启停 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      if (active && typeof active.blur === 'function') active.blur();
      doSend('clock.toggle');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doSend]);

  const togglePossession = useCallback(() => {
    const m = matchRef.current;
    if (!m) return;
    const next: Side = m.possession === 'home' ? 'away' : 'home';
    doSend('possession.set', { side: next });
  }, [doSend]);

  const manualBuzzer = useCallback(() => {
    doSend('buzzer');
    // 手动蜂鸣:短促一声工业汽笛。
    // 这一声只在本机(iPad)出,给计分员自己一个"按到了"的反馈;
    // 给全场听的那一声由大屏订阅服务端 'buzzer' 事件后播放。
    if (soundOn) buzzerRef.current?.buzz('short');
  }, [doSend, soundOn]);

  const controlUrl = useMemo(() => `${window.location.origin}/m/${matchId}/control`, [matchId]);

  /**
   * 切换语言:本机立刻生效(由 LanguageToggle 内部完成),
   * 同时把语言写进本场配置 —— 服务端广播后大屏会跟着切。
   */
  const changeLocale = useCallback(
    (next: Locale) => {
      doSend('match.update', { patch: { presentation: { locale: next } } });
    },
    [doSend],
  );

  /**
   * 没有令牌 = 只能看,不能控。
   *
   * 注意:比赛数据是走 REST 拿的(公开),所以**没令牌时页面照样渲染出完整控制台**,
   * 但 WS 连不上(服务端在握手阶段就 401),表现为"连接中断"、按钮按下去没反应。
   * 所以"取令牌"的入口必须放在最前面,而不是塞在"拿不到比赛数据"的分支里。
   */
  if (!token) {
    return (
      <div className="control-shell">
        <OfflineBar status={status} />
        <div className="control-body">
          <div className="panel">
            <h2>{t('control.needToken.title')}</h2>
            <p className="panel-hint">{t('control.hint.notoken')}</p>

            <div className="field inline">
              <input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="controlToken"
                style={{ maxWidth: 320 }}
              />
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const v = tokenInput.trim();
                  if (!v) return;
                  writeStoredTokens(matchId, { controlToken: v });
                  setToken(v);
                }}
              >
                {t('control.connect')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={autoFetching}
                onClick={() => void autoFetchToken()}
              >
                {autoFetching ? t('control.autoTokenBusy') : t('control.autoToken')}
              </button>
            </div>
            {tokenErr ? <div className="notice danger">{tokenErr}</div> : null}

            <div className="btn-row" style={{ marginTop: 14 }}>
              <a className="btn" href={`/m/${matchId}`}>
                {t('control.openSetup')}
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="control-shell">
        <OfflineBar status={status} />
        <div className="control-body">
          <div className="panel">
            <h2>{status === 'offline' ? t('control.offline') : t('control.connecting')}</h2>
            <p className="panel-hint">{t('control.hint.token')}</p>

            <div className="btn-row" style={{ marginTop: 14 }}>
              <a className="btn" href={`/m/${matchId}`}>
                {t('control.openSetup')}
              </a>
              <a className="btn" href={controlUrl}>
                {t('control.refresh')}
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { rules, home, away } = match;
  const shotVisible = rules.useShotClock;
  // 暂停进行中:大屏上正跑着倒计时
  const timeoutRunning = !!match.timeout?.running;
  const timeoutSide = match.timeout?.side ?? null;

  return (
    <div className="control-shell">
      <OfflineBar status={status} />
      <TimeoutAlert alert={timeoutAlert} />

      <div className="control-body">
        {/* 墙钟:与管理台右上角同一个组件(服务器当前时间,本机时区渲染) */}
        <div className="control-meta">
          <ServerClock now={wallNow} title={t('control.clock.title')} className="control-clock mono" />
        </div>

        {/* 竖屏顶部比分条(横屏隐藏) */}
        <div className="score-bar">
          <span className="sb-team" style={{ color: home.color }}>
            {home.shortName || home.name}
          </span>
          <span className="sb-score">
            {home.score} : {away.score}
          </span>
          <span className="sb-team" style={{ color: away.color }}>
            {away.shortName || away.name}
          </span>
          <span className="sb-period">{match.clock.periodLabel}</span>
        </div>

        <div className="control-cols">
          <div className="col-clocks">
            <ClockPanel
              remainingMs={clockMs}
              running={match.clock.running}
              periodLabel={match.clock.periodLabel}
              onToggle={() => doSend('clock.toggle')}
              onAdjust={(sec) => doSend('clock.adjust', { deltaMs: sec * 1000 })}
              onReset={() => doSend('clock.set', { ms: periodDurationMs(rules) })}
              onNextPeriod={() => doSend('clock.nextPeriod')}
              onPrevPeriod={() => doSend('clock.prevPeriod')}
            />

            {shotVisible ? (
              <ShotClockPanel
                remainingMs={shotMs}
                running={match.shotClock.running}
                durationSeconds={rules.shotClockSeconds}
                onToggle={() => doSend('shot.toggle')}
                onAdjust={(sec) => doSend('shot.adjust', { deltaMs: sec * 1000 })}
                onReset={() => doSend('shot.reset', { seconds: rules.shotClockSeconds })}
              />
            ) : null}
          </div>

          <div className="col-teams">
            <TeamCard
              team={home}
              rules={rules}
              hasPossession={match.possession === 'home'}
              onScore={(points) => doSend('score.add', { side: 'home', points })}
              onScoreSub={() => doSend('score.sub', { side: 'home', points: 1 })}
              onFoul={(delta) =>
                doSend(delta > 0 ? 'foul.add' : 'foul.sub', { side: 'home' })
              }
              onTimeout={(delta) =>
                doSend(delta > 0 ? 'timeout.add' : 'timeout.sub', { side: 'home' })
              }
              onRequestTimeout={() => doSend('timeout.request', { side: 'home' })}
              onResumeMatch={() => doSend('timeout.end')}
              timeoutActive={timeoutRunning && timeoutSide === 'home'}
              timeoutLocked={timeoutRunning}
            />
            <TeamCard
              team={away}
              rules={rules}
              hasPossession={match.possession === 'away'}
              onScore={(points) => doSend('score.add', { side: 'away', points })}
              onScoreSub={() => doSend('score.sub', { side: 'away', points: 1 })}
              onFoul={(delta) =>
                doSend(delta > 0 ? 'foul.add' : 'foul.sub', { side: 'away' })
              }
              onTimeout={(delta) =>
                doSend(delta > 0 ? 'timeout.add' : 'timeout.sub', { side: 'away' })
              }
              onRequestTimeout={() => doSend('timeout.request', { side: 'away' })}
              onResumeMatch={() => doSend('timeout.end')}
              timeoutActive={timeoutRunning && timeoutSide === 'away'}
              timeoutLocked={timeoutRunning}
            />
          </div>
        </div>
      </div>

      {/* 底部固定操作行 */}
      <div className="action-bar">
        {match.status === 'scheduled' ? (
          <button type="button" className="act accent" onClick={() => doSend('match.status', { status: 'live' })}>
            <IconFlag size={22} />
            <span>{t('control.startMatch')}</span>
          </button>
        ) : null}

        <button type="button" className="act" onClick={togglePossession} title={t('control.possession.title')}>
          <IconSwap size={22} />
          <span>{t('control.possession')}</span>
          <span className="act-sub">
            {match.possession === 'home'
              ? t('control.possession.home')
              : match.possession === 'away'
                ? t('control.possession.away')
                : t('control.possession.none')}
          </span>
        </button>

        <button type="button" className="act" onClick={() => doSend('sides.swap')} title={t('control.swap.title')}>
          <IconSwap size={22} />
          <span>{t('control.swap')}</span>
        </button>

        <button type="button" className="act" onClick={() => doSend('undo')} title={t('control.undo.title')}>
          <IconUndo size={22} />
          <span>{t('control.undo')}</span>
        </button>

        <button type="button" className="act" onClick={manualBuzzer} title={t('control.buzzer.title')}>
          <IconBuzzer size={22} />
          <span>{t('control.buzzer')}</span>
        </button>

        <ConfirmButton
          label={t('control.final')}
          className="act warn"
          onConfirm={() => doSend('match.final')}
        />

        <button
          type="button"
          className="act"
          onClick={() => window.open(`/m/${matchId}/display`, '_blank', 'noopener')}
          title={t('control.display.title')}
        >
          <IconExternal size={22} />
          <span>{t('control.display')}</span>
        </button>

        {/* 语言切换:切了以后大屏会跟着切(语言写进本场配置,服务端广播) */}
        <LanguageToggle className="act-lang" onChange={changeLocale} />
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
