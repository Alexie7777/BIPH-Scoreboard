/**
 * 比赛配置页(/m/:id):队名/配色/规则/模板 + 控制台与大屏二维码 + 危险操作。
 *
 * 改配置(队名、队色、规则、显示设置)只要本场控制令牌,不需要管理员密钥。
 * 管理员密钥只管【重置比赛】与【删除比赛】这两个破坏性操作:
 * 点按钮会弹窗要密钥,输对才真的执行 —— 输错弹窗不关,原地报错。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Locale, Match, MatchRules, Presentation, Team } from '@biph/shared';
import { DEFAULT_TIMEOUT_SECONDS } from '@biph/shared';
import {
  buildControlUrl,
  buildDisplayUrl,
  captureTokens,
  deleteMatch,
  getAdminKey,
  getMatch,
  getQr,
  patchMatch,
  readStoredTokens,
  resetMatch,
  setAdminKey,
  uploadLogo,
  writeStoredTokens,
  type MatchConfigPatch,
} from '../lib/api';
import { describeContrast } from '../lib/colors';
import { formatClockTime, setScopedLocale, useI18n } from '../i18n';
import { AdminKeyPrompt } from '../components/AdminKeyPrompt';
import { LanguageToggle } from '../components/LanguageToggle';
import { IconCopy, IconExternal } from '../components/icons';

function normalizeHex(value: string, fallback: string): string {
  const v = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : fallback;
}

/**
 * 「需要点保存」的字段的指纹 —— 用来判断有没有还没提交的修改。
 *
 * 分两类:
 * - 开关/下拉(使用进攻钟、显示犯规、大屏模板……)→ **点一下就立即下发**,不算未保存;
 * - 文字/数字(队名、节数、进攻钟秒数……)→ 必须点「保存」才算生效。
 *
 * 为什么数字类不跟着开关一起自动下发:输入框里敲「20」的过程中,
 * 先出现一个「2」。如果它立刻被推到服务器,下一次重置进攻钟就会变成 2 秒 ——
 * 半截的值直接打到现场大屏,这不是"体验问题",是事故。
 *
 * 比分、犯规、暂停、时钟这些运行时字段一律不参与比较:
 * 它们在比赛进行中会一直变,算进去会导致"永远显示未保存"。
 */
function configFingerprint(m: Match): string {
  const pick = (t: Team) => ({
    id: t.id,
    name: t.name,
    shortName: t.shortName,
    color: t.color,
    textColor: t.textColor,
    logoUrl: t.logoUrl ?? null,
  });
  return JSON.stringify({
    name: m.name,
    venue: m.venue,
    court: m.court,
    startTime: m.startTime ?? null,
    home: pick(m.home),
    away: pick(m.away),
    rules: {
      periods: m.rules.periods,
      periodMinutes: m.rules.periodMinutes,
      shotClockSeconds: m.rules.shotClockSeconds,
      timeoutsPerTeam: m.rules.timeoutsPerTeam,
      timeoutSeconds: m.rules.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      bonusFouls: m.rules.bonusFouls,
    },
    presentation: {
      template: m.presentation.template,
      titleText: m.presentation.titleText,
      sponsorName: m.presentation.sponsorName,
      sponsorText: m.presentation.sponsorText,
      autoFit: m.presentation.autoFit,
      locale: m.presentation.locale ?? null,
    },
  });
}

function TeamEditor({
  title,
  team,
  onChange,
  onLogo,
  onLogoRemove,
}: {
  title: string;
  team: Team;
  onChange: (patch: Partial<Team>) => void;
  onLogo: (file: File) => void;
  onLogoRemove: () => void;
}) {
  const { t, locale } = useI18n();
  const contrast = describeContrast(normalizeHex(team.color, '#ffb020'), normalizeHex(team.textColor, '#ffffff'), locale);
  const [hexInput, setHexInput] = useState(team.color);
  useEffect(() => setHexInput(team.color), [team.color]);

  return (
    <div className="panel">
      <h2>{title}</h2>
      <p className="panel-hint">{t('setup.team.hint')}</p>

      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${team.id}-name`}>{t('setup.team.name')}</label>
          <input
            id={`${team.id}-name`}
            value={team.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`${team.id}-short`}>{t('setup.team.short')}</label>
          <input
            id={`${team.id}-short`}
            value={team.shortName}
            onChange={(e) => onChange({ shortName: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`${team.id}-color`}>{t('setup.team.color')}</label>
          <input
            id={`${team.id}-color`}
            type="color"
            value={normalizeHex(team.color, '#ffb020')}
            onChange={(e) => onChange({ color: e.target.value })}
          />
          <input
            value={hexInput}
            onChange={(e) => {
              setHexInput(e.target.value);
              onChange({ color: normalizeHex(e.target.value, team.color) });
            }}
            placeholder="#ffb020"
          />
        </div>
        <div className="field">
          <label htmlFor={`${team.id}-text`}>{t('setup.team.textColor')}</label>
          <input
            id={`${team.id}-text`}
            type="color"
            value={normalizeHex(team.textColor, '#ffffff')}
            onChange={(e) => onChange({ textColor: e.target.value })}
          />
          <input
            value={team.textColor}
            onChange={(e) => onChange({ textColor: e.target.value })}
            placeholder="#ffffff"
          />
          <span className="hint" style={{ color: contrast.level === 'bad' ? 'var(--danger)' : 'var(--text-faint)' }}>
            {contrast.text}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="btn small" style={{ cursor: 'pointer' }}>
          {t('setup.team.uploadLogo')}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onLogo(file);
              e.target.value = '';
            }}
          />
        </label>
        {team.logoUrl ? (
          <>
            <img
              src={team.logoUrl}
              alt=""
              style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 8, background: '#000' }}
            />
            <button type="button" className="btn small" onClick={onLogoRemove}>
              {t('setup.team.removeLogo')}
            </button>
          </>
        ) : (
          <span className="muted tiny">{t('setup.team.noLogo')}</span>
        )}
      </div>
    </div>
  );
}

export default function MatchSetup() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, locale, setLocale } = useI18n();

  const [draft, setDraft] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * 破坏性操作(重置/删除)的确认弹窗。
   *
   * null = 没打开。'reset' / 'delete' = 正在确认哪一种操作。
   */
  const [dangerAction, setDangerAction] = useState<'reset' | 'delete' | null>(null);
  /** 弹窗里输入的管理员密钥 */
  const [keyInput, setKeyInput] = useState('');
  /** 密钥不对时的提示(留在弹窗里,不关窗) */
  const [keyError, setKeyError] = useState<string | null>(null);
  /** 正在提交(防止连点) */
  const [keyBusy, setKeyBusy] = useState(false);

  const [controlQr, setControlQr] = useState<string | null>(null);
  const [displayQr, setDisplayQr] = useState<string | null>(null);
  // 服务端返回的权威链接(带控制令牌 / 语言参数)。
  // 不从本机 localStorage 拼 —— 换一台没创建过该比赛的设备打开本页时,
  // 本机没有令牌,拼出来的链接缺 ?t=,计分员扫码后连不上。
  const [controlLink, setControlLink] = useState<string | null>(null);
  const [displayLink, setDisplayLink] = useState<string | null>(null);
  // 本场控制令牌(二维码接口顺带返回):改配置用它,不需要管理员密钥
  const [qrToken, setQrToken] = useState<string | null>(null);
  // **服务端已保存**的界面语言。
  // 二维码里的 ?lang= 跟的是这个,不是本地草稿 —— 草稿改了但没保存时,
  // 扫出来的码应该还是当前真正生效的语言,保存之后才跟着变。
  const [serverLocale, setServerLocale] = useState<Locale | null>(null);
  const [controlToken, setControlToken] = useState<string>('');
  const [tokenInput, setTokenInput] = useState('');
  // 最近一次【服务端确认过】的配置指纹,用来算"未保存修改"
  const [savedSnapshot, setSavedSnapshot] = useState<string>('');

  const matchId = id ?? '';

  /**
   * t 随语言变化换引用。若把 t 放进 load 的依赖里,每次切语言都会重跑 load,
   * 而 load 是从服务端把整场比赛重新拉一遍 —— 用户**还没保存**的修改
   * (队名、队色、规则、甚至刚选的语言)会被服务端状态整个冲掉,
   * 表现就是"改完一保存就没了"。
   * 所以这里用 ref 取最新的 t,load 只依赖 matchId。
   */
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    if (!matchId) return;
    setLoading(true);
    try {
      const res = await getMatch(matchId);
      captureTokens(matchId, res);
      setDraft(res.match);
      setServerLocale(res.match.presentation.locale ?? null);
      setSavedSnapshot(configFingerprint(res.match));
      const stored = readStoredTokens(matchId);
      setControlToken(stored.controlToken ?? '');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tRef.current('setup.err.read'));
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 跟随本场语言设置(计分员在控制台切过语言后,这边也会跟着变)
  //
  // 清空 scope 只放在"卸载时":放在这个 effect 的 cleanup 里会在每次语言变化时
  // 先把 scope 清成 null,界面闪一下别的语言再切回来。
  useEffect(() => {
    setScopedLocale(draft?.presentation.locale ?? null);
  }, [draft?.presentation.locale]);
  useEffect(() => () => setScopedLocale(null), []);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    const loadQr = async () => {
      try {
        const [c, d] = await Promise.all([getQr(matchId, 'control'), getQr(matchId, 'display')]);
        if (!cancelled) {
          setControlQr(c.dataUrl);
          setDisplayQr(d.dataUrl);
          // url 才是可用链接:control 带 ?t=<控制令牌>,display 带 ?lang=
          setControlLink(c.url ?? null);
          setDisplayLink(d.url ?? null);
          setQrToken(c.token ?? null);
        }
      } catch {
        if (!cancelled) {
          setControlQr(null);
          setDisplayQr(null);
          setControlLink(null);
          setDisplayLink(null);
        }
      }
    };
    void loadQr();
    return () => {
      cancelled = true;
    };
  }, [matchId, serverLocale]);

  // 优先用服务端给的链接;拿不到时才退回本机拼装(此时控制台链接可能缺 ?t=)
  const controlUrl = useMemo(
    () => controlLink ?? buildControlUrl(matchId, controlToken || null),
    [controlLink, matchId, controlToken],
  );
  const displayUrl = useMemo(
    () => displayLink ?? buildDisplayUrl(matchId, serverLocale),
    [displayLink, matchId, serverLocale],
  );

  function patchTeam(side: 'home' | 'away', patch: Partial<Team>) {
    setDraft((prev) => (prev ? { ...prev, [side]: { ...prev[side], ...patch } } : prev));
    setSaved(null);
    setError(null);
  }

  function patchRules(patch: Partial<MatchRules>) {
    setDraft((prev) => (prev ? { ...prev, rules: { ...prev.rules, ...patch } } : prev));
    setSaved(null);
    setError(null);
  }

  function patchPresentation(patch: Partial<Presentation>) {
    setDraft((prev) => (prev ? { ...prev, presentation: { ...prev.presentation, ...patch } } : prev));
    setSaved(null);
    setError(null);
  }

  /**
   * 立即下发(开关、下拉这类"一次成型"的值)。
   *
   * 只把**这一个字段**发给服务端,不带其他还没保存的输入框内容 ——
   * 否则用户在队名框里敲到一半,一个开关就会把半截队名推到现场大屏。
   *
   * 失败时回滚界面并把错误顶到顶栏,不让界面和服务器各说各话。
   */
  async function instantPatch(body: MatchConfigPatch, revert: () => void) {
    try {
      const res = await patchMatch(matchId, body, qrToken);
      setSavedSnapshot(configFingerprint(res.match));
      setSaved(t('setup.synced'));
      setError(null);
    } catch (e) {
      revert();
      setSaved(null);
      setError(e instanceof Error ? e.message : t('setup.err.save'));
    }
  }

  /** 规则里的开关:勾上就生效 */
  function toggleRule(patch: Partial<MatchRules>) {
    if (!draft) return;
    const prev = { ...draft.rules };
    setDraft((d) => (d ? { ...d, rules: { ...d.rules, ...patch } } : d));
    void instantPatch({ rules: patch }, () => setDraft((d) => (d ? { ...d, rules: prev } : d)));
  }

  /** 显示设置里的开关/下拉:选了就生效 */
  function togglePresentation(patch: Partial<Presentation>) {
    if (!draft) return;
    const prev = { ...draft.presentation };
    setDraft((d) => (d ? { ...d, presentation: { ...d.presentation, ...patch } } : d));
    void instantPatch({ presentation: patch }, () =>
      setDraft((d) => (d ? { ...d, presentation: prev } : d)),
    );
  }

  /** 有没有还没保存到服务端的修改 */
  const dirty = useMemo(
    () => !!draft && savedSnapshot !== '' && configFingerprint(draft) !== savedSnapshot,
    [draft, savedSnapshot],
  );

  /**
   * 保存状态。
   *
   * 为什么放在顶栏而不是页面顶部:配置页很长(队伍/规则/显示/令牌/危险操作),
   * 用户滚到"规则参数"那一段时,页面顶部的提示横幅根本不在视野里 ——
   * 于是"改了没保存"就变成了"改了没反应"。
   * 顶栏是 sticky 的,状态永远在眼前。
   */
  const saveState = useMemo(() => {
    if (saving) return { kind: 'busy', text: t('setup.saving') };
    if (error) return { kind: 'err', text: error };
    if (dirty) return { kind: 'dirty', text: t('setup.dirty') };
    if (saved) return { kind: 'ok', text: saved };
    return { kind: 'idle', text: '' };
  }, [saving, error, dirty, saved, t]);

  /**
   * 切换本场语言。
   * 立刻在页面上生效(本机偏好 + 临时覆盖),点"保存"后写进服务端,
   * 大屏与控制台就会跟着切。
   */
  function changeLocale(next: Locale) {
    patchPresentation({ locale: next });
    setLocale(next);
  }

  /**
   * 上传队徽 → **立刻**下发,不等点「保存」。
   *
   * 为什么可以立刻下发:上传是"选完一个文件"这种一次性的完整动作,
   * 不存在"敲到一半"的问题。而队名输入框可能正敲到一半 ——
   * 所以这里只发 logoUrl 这一个字段,绝不能把半截队名一起推到大屏。
   *
   * 以前只改本地草稿,忘了点「保存」就换页,队徽就白传了 ——
   * 大屏上什么也没变,看起来像功能坏了。
   */
  async function onLogo(side: 'home' | 'away', file: File) {
    const prev = (side === 'home' ? draft?.home : draft?.away)?.logoUrl ?? null;
    try {
      const res = await uploadLogo(file);
      patchTeam(side, { logoUrl: res.url });
      const body: MatchConfigPatch =
        side === 'home' ? { home: { logoUrl: res.url } } : { away: { logoUrl: res.url } };
      await instantPatch(body, () => patchTeam(side, { logoUrl: prev }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('setup.err.logo'));
    }
  }

  /** 移除队徽:同样立刻下发 */
  function onLogoRemove(side: 'home' | 'away') {
    patchTeam(side, { logoUrl: null });
    const body: MatchConfigPatch =
      side === 'home' ? { home: { logoUrl: null } } : { away: { logoUrl: null } };
    void instantPatch(body, () => {});
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await patchMatch(
        matchId,
        {
          name: draft.name,
          venue: draft.venue,
          court: draft.court,
          startTime: draft.startTime ?? null,
          home: draft.home,
          away: draft.away,
          rules: draft.rules,
          presentation: draft.presentation,
        },
        // 控制令牌就够改配置了;没有管理员密钥也能保存
        qrToken,
      );
      captureTokens(matchId, res);
      setDraft(res.match);
      setServerLocale(res.match.presentation.locale ?? null);
      setSavedSnapshot(configFingerprint(res.match));
      setSaved(t('setup.savedAt', { time: formatClockTime(Date.now()) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('setup.err.save'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * 打开破坏性操作的确认弹窗。
   *
   * 预填上次用过的密钥(记在 sessionStorage):现场往往要连续重置好几场,
   * 让人每次都去翻配置太折腾;预填只是省事,真正拦住操作的仍然是服务端。
   */
  function openDanger(action: 'reset' | 'delete') {
    setDangerAction(action);
    setKeyInput(getAdminKey() ?? '');
    setKeyError(null);
    setError(null);
  }

  function closeDanger() {
    if (keyBusy) return;
    setDangerAction(null);
    setKeyError(null);
  }

  /**
   * 提交弹窗:密钥对了才执行重置/删除。
   *
   * 密钥不对时【弹窗不关】,直接原地报错 —— 让用户能改一个字符再试,
   * 不用把整件事从头再来一遍。
   */
  async function submitDanger() {
    if (!dangerAction) return;
    const key = keyInput.trim();
    if (!key) {
      setKeyError(t('setup.keyPrompt.needKey'));
      return;
    }
    setKeyBusy(true);
    setKeyError(null);
    try {
      if (dangerAction === 'reset') {
        const res = await resetMatch(matchId, key);
        setAdminKey(key);
        setDraft(res.match);
        setServerLocale(res.match.presentation.locale ?? null);
        setSavedSnapshot(configFingerprint(res.match));
        setSaved(t('setup.saved.reset'));
        setDangerAction(null);
      } else {
        await deleteMatch(matchId, key);
        setAdminKey(key);
        navigate('/');
      }
    } catch (e) {
      // 服务端的拒绝原因(如"需要管理员密钥")直接显示;只有拿不到文案时才用兜底
      setKeyError(
        e instanceof Error
          ? e.message
          : dangerAction === 'reset'
            ? t('setup.err.reset')
            : t('setup.err.delete'),
      );
    } finally {
      setKeyBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setSaved(t('setup.copied'));
    } catch {
      setError(t('setup.err.copy'));
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-body">{t('setup.loading')}</div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="page">
        <div className="page-body">
          <div className="notice danger">{error ?? t('setup.notFound')}</div>
          <button type="button" className="btn" style={{ marginTop: 16 }} onClick={() => navigate('/')}>
            {t('setup.backDashboard')}
          </button>
        </div>
      </div>
    );
  }

  /**
   * 管理员密钥的说明块。
   *
   * 密钥有默认值(1818),也可能是部署时用 ADMIN_KEY 环境变量改过的。
   * 弹窗里直接把这两条告诉用户,省得"页面上查不到就以为系统坏了"。
   */
  return (
    <div className="page">
      <header className="topbar">
        <h1>{draft.name || t('setup.title')}</h1>
        <span className="badge">{draft.court || t('dashboard.court.unnumbered')}</span>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => navigate('/')}>
          {t('setup.back')}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => window.open(controlUrl, '_blank', 'noopener')}
        >
          <IconExternal size={16} /> {t('setup.control')}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => window.open(displayUrl, '_blank', 'noopener')}
        >
          <IconExternal size={16} /> {t('setup.display')}
        </button>
        <LanguageToggle />
        {/* 保存状态:常驻顶栏,滚到页面下方也看得见 */}
        {saveState.text ? (
          <span className={`save-state ${saveState.kind}`} title={saveState.text}>
            {saveState.text}
          </span>
        ) : null}
        <button
          type="button"
          className="btn primary"
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? t('setup.saving') : t('setup.save')}
        </button>
      </header>

      <div className="page-body">
        <div className="grid-2" style={{ marginBottom: 18 }}>
          <TeamEditor
            title={t('setup.team.home')}
            team={draft.home}
            onChange={(patch) => patchTeam('home', patch)}
            onLogo={(f) => void onLogo('home', f)}
            onLogoRemove={() => onLogoRemove('home')}
          />
          <TeamEditor
            title={t('setup.team.away')}
            team={draft.away}
            onChange={(patch) => patchTeam('away', patch)}
            onLogo={(f) => void onLogo('away', f)}
            onLogoRemove={() => onLogoRemove('away')}
          />
        </div>

        <div className="grid-2" style={{ marginBottom: 18 }}>
          <div className="panel">
            <h2>{t('setup.info.title')}</h2>
            <p className="panel-hint">{t('setup.info.hint')}</p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="m-name">{t('setup.info.name')}</label>
                <input id="m-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="m-venue">{t('setup.info.venue')}</label>
                <input id="m-venue" value={draft.venue} onChange={(e) => setDraft({ ...draft, venue: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="m-court">{t('setup.info.court')}</label>
                <input id="m-court" value={draft.court} onChange={(e) => setDraft({ ...draft, court: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="m-start-time">{t('setup.info.startTime')}</label>
                <input
                  id="m-start-time"
                  type="time"
                  value={draft.startTime ?? ''}
                  onChange={(e) => setDraft({ ...draft, startTime: e.target.value || null })}
                />
                <small className="field-hint">{t('setup.info.startTime.hint')}</small>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>{t('setup.rules.title')}</h2>
            <p className="panel-hint">{t('setup.rules.hint')}</p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="r-periods">{t('setup.rules.periods')}</label>
                <input
                  id="r-periods"
                  type="number"
                  min={1}
                  max={9}
                  value={draft.rules.periods}
                  onChange={(e) => patchRules({ periods: Number(e.target.value) || 1 })}
                />
              </div>
              <div className="field">
                <label htmlFor="r-minutes">{t('setup.rules.periodMinutes')}</label>
                <input
                  id="r-minutes"
                  type="number"
                  min={1}
                  max={60}
                  value={draft.rules.periodMinutes}
                  onChange={(e) => patchRules({ periodMinutes: Number(e.target.value) || 1 })}
                />
              </div>
              <div className="field">
                <label htmlFor="r-shot">{t('setup.rules.shotSeconds')}</label>
                <input
                  id="r-shot"
                  type="number"
                  min={0}
                  max={99}
                  value={draft.rules.shotClockSeconds}
                  onChange={(e) => patchRules({ shotClockSeconds: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="field">
                <label htmlFor="r-to">{t('setup.rules.timeouts')}</label>
                <input
                  id="r-to"
                  type="number"
                  min={0}
                  max={20}
                  value={draft.rules.timeoutsPerTeam}
                  onChange={(e) => patchRules({ timeoutsPerTeam: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="field">
                <label htmlFor="r-timeout">{t('setup.rules.timeoutSeconds')}</label>
                <input
                  id="r-timeout"
                  type="number"
                  min={5}
                  max={600}
                  value={draft.rules.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS}
                  onChange={(e) =>
                    patchRules({ timeoutSeconds: Number(e.target.value) || DEFAULT_TIMEOUT_SECONDS })
                  }
                />
                <span className="hint">{t('setup.rules.timeoutSeconds.hint')}</span>
              </div>
              <div className="field">
                <label htmlFor="r-bonus">{t('setup.rules.bonus')}</label>
                <input
                  id="r-bonus"
                  type="number"
                  min={0}
                  max={20}
                  value={draft.rules.bonusFouls}
                  onChange={(e) => patchRules({ bonusFouls: Number(e.target.value) || 0 })}
                />
              </div>
            </div>

            {/* 开关类:勾上立即下发(大屏同步更新),不需要点「保存」 */}
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={draft.rules.useShotClock}
                  onChange={(e) => toggleRule({ useShotClock: e.target.checked })}
                />
                {t('setup.switch.shot')}
              </label>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={draft.rules.showTeamFouls}
                  onChange={(e) => toggleRule({ showTeamFouls: e.target.checked })}
                />
                {t('setup.switch.fouls')}
              </label>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={draft.rules.showTimeouts}
                  onChange={(e) => toggleRule({ showTimeouts: e.target.checked })}
                />
                {t('setup.switch.timeouts')}
              </label>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={draft.rules.showPossession}
                  onChange={(e) => toggleRule({ showPossession: e.target.checked })}
                />
                {t('setup.switch.possession')}
              </label>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={draft.presentation.soundEnabled}
                  onChange={(e) => togglePresentation({ soundEnabled: e.target.checked })}
                />
                {t('setup.switch.sound')}
              </label>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              {t('setup.switch.hint')}
            </p>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 18 }}>
          <h2>{t('setup.display.title')}</h2>
          <p className="panel-hint">{t('setup.display.hint')}</p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="p-template">{t('setup.display.template')}</label>
              <select
                id="p-template"
                value={draft.presentation.template}
                onChange={(e) => togglePresentation({ template: e.target.value as Presentation['template'] })}
              >
                <option value="simple">{t('setup.display.template.simple')}</option>
                <option value="led">{t('setup.display.template.led')}</option>
                <option value="broadcast">{t('setup.display.template.broadcast')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="p-title">{t('setup.display.titleText')}</label>
              <input
                id="p-title"
                value={draft.presentation.titleText}
                onChange={(e) => patchPresentation({ titleText: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="p-sponsor">{t('setup.display.sponsorName')}</label>
              <input
                id="p-sponsor"
                value={draft.presentation.sponsorName}
                onChange={(e) => patchPresentation({ sponsorName: e.target.value })}
              />
              <span className="hint">{t('setup.display.sponsorHint')}</span>
            </div>
            <div className="field">
              <label htmlFor="p-sponsor-text">{t('setup.display.sponsorText')}</label>
              <input
                id="p-sponsor-text"
                value={draft.presentation.sponsorText}
                onChange={(e) => patchPresentation({ sponsorText: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="p-fit">{t('setup.display.fit')}</label>
              <select
                id="p-fit"
                value={draft.presentation.autoFit}
                onChange={(e) => togglePresentation({ autoFit: e.target.value as Presentation['autoFit'] })}
              >
                <option value="fit">{t('setup.display.fit.fit')}</option>
                <option value="stretch">{t('setup.display.fit.stretch')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="p-locale">{t('setup.locale.title')}</label>
              <select
                id="p-locale"
                value={draft.presentation.locale ?? 'zh-CN'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    // 显式写 null:JSON 会把 undefined 丢掉,那样"清空"根本发不出去
                    patchPresentation({ locale: null });
                    setScopedLocale(null);
                  } else {
                    changeLocale(v as Locale);
                  }
                }}
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
              <span className="hint">{t('setup.locale.hint')}</span>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 18 }}>
          <h2>{t('setup.tokens.title')}</h2>
          <p className="panel-hint">{t('setup.tokens.panelHint')}</p>

          <div className="grid-2">
            <div className="token-box">
              <div className="qr">
                {controlQr ? (
                  <img src={controlQr} alt={t('setup.tokens.qrControl')} />
                ) : (
                  <div className="muted tiny">{t('setup.tokens.qrLoading')}</div>
                )}
              </div>
              <div className="token-links">
                <div className="token-link">
                  <code>{controlUrl}</code>
                  <button
                    type="button"
                    className="icon-btn"
                    title={t('setup.tokens.copyControl')}
                    onClick={() => void copy(controlUrl)}
                  >
                    <IconCopy size={16} />
                  </button>
                </div>
                <div className="field">
                  <label htmlFor="ctl-token">{t('setup.tokens.controlLabel')}</label>
                  <input
                    id="ctl-token"
                    value={tokenInput}
                    placeholder={t('setup.tokens.controlPlaceholder')}
                    onChange={(e) => setTokenInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn small"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => {
                      const v = tokenInput.trim();
                      if (!v) return;
                      writeStoredTokens(matchId, { controlToken: v });
                      setControlToken(v);
                      setTokenInput('');
                    }}
                  >
                    {t('setup.tokens.saveToken')}
                  </button>
                </div>
                <span className="hint">{t('setup.tokens.hint')}</span>
              </div>
            </div>

            <div className="token-box">
              <div className="qr">
                {displayQr ? (
                  <img src={displayQr} alt={t('setup.tokens.qrDisplay')} />
                ) : (
                  <div className="muted tiny">{t('setup.tokens.qrLoading')}</div>
                )}
              </div>
              <div className="token-links">
                <div className="token-link">
                  <code>{displayUrl}</code>
                  <button
                    type="button"
                    className="icon-btn"
                    title={t('setup.tokens.copyDisplay')}
                    onClick={() => void copy(displayUrl)}
                  >
                    <IconCopy size={16} />
                  </button>
                </div>
                <span className="hint">{t('setup.tokens.displayHint')}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>{t('setup.danger.title')}</h2>
          <p className="panel-hint">{t('setup.danger.hint')}</p>
          <div className="btn-row">
            <button type="button" className="btn danger" onClick={() => openDanger('reset')}>
              {t('setup.danger.reset')}
            </button>
            <button type="button" className="btn danger" onClick={() => openDanger('delete')}>
              {t('setup.danger.delete')}
            </button>
          </div>
        </div>
      </div>

      {/*
        破坏性操作的确认弹窗。
        密钥输错时弹窗不关,原地显示服务端给的拒绝原因 ——
        让用户改一个字符就能再试,而不是"失败一次要重来一遍"。
      */}
      {dangerAction ? (
        <AdminKeyPrompt
          action={dangerAction}
          value={keyInput}
          error={keyError}
          busy={keyBusy}
          onChange={setKeyInput}
          onSubmit={() => void submitDanger()}
          onCancel={closeDanger}
        />
      ) : null}
    </div>
  );
}
