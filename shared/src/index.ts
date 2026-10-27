/**
 * BIPH 场地管理台 共享类型与协议契约
 * ------------------------------------------------------------------
 * 前后端共用。任何"状态"的唯一表示都在这里定义。
 *
 * 核心约定(计时器不依赖网络的关键):
 *   1. 时间以【整数毫秒】存储,绝不存格式化字符串("07:22" 那种)。
 *   2. 时钟状态是【锚点】(ClockAnchor),不是"当前剩余时间"。
 *      锚点 = "在服务器时刻 anchorServerTs,还剩 remainingMs,且 running"。
 *   3. 每条下行消息都带 serverTs(服务器时钟),因此【任何一条消息单独
 *      都能算出此刻应有的显示值】——迟到/重复/乱序/丢失都不会算错。
 *   4. 客户端用单调时钟(performance.now)从锚点本地推算剩余时间,
 *      断网期间照样走秒。
 */

/* ============================ 领域模型 ============================ */

export type MatchStatus = 'scheduled' | 'live' | 'finished';
export type Side = 'home' | 'away';
export type Possession = Side | null;
export type TemplateId = 'simple' | 'led' | 'broadcast';
export type AutoFit = 'fit' | 'stretch';

/**
 * 运动项目。
 *
 * 目前只做了篮球,先把字段和注册表的位置留好 ——
 * 以后加足球/排球,只需要加一个枚举值和一条注册表配置。
 */
export type SportId = 'basketball';

/**
 * 界面语言。
 *
 * 存在比赛配置里(presentation.locale),这样"切换语言"可以跟着比赛走:
 * 计分员在 iPad 上切到英文,大屏那台机器也会跟着切。
 * 不填 = 跟随本机偏好(见 client/src/i18n)。
 *
 * v0.16 起,语言实际上是**整个场馆一个**(venue locale):
 * 服务端把一次切换镜像到所有比赛的 presentation.locale,
 * 这样管理台(没有"本场"概念)与控制台(跟着本场走)永远是同一个语言。
 */
export type Locale = 'zh-CN' | 'en-US';

/** 支持的语言(顺序即界面里显示的顺序) */
export const LOCALES: readonly Locale[] = ['zh-CN', 'en-US'];

/**
 * 场馆语言的默认值。
 *
 * 场馆语言是**始终具体**的(不是"没设置就各看各的"):
 * 否则管理台和控制台可能各按各的本机偏好显示,又对不上了。
 */
export const DEFAULT_VENUE_LOCALE: Locale = 'zh-CN';

/** 判断一个未知值是不是受支持的语言 */
export function isLocale(v: unknown): v is Locale {
  return v === 'zh-CN' || v === 'en-US';
}

export interface MatchRules {
  /** 节数 */
  periods: number;
  /** 每节分钟数 */
  periodMinutes: number;
  /** 进攻钟秒数 */
  shotClockSeconds: number;
  /** 每队暂停次数 */
  timeoutsPerTeam: number;
  /**
   * 暂停时长(秒)—— 请求暂停后大屏进入的倒计时长度。
   *
   * 可选字段:老库里没有这一项,服务端读库时会补上默认值
   * (见 DEFAULT_TIMEOUT_SECONDS),老客户端直接忽略即可。
   */
  timeoutSeconds?: number;
  /** 全队犯规达到该值进入 bonus */
  bonusFouls: number;
  /** 是否使用进攻钟 */
  useShotClock: boolean;
  /** 大屏是否显示全队犯规 */
  showTeamFouls: boolean;
  /** 大屏是否显示暂停剩余 */
  showTimeouts: boolean;
  /** 大屏是否显示进攻权箭头 */
  showPossession: boolean;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  color: string;
  textColor: string;
  logoUrl: string | null;
  score: number;
  /** 全队犯规 */
  fouls: number;
  /** 剩余暂停次数 */
  timeouts: number;
}

/**
 * 计时锚点的【最小结构】。
 *
 * 比赛钟、进攻钟、暂停倒计时都遵守同一条规则:
 *   "在服务器时刻 anchorServerTs,还剩 remainingMs,且 running"。
 * 把这条规则抽成一个公共结构,是为了让新增的暂停倒计时
 * 直接复用 remainingMs() —— 不另写一份算法,就不会出现两侧算法漂移。
 */
export interface TimeAnchor {
  /** 计时是否在跑 */
  running: boolean;
  /** 锚点时刻的剩余毫秒(整数) */
  remainingMs: number;
  /** 锚点创建时的服务器时钟(ms) */
  anchorServerTs: number;
}

export interface ClockAnchor extends TimeAnchor {
  /** 当前节次,从 1 开始 */
  period: number;
  /** 节次显示文本,如 Q1 / OT1 / HT / FINAL */
  periodLabel: string;
}

/**
 * 暂停倒计时锚点。
 *
 * 与比赛钟一样是"锚点"而不是"当前剩余时间":
 * 服务端只广播锚点,大屏用单调时钟本地推算 —— 断网时倒计时照样走秒。
 */
export interface TimeoutAnchor extends TimeAnchor {
  /** 发起暂停的队伍(null = 当前没有暂停在进行) */
  side: Side | null;
}

export interface Presentation {
  template: TemplateId;
  titleText: string;
  sponsorName: string;
  sponsorText: string;
  soundEnabled: boolean;
  autoFit: AutoFit;
  /**
   * 界面语言(可选)。留空 = 跟随本机偏好。
   * 只加可选字段,老客户端不认识就当没看见,前后端仍然兼容。
   *
   * 允许显式写 null:JSON 会把 undefined 丢掉,那样"清空语言设置"这个动作
   * 永远发不到服务器,界面上选了却没反应。null 与不填等价。
   */
  locale?: Locale | null;
}

/**
 * 开赛模式。
 *
 * - `scheduled` **准点模式**:填"几点开球"(赛程表上的 19:00),按墙钟算;
 * - `countdown` **倒计时模式**:填"还有多久开球"(15:00),从设定那一刻起算。
 *
 * 两种模式最后都变成同一个东西给大屏:**一个还剩多少毫秒的倒计时**。
 */
export type StartMode = 'scheduled' | 'countdown';

/**
 * 开赛倒计时锚点(倒计时模式用)。
 *
 * 和比赛钟、进攻钟是同一套模型:
 *   "在服务器时刻 anchorServerTs,还剩 durationMs"。
 * 客户端拿服务器时间估计一减就得到当前剩余,断网时照常走秒。
 */
export interface StartCountdownAnchor {
  /** 起算时的总时长(ms) */
  durationMs: number;
  /** 起算时刻(服务器时钟,epoch ms) */
  anchorServerTs: number;
}

export interface Match {
  id: string;
  name: string;
  venue: string;
  /** 场地号,如 "1 号场" */
  court: string;
  status: MatchStatus;
  /**
   * 运动项目(可选)。
   *
   * 留空 = 篮球(老库里的比赛没有这个字段,按篮球处理,前后端都兼容)。
   */
  sport?: SportId;
  rules: MatchRules;
  home: Team;
  away: Team;
  clock: ClockAnchor;
  shotClock: ClockAnchor;
  /**
   * 暂停倒计时(可选)。
   *
   * 老库里没有这个字段,服务端读库时会补上;
   * 老客户端不认识它,直接忽略即可,前后端仍然兼容。
   */
  timeout?: TimeoutAnchor;
  possession: Possession;
  /**
   * 计划开赛时间(墙钟,`HH:MM`,可选)。
   *
   * 填了之后,大屏会在**开赛前 3 分钟**切到开赛倒计时;
   * 留空 = 不显示这个倒计时。
   *
   * 用墙钟而不是"第几秒"是有意的:开赛时间是赛程表上的东西(19:00 那场),
   * 不是从打开页面开始数的。代价是它依赖各机器的本地时钟与时区一致 ——
   * 校内这几台机器都在同一个校园网、同一时区,这个前提成立。
   *
   * 老库里没有这个字段,老客户端不认识它,直接忽略即可,前后端仍然兼容。
   */
  startTime?: string | null;
  /**
   * 开赛模式(可选)。
   *
   * - `'scheduled'` 准点模式:看 `startTime` 那个墙钟(赛程表上的 19:00)
   * - `'countdown'` 倒计时模式:看 `startCountdown` 那个锚点(还剩多久)
   *
   * 留空 = 老库兼容:按"有没有倒计时锚点"自动判断(有锚点就是倒计时模式)。
   *
   * 老库里没有这个字段,老客户端不认识它,直接忽略即可,前后端仍然兼容。
   */
  startMode?: StartMode | null;
  /**
   * 开赛倒计时锚点(可选)—— 倒计时模式用。
   *
   * 和比赛钟同一个模型:只存锚点,客户端本地推算,断网也准时。
   * `durationMs` 是设定那一刻算起的总时长,`anchorServerTs` 是设定的时刻。
   *
   * 老库里没有这个字段,老客户端不认识它,直接忽略即可,前后端仍然兼容。
   */
  startCountdown?: StartCountdownAnchor | null;
  presentation: Presentation;
  /** 单调递增序号,客户端用于检测丢包 */
  seq: number;
  createdAt: number;
  updatedAt: number;
  /** 最近一条事件文案(大屏可播报) */
  lastEvent: string | null;
}

/**
 * 比赛配置的补丁(命令通道 / 配置接口通用)。
 *
 * 与 `Partial<Match>` 的两处不同:
 *   - `home` / `away` / `rules` / `presentation` 是**局部**补丁,不是整个替换;
 *   - 倒计时只接受**时长**(`startCountdownMs`),不接受锚点本身 ——
 *     "从什么时候开始算"必须由服务端打点,客户端的时钟不可信。
 */
export interface MatchUpdatePatch
  extends Partial<Omit<Match, 'home' | 'away' | 'rules' | 'presentation' | 'startCountdown'>> {
  home?: Partial<Team>;
  away?: Partial<Team>;
  rules?: Partial<MatchRules>;
  presentation?: Partial<Presentation>;
  /**
   * 开赛倒计时时长(ms)。
   *
   * - 给了数字 → **从这一刻重新起算**(服务端打点);
   * - 给了 null → 取消倒计时;
   * - 没给这个字段 → 保持原值(不动已有的倒计时)。
   */
  startCountdownMs?: number | null;
}

/* ============================ 默认值 ============================ */

/** 暂停时长默认值(秒)—— 老库补齐用 */
export const DEFAULT_TIMEOUT_SECONDS = 60;

export const DEFAULT_RULES: MatchRules = {
  periods: 4,
  periodMinutes: 10,
  shotClockSeconds: 24,
  timeoutsPerTeam: 4,
  timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  bonusFouls: 5,
  useShotClock: true,
  showTeamFouls: true,
  showTimeouts: true,
  showPossession: true,
};

export const DEFAULT_PRESENTATION: Presentation = {
  template: 'simple',
  titleText: '',
  sponsorName: '',
  sponsorText: '',
  soundEnabled: true,
  autoFit: 'fit',
};

export const TEMPLATE_IDS: TemplateId[] = ['simple', 'led', 'broadcast'];

/* ============================ 时钟数学 ============================
 * 以下函数由服务端与客户端【共用同一份实现】,保证两侧算法一致。
 */

/**
 * 计算锚点在服务器时刻 serverNow 的剩余毫秒。
 * @param anchor  锚点(比赛钟 / 进攻钟 / 暂停倒计时都适用)
 * @param serverNow 客户端估算的"当前服务器时间"(ms)
 */
export function remainingMs(anchor: TimeAnchor, serverNow: number): number {
  if (!anchor.running) return Math.max(0, anchor.remainingMs);
  return Math.max(0, anchor.remainingMs - (serverNow - anchor.anchorServerTs));
}

/** 毫秒 → mm:ss(向上取整,10:00 显示为 10:00 而非 09:59) */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 毫秒 → ss(进攻钟,两位补零) */
export function formatSeconds(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return String(total).padStart(2, '0');
}

/** 节次标签:Q1..Qn / OT1.. / HT / FINAL */
export function buildPeriodLabel(period: number, totalPeriods: number, status: MatchStatus): string {
  if (status === 'finished') return 'FINAL';
  if (period <= 0) return 'Q1';
  if (period <= totalPeriods) return `Q${period}`;
  return `OT${period - totalPeriods}`;
}

/** 由规则算出单节总毫秒 */
export function periodDurationMs(rules: MatchRules): number {
  return rules.periodMinutes * 60_000;
}

/* ============================ 开赛时间 ============================
 * 「计划开赛时间」是【墙钟】(赛程表上的 19:00),不是从打开页面开始数的倒计时。
 * 所以判定要落到"最近一个还没到的那个时刻"上,否则跨零点会算错。
 * ================================================================ */

/** 开赛倒计时的显示窗口:开赛前 3 分钟 */
export const START_COUNTDOWN_WINDOW_MS = 3 * 60_000;

const START_TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** "HH:MM" 是不是一个合法的开赛时间(服务端也要用这个把住脏数据) */
export function isValidStartTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = START_TIME_RE.exec(value.trim());
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

/**
 * "HH:MM" → 最近的、**还没到**的那个时刻的绝对毫秒。
 *
 * 跨零点是这个函数存在的理由:
 *   - 现在 00:10,开赛 01:00 → 今天 01:00(还差 50 分钟)
 *   - 现在 23:58,开赛 00:30 → 明天 00:30(不是 32 分钟后)
 *   - 现在正好 19:00:00,开赛 19:00 → 明天 19:00(此刻倒计时归零并消失)
 *
 * 返回 null:格式不合法 / 没填。
 */
export function nextStartOccurrence(startTime: string | null | undefined, nowMs: number): number | null {
  if (!isValidStartTime(startTime)) return null;
  const m = START_TIME_RE.exec((startTime as string).trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const d = new Date(nowMs);
  // 用本机时区解释 "19:00" —— 赛程表上的时间就是球场挂钟上的时间
  let occ = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).getTime();
  if (!Number.isFinite(occ)) return null;
  // 今天这个时刻已经过去了 → 下一次就是明天同一时刻
  if (occ <= nowMs) occ += 24 * 60 * 60 * 1000;
  return occ;
}

/**
 * 开赛倒计时还剩多少毫秒。
 *
 * 只有落在"开赛前 3 分钟"这个窗口里才返回数字,否则返回 null(大屏不显示)。
 * 窗口本身是 3 分钟 —— 早了不打扰(赛程表上还有别的场次),晚了就没意义了。
 */
export function startCountdownMs(
  startTime: string | null | undefined,
  nowMs: number,
  windowMs: number = START_COUNTDOWN_WINDOW_MS,
): number | null {
  const occ = nextStartOccurrence(startTime, nowMs);
  if (occ === null) return null;
  const diff = occ - nowMs;
  if (diff <= 0 || diff > windowMs) return null;
  return diff;
}

/* ============================ 开赛模式 ============================
 * 准点模式与倒计时模式最后都要变成同一个东西喂给大屏:
 * "一个还剩多少毫秒的倒计时"(或者"没有倒计时")。
 *
 * ⚠ 两种模式用的时钟不是同一个,别混:
 *   - 准点模式用【墙钟】 —— "19:00" 是赛程表上的时刻,必须跟球场挂钟一致;
 *   - 倒计时模式用【服务器时间】 —— 锚点由服务端打点,用墙钟去减会算偏。
 * 所以 resolveStartDisplay 要两个时间一起给,谁用哪个一目了然。
 * ================================================================ */

/** 开赛模式的取值 */
export const START_MODES: readonly StartMode[] = ['scheduled', 'countdown'];

/** 倒计时模式最长 24 小时(再多就该用准点模式写日期了) */
export const MAX_START_COUNTDOWN_MS = 24 * 60 * 60 * 1000;

/** "15"、"15:30" 这类输入(分钟最多 4 位,再大就超过 24 小时上限了) */
const START_COUNTDOWN_RE = /^(\d{1,4})(?::(\d{1,2}))?$/;

/** 值是不是一个合法的开赛模式 */
export function isValidStartMode(value: unknown): value is StartMode {
  return value === 'scheduled' || value === 'countdown';
}

/**
 * 把"还剩多久"这句话翻译成毫秒。
 *
 * 接受三种写法(现场手输,能少打字就少打字):
 *   - `"15"`    → 15 分钟
 *   - `"15:30"` → 15 分 30 秒
 *   - `"0:45"`  → 45 秒
 *
 * 返回 null = 写法不对(或者 0 / 超过 24 小时)。
 */
export function parseStartCountdown(text: string | null | undefined): number | null {
  if (typeof text !== 'string') return null;
  const m = START_COUNTDOWN_RE.exec(text.trim());
  if (!m) return null;
  const mm = Number(m[1]);
  const ss = m[2] === undefined ? 0 : Number(m[2]);
  if (!Number.isFinite(mm) || !Number.isFinite(ss)) return null;
  // 写了秒就必须是小数位内的秒:"15:75" 不是 15 分 75 秒,那是 16 分 15 秒,会算错
  if (m[2] !== undefined && ss > 59) return null;
  const total = mm * 60_000 + ss * 1000;
  if (total <= 0 || total > MAX_START_COUNTDOWN_MS) return null;
  return total;
}

/** 毫秒 → "15:30"(输入框回填用) */
export function formatStartCountdownInput(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 这份数据是不是一个像样的倒计时锚点(脏数据要挡住) */
export function isValidStartCountdownAnchor(value: unknown): value is StartCountdownAnchor {
  if (!value || typeof value !== 'object') return false;
  const a = value as Partial<StartCountdownAnchor>;
  return (
    typeof a.durationMs === 'number' &&
    Number.isFinite(a.durationMs) &&
    a.durationMs > 0 &&
    a.durationMs <= MAX_START_COUNTDOWN_MS &&
    typeof a.anchorServerTs === 'number' &&
    Number.isFinite(a.anchorServerTs) &&
    a.anchorServerTs > 0
  );
}

/**
 * 这场比赛用哪种开赛模式。
 *
 * 老库没有 `startMode` 字段:那就按"有没有倒计时锚点"判断 ——
 * 有锚点就是倒计时模式,没有就是准点模式。老数据不需要迁移。
 */
export function resolveStartMode(m: {
  startMode?: StartMode | null;
  startTime?: string | null;
  startCountdown?: StartCountdownAnchor | null;
}): StartMode {
  if (isValidStartMode(m.startMode)) return m.startMode;
  if (isValidStartCountdownAnchor(m.startCountdown)) return 'countdown';
  return 'scheduled';
}

/** 倒计时还剩多少毫秒(不会算出负数) */
export function startCountdownRemainingMs(
  anchor: StartCountdownAnchor | null | undefined,
  nowMs: number,
): number {
  if (!isValidStartCountdownAnchor(anchor)) return 0;
  return Math.max(0, anchor.durationMs - (nowMs - anchor.anchorServerTs));
}

/**
 * 大屏上的"开赛倒计时"现在该显示什么。
 *
 * - `{ kind: 'none' }` → 没有倒计时(大屏走待机屏)
 * - `{ kind: 'countdown' }` → 有倒计时
 *   - 准点模式:只在开赛前 3 分钟那个窗口里出现,到点后自动消失(回到待机屏)
 *   - 倒计时模式:从设定那一刻就一直显示,**归零后仍然留着**(显示 00:00 + 「开赛」),
 *     因为"到点了"是状态,不是"没有倒计时" —— 该由计分员按「开始」,绝不自动开表
 */
export type StartDisplay =
  | { kind: 'none'; mode: StartMode }
  | { kind: 'countdown'; mode: StartMode; remainingMs: number };

/** 两个时钟:准点模式用墙钟,倒计时模式用服务器时间 */
export interface StartClocks {
  /** 墙钟(本机时间) */
  wallMs: number;
  /** 估算的服务器时间 */
  serverMs: number;
}

export function resolveStartDisplay(
  m: {
    status: MatchStatus;
    startMode?: StartMode | null;
    startTime?: string | null;
    startCountdown?: StartCountdownAnchor | null;
  },
  clocks: StartClocks,
  windowMs: number = START_COUNTDOWN_WINDOW_MS,
): StartDisplay {
  // 比赛一旦开打(或已结束),就不该再显示"距开赛"
  const mode = resolveStartMode(m);
  if (m.status !== 'scheduled') return { kind: 'none', mode };
  if (mode === 'countdown') {
    if (!isValidStartCountdownAnchor(m.startCountdown)) return { kind: 'none', mode };
    return {
      kind: 'countdown',
      mode,
      remainingMs: startCountdownRemainingMs(m.startCountdown, clocks.serverMs),
    };
  }
  const occ = nextStartOccurrence(m.startTime, clocks.wallMs);
  if (occ === null) return { kind: 'none', mode };
  const diff = occ - clocks.wallMs;
  if (diff <= 0 || diff > windowMs) return { kind: 'none', mode };
  return { kind: 'countdown', mode: 'scheduled', remainingMs: diff };
}

/** 由规则算出进攻钟总毫秒 */
export function shotClockDurationMs(rules: MatchRules): number {
  return rules.shotClockSeconds * 1000;
}

/** 由规则算出暂停时长总毫秒 */
export function timeoutDurationMs(rules: MatchRules): number {
  return (rules.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
}

/**
 * 「当前没有暂停」的空锚点。
 *
 * 每次都新建一个对象 —— 共享常量被就地改写是最难查的那类 bug。
 */
export function idleTimeout(): TimeoutAnchor {
  return { running: false, remainingMs: 0, anchorServerTs: 0, side: null };
}

/* ============================ WebSocket 协议 ============================ */

export type Role = 'control' | 'display' | 'graphics';

/** 服务端 → 客户端 */
export type ServerMsg =
  | { t: 'state'; seq: number; serverTs: number; match: Match }
  | { t: 'tick'; seq: number; serverTs: number; clock: ClockAnchor; shotClock: ClockAnchor }
  | { t: 'ack'; cmdId: string; seq: number; ok: boolean; error?: string }
  | { t: 'event'; kind: EventKind; at: number; message?: string }
  | { t: 'pong'; t0: number; serverTs: number; rttMs?: number };

export type EventKind = 'buzzer' | 'log' | 'periodEnd' | 'shotClockZero' | 'clockZero';

export type CommandType =
  // 比分
  | 'score.add'
  | 'score.sub'
  // 比赛钟
  | 'clock.start'
  | 'clock.pause'
  | 'clock.toggle'
  | 'clock.adjust'
  | 'clock.set'
  | 'clock.nextPeriod'
  | 'clock.prevPeriod'
  // 进攻钟
  | 'shot.start'
  | 'shot.pause'
  | 'shot.toggle'
  | 'shot.adjust'
  | 'shot.set'
  | 'shot.reset'
  | 'shot.violation'
  // 犯规 / 暂停
  | 'foul.add'
  | 'foul.sub'
  | 'timeout.add'
  | 'timeout.sub'
  // 暂停倒计时(请求暂停 → 大屏倒计时 → 结束暂停)
  | 'timeout.request'
  | 'timeout.end'
  // 比赛
  | 'possession.set'
  | 'sides.swap'
  | 'match.status'
  | 'match.final'
  | 'buzzer'
  | 'undo'
  | 'match.update';

export interface CommandPayloadMap {
  'score.add': { side: Side; points: 1 | 2 | 3 };
  'score.sub': { side: Side; points: 1 };
  'clock.adjust': { deltaMs: number };
  'clock.set': { ms: number };
  'shot.adjust': { deltaMs: number };
  'shot.set': { ms: number };
  /**
   * 重置进攻钟。
   *
   * - `seconds`:重置到多少秒(默认用规则设定值,一般是 24)
   * - `start`  :重置后是否**直接开表**。默认 false(重置完是停的)。
   *   现场最常用的是"投篮命中 → 复位并开表",一次点完,不用再按一次开始。
   *
   * 两个字段都是可选的,老客户端只发 `{ seconds }` 的行为不变。
   */
  'shot.reset': { seconds?: number; start?: boolean };
  /**
   * 24 秒违例处理。
   *
   * 进攻钟归零时,服务端已经自动停了比赛钟、记了日志、让大屏提示。
   * 这条命令是计分员确认「球不在空中,确实是违例」之后按的:
   * 球权转给对方 + 进攻钟复位到 24(停着,等计分员按开始比赛)。
   */
  'shot.violation': Record<string, never>;
  'foul.add': { side: Side };
  'foul.sub': { side: Side };
  'timeout.add': { side: Side };
  'timeout.sub': { side: Side };
  /** 请求暂停:消耗该队一次暂停额度 + 暂停比赛钟 + 启动大屏倒计时 */
  'timeout.request': { side: Side };
  /** 结束暂停:撤下大屏倒计时(不自动恢复比赛钟) */
  'timeout.end': Record<string, never>;
  'possession.set': { side: Possession };
  'match.status': { status: MatchStatus };
  'match.update': { patch: MatchUpdatePatch };
  [k: string]: unknown;
}

/** 客户端 → 服务端 */
export type ClientMsg =
  | { t: 'cmd'; cmdId: string; type: CommandType; payload?: unknown }
  | { t: 'ping'; t0: number };

/* ============================ 客户端时钟估算 ============================
 * 整个项目最核心的一段代码。放在 shared 里,前后端与测试共用同一份实现。
 *
 * 用法:
 *   const clock = new ServerClockEstimator();
 *   clock.receive(msg.serverTs, performance.now());   // 每收到一条带 serverTs 的消息
 *   const remain = clock.remaining(anchor, performance.now());
 *
 * 原理:
 *   服务器时钟单调(不受 NTP 影响),客户端用单调时钟(performance.now)从
 *   "最近一次收到消息的时刻"往后推。收到的消息自带服务器时间戳,所以
 *   任何一条消息都足以确定当前应该显示什么 —— 迟到、重复、乱序都不会算错。
 * ========================================================================== */

export class ServerClockEstimator {
  private lastServerTs = Number.NEGATIVE_INFINITY;
  private lastRecvPerf = 0;
  private received = false;

  /** 收到一条带 serverTs 的消息。过期消息会被忽略,避免把基准往回拨。 */
  receive(serverTs: number, recvPerf: number): void {
    if (this.received && serverTs < this.lastServerTs) return;
    this.lastServerTs = serverTs;
    this.lastRecvPerf = recvPerf;
    this.received = true;
  }

  /** 是否已经收到过任何消息 */
  get hasBaseline(): boolean {
    return this.received;
  }

  /** 估算当前的服务器时间 */
  serverNow(perfNow: number): number {
    if (!this.received) return perfNow;
    return this.lastServerTs + (perfNow - this.lastRecvPerf);
  }

  /** 锚点当前应有的剩余毫秒 */
  remaining(anchor: TimeAnchor, perfNow: number): number {
    return remainingMs(anchor, this.serverNow(perfNow));
  }
}

/* ============================ 工具 ============================ */

/** 单场比赛的连接健康度(管理台用) */
export interface MatchHealth {
  /** 当前 WS 连接数 */
  clients: number;
  /** 其中控制端连接数 */
  controls: number;
  /** 其中显示端连接数 */
  displays: number;
  /** 最后一次广播时间 */
  lastSyncAt: number;
  /** 最后一次命令时间 */
  lastCommandAt: number;
}

/** GET /api/matches 响应 */
export interface MatchListResponse {
  matches: Match[];
  health: Record<string, MatchHealth>;
  /** 服务端当前时刻(ms) —— 客户端用它校准本机时钟偏移 */
  serverTs: number;
}

/** GET /api/matches/:id 响应 */
export interface MatchResponse {
  match: Match;
  /** 服务端当前时刻(ms) —— 客户端用它校准本机时钟偏移 */
  serverTs: number;
}

/**
 * GET /api/health 响应。
 *
 * 注意:wsClients 是【按比赛 id 的映射】而不是一个总数,
 * 因为多场地管理台需要逐场看"这一场有没有人连着"。
 */
export interface HealthResponse {
  ok: boolean;
  version: string;
  uptimeMs: number;
  serverTs: number;
  dbWritable: boolean;
  /** 每个比赛的 WS 连接情况 */
  wsClients: Record<string, MatchHealth>;
}

/** 创建比赛请求 */
export interface CreateMatchRequest {
  name?: string;
  venue?: string;
  court?: string;
  homeName?: string;
  awayName?: string;
  homeColor?: string;
  homeTextColor?: string;
  awayColor?: string;
  awayTextColor?: string;
  /** 不填 = 篮球 */
  sport?: SportId;
  rules?: Partial<MatchRules>;
  presentation?: Partial<Presentation>;
}

export function isSide(v: unknown): v is Side {
  return v === 'home' || v === 'away';
}

/** 从 URL 里取 role */
export function parseRole(v: string | null | undefined): Role {
  return v === 'control' || v === 'graphics' ? v : 'display';
}
