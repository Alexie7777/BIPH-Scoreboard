/**
 * 管理台(场地清单):多场地并行监控。
 *
 * 数据来自 REST 轮询(管理台不需要发命令,不上 WS)。
 * 卡片上的剩余时间用【锚点 + 服务器时间偏移量】在本地推算,
 * 与大屏/控制台共用同一套 remainingMs 算法。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Locale, Match, MatchHealth } from '@biph/shared';
import {
  captureTokens,
  createMatch,
  estimatedServerNow,
  getHealth,
  getVenueLocale,
  listMatches,
  setVenueLocaleRemote,
  totalWsClients,
  type HealthResponse,
} from '../lib/api';
import { cssVars } from '../lib/cssVars';
import { formatClock, remainingMs, statusBadgeClass, statusLabel } from '../lib/format';
import { sportEmoji, sportLabel } from '../lib/sports';
import { useTicker } from '../lib/useTicker';
import { setVenueLocale, useI18n } from '../i18n';
import { LanguageToggle } from '../components/LanguageToggle';
import { ServerClock } from '../components/ServerClock';
import { IconExternal, IconSettings } from '../components/icons';

const HEALTH_INTERVAL_MS = 10_000;
const LIST_INTERVAL_MS = 5_000;
/** 场馆语言的轮询间隔 —— 要让"别处切了语言"这边很快跟上 */
const LOCALE_INTERVAL_MS = 3_000;

interface FormState {
  name: string;
  venue: string;
  court: string;
  homeName: string;
  awayName: string;
  periods: number;
  periodMinutes: number;
  shotClockSeconds: number;
  timeoutsPerTeam: number;
  bonusFouls: number;
}

const EMPTY_FORM: FormState = {
  name: '',
  venue: '',
  court: '',
  homeName: '',
  awayName: '',
  periods: 4,
  periodMinutes: 10,
  shotClockSeconds: 24,
  timeoutsPerTeam: 4,
  bonusFouls: 5,
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { t, locale, setLocale } = useI18n();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [healthMap, setHealthMap] = useState<Record<string, MatchHealth>>({});
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [clockMap, setClockMap] = useState<Record<string, string>>({});
  // 右上角的服务器时钟:按偏移本地推算,每秒更新
  const [serverNow, setServerNow] = useState(() => estimatedServerNow());

  const matchesRef = useRef<Match[]>([]);
  matchesRef.current = matches;

  // t 随语言变化换引用;放进 loadList 的依赖里会让轮询定时器在每次切语言时
  // 被清掉重建。用 ref 取最新的 t,loadList 保持稳定。
  const tRef = useRef(t);
  tRef.current = t;

  const loadList = useCallback(async () => {
    try {
      const res = await listMatches();
      setMatches(res.matches ?? []);
      setHealthMap(res.health ?? {});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tRef.current('dashboard.err.list'));
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const res = await getHealth();
      setHealth(res);
    } catch {
      /* 健康检查失败不打断页面,下面单独显示 */
    }
  }, []);

  /**
   * 读场馆语言。
   *
   * 管理台没有"本场"概念,它只能跟着场馆语言走。
   * 轮询它,是为了让"在控制台/iPad 上切语言"这件事,管理台也能跟上 ——
   * 否则会出现管理台中文、控制台英文,现场看着像坏了。
   */
  const loadVenueLocale = useCallback(async () => {
    try {
      setVenueLocale(await getVenueLocale());
    } catch {
      /* 读不到就先用本机偏好,不影响页面 */
    }
  }, []);

  useEffect(() => {
    void loadList();
    void loadHealth();
    void loadVenueLocale();
    const listTimer = window.setInterval(() => void loadList(), LIST_INTERVAL_MS);
    const healthTimer = window.setInterval(() => void loadHealth(), HEALTH_INTERVAL_MS);
    const localeTimer = window.setInterval(() => void loadVenueLocale(), LOCALE_INTERVAL_MS);
    return () => {
      window.clearInterval(listTimer);
      window.clearInterval(healthTimer);
      window.clearInterval(localeTimer);
    };
  }, [loadHealth, loadList, loadVenueLocale]);

  /**
   * 管理台上切语言 = 切整个场馆的语言。
   *
   * 先本地生效(不等网络),再写服务端 —— 服务端会镜像到每一场比赛并广播,
   * 所有大屏、所有控制台一起跟上。
   */
  const changeVenueLocale = useCallback(
    async (next: Locale) => {
      setLocale(next);
      try {
        await setVenueLocaleRemote(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : tRef.current('dashboard.err.locale'));
      }
    },
    [setLocale],
  );

  // 本地推算各场地剩余时间(每秒最多刷新一次文本)
  useTicker(() => {
    const now = estimatedServerNow();

    // 右上角是【服务器当前时间】:用健康检查校准过的偏移本地推算,每秒走一格。
    // (直接渲染 health.serverTs 的话那是 10 秒一次的快照,看起来跟卡死一样。)
    // 与控制台左上角是同一个组件,两处口径不会走偏。
    setServerNow((prev) => (Math.floor(prev / 1000) === Math.floor(now / 1000) ? prev : now));

    setClockMap((prev) => {
      const list = matchesRef.current;
      let changed = false;
      const next: Record<string, string> = {};
      for (const m of list) {
        const txt = formatClock(remainingMs(m.clock, now));
        next[m.id] = txt;
        if (prev[m.id] !== txt) changed = true;
      }
      return changed ? next : prev;
    });
  });

  const sorted = useMemo(() => {
    const rank = (m: Match) => (m.status === 'live' ? 0 : 1);
    return [...matches].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return (a.court || '').localeCompare(b.court || '', 'zh-Hans-CN', { numeric: true });
    });
  }, [matches]);

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.homeName.trim() || !form.awayName.trim()) {
      setError(t('dashboard.err.names'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await createMatch({
        name: form.name.trim() || `${form.homeName.trim()} vs ${form.awayName.trim()}`,
        venue: form.venue.trim(),
        court: form.court.trim(),
        homeName: form.homeName.trim(),
        awayName: form.awayName.trim(),
        rules: {
          periods: form.periods,
          periodMinutes: form.periodMinutes,
          shotClockSeconds: form.shotClockSeconds,
          timeoutsPerTeam: form.timeoutsPerTeam,
          bonusFouls: form.bonusFouls,
        },
      });
      captureTokens(res.match.id, res);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await loadList();
      navigate(`/m/${res.match.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dashboard.err.create'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <h1>{t('app.title')}</h1>
        <div className="spacer" />
        <div className="health-strip">
          {health ? (
            <>
              <span className="badge ok">{t('dashboard.health.ok')}</span>
              <span className="badge">v{health.version}</span>
              <span className="badge">{t('dashboard.health.ws', { n: totalWsClients(health.wsClients) })}</span>
              <ServerClock
                now={serverNow}
                title={t('dashboard.health.time')}
                className="badge mono"
              />
            </>
          ) : (
            <span className="badge danger">{t('dashboard.health.down')}</span>
          )}
        </div>
        <LanguageToggle onChange={(next) => void changeVenueLocale(next)} />
        <button type="button" className="btn primary" onClick={() => setShowCreate(true)}>
          {t('dashboard.newMatch')}
        </button>
      </header>

      <div className="page-body">
        {error ? (
          <div className="notice danger" style={{ marginBottom: 16 }}>
            {error}
          </div>
        ) : null}

        {sorted.length === 0 ? (
          <div className="empty-state">
            <h2>{t('dashboard.empty.title')}</h2>
            <p>{t('dashboard.empty.hint')}</p>
            <button type="button" className="btn primary" onClick={() => setShowCreate(true)}>
              {t('dashboard.newMatch')}
            </button>
          </div>
        ) : (
          <div className="court-grid">
            {sorted.map((m) => {
              const h = healthMap[m.id];
              const clients = h?.clients ?? 0;
              const time = clockMap[m.id] ?? formatClock(m.clock.remainingMs);
              const urgent = m.clock.running && m.clock.remainingMs > 0 && m.clock.remainingMs <= 60_000;
              return (
                <div
                  key={m.id}
                  className="court-card"
                  onClick={() => navigate(`/m/${m.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/m/${m.id}`);
                    }
                  }}
                >
                  <div className="card-head">
                    {/* 项目 emoji:一眼看出这块场地在打什么球 */}
                    <span className="court-sport" title={sportLabel(m.sport, locale)}>
                      {sportEmoji(m.sport)}
                    </span>
                    <span className="court-no">{m.court || t('dashboard.court.unnumbered')}</span>
                    <span className={statusBadgeClass(m.status)}>{statusLabel(m.status, locale)}</span>
                    <span className="badge">{m.clock.periodLabel}</span>
                    <div className="spacer" style={{ flex: 1 }} />
                    {clients === 0 ? (
                      <span className="badge danger">{t('dashboard.clients.none')}</span>
                    ) : (
                      <span className="badge ok">{t('dashboard.clients.online', { n: clients })}</span>
                    )}
                  </div>

                  <div className="teams">
                    <div className="team-name" style={cssVars({ '--team-color': m.home.color })}>
                      {m.home.name}
                    </div>
                    <div className="score">
                      {m.home.score} : {m.away.score}
                    </div>
                    <div className="team-name away" style={cssVars({ '--team-color': m.away.color })}>
                      {m.away.name}
                    </div>
                  </div>

                  <div className="clock-row">
                    <span className={urgent ? 'clock urgent' : 'clock'}>{time}</span>
                    {m.rules.useShotClock ? (
                      <span className="badge">
                        {t('dashboard.shotClock')}{' '}
                        {m.shotClock.running ? t('dashboard.shotRunning') : t('dashboard.shotStopped')}
                      </span>
                    ) : null}
                    <div style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="icon-btn"
                      title={t('dashboard.openDisplay')}
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`/m/${m.id}/display`, '_blank', 'noopener');
                      }}
                    >
                      <IconExternal size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t('dashboard.matchConfig')}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/m/${m.id}`);
                      }}
                    >
                      <IconSettings size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 页脚落款(提供方署名) */}
      <footer className="page-footer">{t('footer.poweredBy')}</footer>

      {showCreate ? (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('dashboard.create.title')}</h2>
            <form onSubmit={submitCreate}>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="f-home">{t('dashboard.create.home')}</label>
                  <input
                    id="f-home"
                    value={form.homeName}
                    onChange={(e) => setForm({ ...form, homeName: e.target.value })}
                    placeholder={t('dashboard.ph.home')}
                  />
                </div>
                <div className="field">
                  <label htmlFor="f-away">{t('dashboard.create.away')}</label>
                  <input
                    id="f-away"
                    value={form.awayName}
                    onChange={(e) => setForm({ ...form, awayName: e.target.value })}
                    placeholder={t('dashboard.ph.away')}
                  />
                </div>
                <div className="field">
                  <label htmlFor="f-court">{t('dashboard.create.court')}</label>
                  <input
                    id="f-court"
                    value={form.court}
                    onChange={(e) => setForm({ ...form, court: e.target.value })}
                    placeholder={t('dashboard.ph.court')}
                  />
                </div>
                <div className="field">
                  <label htmlFor="f-name">{t('dashboard.create.name')}</label>
                  <input
                    id="f-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={t('dashboard.ph.event')}
                  />
                </div>
                <div className="field">
                  <label htmlFor="f-venue">{t('dashboard.create.venue')}</label>
                  <input
                    id="f-venue"
                    value={form.venue}
                    onChange={(e) => setForm({ ...form, venue: e.target.value })}
                    placeholder={t('dashboard.ph.venue')}
                  />
                </div>
                <div className="field">
                  <label htmlFor="f-periods">{t('dashboard.create.periods')}</label>
                  <input
                    id="f-periods"
                    type="number"
                    min={1}
                    max={9}
                    value={form.periods}
                    onChange={(e) => setForm({ ...form, periods: Number(e.target.value) || 1 })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="f-minutes">{t('dashboard.create.periodMinutes')}</label>
                  <input
                    id="f-minutes"
                    type="number"
                    min={1}
                    max={60}
                    value={form.periodMinutes}
                    onChange={(e) => setForm({ ...form, periodMinutes: Number(e.target.value) || 1 })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="f-shot">{t('dashboard.create.shotSeconds')}</label>
                  <input
                    id="f-shot"
                    type="number"
                    min={0}
                    max={99}
                    value={form.shotClockSeconds}
                    onChange={(e) => setForm({ ...form, shotClockSeconds: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="f-to">{t('dashboard.create.timeouts')}</label>
                  <input
                    id="f-to"
                    type="number"
                    min={0}
                    max={20}
                    value={form.timeoutsPerTeam}
                    onChange={(e) => setForm({ ...form, timeoutsPerTeam: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="f-bonus">{t('dashboard.create.bonus')}</label>
                  <input
                    id="f-bonus"
                    type="number"
                    min={0}
                    max={20}
                    value={form.bonusFouls}
                    onChange={(e) => setForm({ ...form, bonusFouls: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowCreate(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? t('common.creating') : t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
