/**
 * REST 客户端。
 *
 * - admin key 存在 sessionStorage,所有写操作带 `x-admin-key` 头。
 * - 这里的 `estimatedServerNow()` 是【只有 REST、没有 WebSocket】的页面
 *   (管理台 / 配置页)用来换算服务器时间的唯一手段:
 *   用 `/api/health` 返回的 serverTs 与本机 Date.now() 的差值当作偏移量。
 *   它只用于"当前时刻"换算,倒计时本身仍然走 shared 的锚点算法,
 *   绝不使用本机时钟去递减计时器。
 */
import type {
  CreateMatchRequest,
  HealthResponse,
  Locale,
  Match,
  MatchHealth,
  MatchListResponse,
  MatchResponse,
  MatchRules,
  Presentation,
  Team,
} from '@biph/shared';
import { getLocale, translate, translateServerError, withLangParam } from '../i18n';

const ADMIN_KEY_STORAGE = 'biph.adminKey';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/* ------------------------------------------------------------------ admin key */

export function getAdminKey(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setAdminKey(key: string | null): void {
  try {
    if (key) sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
    else sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    /* 隐私模式下 sessionStorage 可能不可用,忽略 */
  }
}

/* --------------------------------------------------------- 服务器时间偏移量 */

let serverOffsetMs = 0;
let serverOffsetKnown = false;

/** 收到一次可信的服务器时刻后更新偏移量 */
export function noteServerTs(serverTs: number): void {
  if (!Number.isFinite(serverTs) || serverTs <= 0) return;
  serverOffsetMs = serverTs - Date.now();
  serverOffsetKnown = true;
}

export function hasServerTime(): boolean {
  return serverOffsetKnown;
}

/** 本机估算的"当前服务器时间"(ms) */
export function estimatedServerNow(): number {
  return Date.now() + serverOffsetMs;
}

/* ------------------------------------------------------------------ 请求封装 */

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  /**
   * 管理员密钥头的优先级:【调用方显式传入的】> 【sessionStorage 里记住的】。
   *
   * 破坏性操作(重置/删除)的密钥是用户在弹窗里现输的 —— 那一刻 sessionStorage
   * 里可能还存着一个旧的、错的密钥(或者上一场用过的)。如果这里让它覆盖,
   * 用户明明输对了却还是 401。所以显式的头必须优先。
   */
  if (!headers.has('x-admin-key')) {
    const key = getAdminKey();
    if (key) headers.set('x-admin-key', key);
  }

  const method = (init.method ?? 'GET').toUpperCase();
  let body = init.body;
  if (body instanceof FormData) {
    /* 让浏览器自己带 multipart 的 boundary,不要手动设 content-type */
  } else if (body !== undefined && body !== null) {
    headers.set('content-type', 'application/json');
  } else if (method !== 'GET' && method !== 'HEAD') {
    // 浏览器 fetch 在没有 body 时不会发 Content-Type,
    // 服务端会判成 415。这里补一个空 JSON body。
    headers.set('content-type', 'application/json');
    body = '{}';
  }

  let res: Response;
  try {
    res = await fetch(path, { ...init, body, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiError(translate(getLocale(), 'error.network', { msg }), 0);
  }

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body?.error) message = body.error;
      else if (body?.message) message = body.message;
    } catch {
      /* 非 JSON 响应,保留状态码文本 */
    }
    // 服务端的错误文案是中文,这里按当前语言翻一遍;认不出来就原样返回
    throw new ApiError(translateServerError(getLocale(), message), res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ 类型 */

export type { HealthResponse };

export interface CreateMatchResponse {
  match: Match;
  controlToken: string;
  graphicsToken: string;
  controlUrl: string;
  displayUrl: string;
}

/**
 * 二维码接口返回值。
 *
 * `url` 是服务端按请求 Host 拼出来的权威链接:
 * - control:已带 operatorToken(`?t=…`),计分员扫码即可控制,不需要管理员密钥;
 * - display:公开只读,带 `?lang=` 语言参数。
 *
 * `token` 是 control 角色的控制令牌明文,给配置页保存本场参数用
 * (改配置不需要管理员密钥,控制令牌就够)。
 *
 * 注意:不能只取 `dataUrl`。dataUrl 只是二维码图片,
 * 链接文本必须用 `url`,否则在没创建过该比赛的设备上会拼出没有令牌的地址。
 */
export interface QrResponse {
  dataUrl: string;
  url: string;
  role: 'control' | 'display';
  token?: string;
}

export interface MatchLogsResponse {
  logs: { id: string; at: number; message: string }[];
}

/* ------------------------------------------------------------------ 接口 */

export async function getHealth(): Promise<HealthResponse> {
  const res = await request<HealthResponse>('/api/health');
  noteServerTs(res.serverTs);
  return res;
}

export async function listMatches(): Promise<MatchListResponse> {
  const res = await request<MatchListResponse>('/api/matches');
  noteServerTs(res.serverTs);
  return res;
}

export async function getMatch(id: string): Promise<MatchResponse> {
  const res = await request<MatchResponse>(`/api/matches/${encodeURIComponent(id)}`);
  noteServerTs(res.serverTs);
  return res;
}

/** 全部赛场的 WS 连接总数(健康检查里 wsClients 是按场映射) */
export function totalWsClients(health: Record<string, MatchHealth>): number {
  let n = 0;
  for (const h of Object.values(health)) n += h.clients ?? 0;
  return n;
}

export async function createMatch(payload: CreateMatchRequest): Promise<CreateMatchResponse> {
  return request<CreateMatchResponse>('/api/matches', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * 比赛配置补丁。
 *
 * rules / presentation 允许**只带一部分**:
 * 配置页的开关是"点一下就生效"的,必须能只发这一个字段 ——
 * 否则用户在队名框里敲到一半,一个开关就会把半截队名推到现场大屏。
 *
 * home / away 同理:上传 Logo 这种"一次性的完整动作"要能只发 logoUrl,
 * 不能顺带把用户正在输入的队名也推上去。
 */
export type MatchConfigPatch = Partial<Omit<Match, 'rules' | 'presentation' | 'home' | 'away'>> & {
  rules?: Partial<MatchRules>;
  presentation?: Partial<Presentation>;
  /** 队伍配置补丁:只带要改的那几个字段 */
  home?: Partial<Team>;
  away?: Partial<Team>;
};

/**
 * 改比赛配置。
 *
 * 两种凭证任选其一:
 * - 管理员密钥(赛事老师):存在 sessionStorage 时自动带上;
 * - 本场控制令牌(计分员手上就有):显式传入时带上 `x-control-token`。
 *
 * 控制令牌就够用了 —— 控制台本来就能通过 WS 改规则与显示设置,
 * 不该为了把进攻钟从 24 改成 20 还得去找管理员密钥。
 */
export async function patchMatch(
  id: string,
  patch: MatchConfigPatch,
  controlToken?: string | null,
): Promise<MatchResponse> {
  const headers: Record<string, string> = {};
  if (controlToken) headers['x-control-token'] = controlToken;
  return request<MatchResponse>(`/api/matches/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
}

/**
 * 删除比赛(破坏性操作)。
 *
 * 必须带管理员密钥:控制令牌只能控赛,删掉整场比赛超出了计分员的权限。
 * 密钥由调用方从弹窗里拿到 —— 这里显式放行,不去读 sessionStorage,
 * 免得"上次记住的旧密钥"顶掉用户刚输入的那一个。
 */
export async function deleteMatch(id: string, adminKey: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/matches/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': adminKey },
  });
}

/**
 * 重置比赛(破坏性操作)。
 *
 * 同 deleteMatch:必须显式带管理员密钥。
 */
export async function resetMatch(id: string, adminKey: string): Promise<MatchResponse> {
  return request<MatchResponse>(`/api/matches/${encodeURIComponent(id)}/reset`, {
    method: 'POST',
    headers: { 'x-admin-key': adminKey },
  });
}

export async function getQr(id: string, role: 'control' | 'display'): Promise<QrResponse> {
  return request<QrResponse>(`/api/matches/${encodeURIComponent(id)}/qr?role=${role}`);
}

export async function getLogs(id: string): Promise<MatchLogsResponse> {
  return request<MatchLogsResponse>(`/api/matches/${encodeURIComponent(id)}/logs`);
}

/* ------------------------------------------------------------ 场馆语言 */

/**
 * 读场馆语言(整个服务器一个)。
 *
 * 管理台(场地清单)没有"本场"概念,它的语言只能跟着场馆;
 * 控制台与大屏读的是"本场",但服务端保证两者永远一致。
 */
export async function getVenueLocale(): Promise<Locale | null> {
  const res = await request<{ locale: Locale | null }>('/api/locale');
  return res.locale ?? null;
}
/**
 * 写场馆语言。
 *
 * 服务端会把它镜像到每一场比赛并广播出去:
 * 所有大屏、所有控制台、管理台一起切,不会出现"这边中文那边英文"。
 */
export async function setVenueLocaleRemote(locale: Locale | null): Promise<Locale | null> {
  const res = await request<{ locale: Locale | null }>('/api/locale', {
    method: 'PUT',
    body: JSON.stringify({ locale }),
  });
  return res.locale ?? null;
}

export async function uploadLogo(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  return request<{ url: string }>('/api/uploads/logo', { method: 'POST', body: form });
}

/* ------------------------------------------------- 本地保存控制端令牌(按场) */

const TOKEN_STORAGE_PREFIX = 'biph.tokens.';

export interface StoredTokens {
  controlToken?: string;
  graphicsToken?: string;
  controlUrl?: string;
  displayUrl?: string;
}

export function readStoredTokens(matchId: string): StoredTokens {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_PREFIX + matchId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredTokens;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function writeStoredTokens(matchId: string, tokens: StoredTokens): void {
  try {
    const prev = readStoredTokens(matchId);
    localStorage.setItem(TOKEN_STORAGE_PREFIX + matchId, JSON.stringify({ ...prev, ...tokens }));
  } catch {
    /* 忽略 */
  }
}

/** 从一个可能带 token 的响应里提取并持久化 */
export function captureTokens(matchId: string, data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const d = data as Partial<CreateMatchResponse> & { match?: Match };
  const patch: StoredTokens = {};
  if (typeof d.controlToken === 'string') patch.controlToken = d.controlToken;
  if (typeof d.graphicsToken === 'string') patch.graphicsToken = d.graphicsToken;
  if (typeof d.controlUrl === 'string') patch.controlUrl = d.controlUrl;
  if (typeof d.displayUrl === 'string') patch.displayUrl = d.displayUrl;
  if (Object.keys(patch).length > 0) writeStoredTokens(matchId, patch);
}

/** 构造控制台链接(有令牌才带 t=) */
export function buildControlUrl(matchId: string, token?: string | null): string {
  const base = `${window.location.origin}/m/${encodeURIComponent(matchId)}/control`;
  return token ? `${base}?t=${encodeURIComponent(token)}` : base;
}

/**
 * 构造大屏链接。
 *
 * 带语言参数:二维码扫出来就是本场设置的语言,不用再手动切。
 */
export function buildDisplayUrl(matchId: string, locale?: Locale | null): string {
  const base = `${window.location.origin}/m/${encodeURIComponent(matchId)}/display`;
  return withLangParam(base, locale ?? null);
}

/** 配置页保存时用到的 presentation 片段 */
export type { Presentation };
