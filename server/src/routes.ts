import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import {
  isLocale,
  isValidStartTime,
  parseRole,
  type CreateMatchRequest,
  type Locale,
  type Match,
  type Role,
  type Team,
} from '@biph/shared';
import { config, paths } from './config.js';
import { serverNow } from './clock.js';
import { mergeTeamConfig } from './match.js';
import type { Hub } from './hub.js';
import type { Store } from './db.js';

export interface RouteDeps {
  hub: Hub;
  store: Store;
  adminKey: string;
}

/** 拼接当前服务在局域网里可访问的基址 */
function baseUrl(req: FastifyRequest): string {
  const host = (req.headers.host as string) ?? `localhost:${config.port}`;
  const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol ?? 'http';
  return `${proto}://${host}`;
}

function isAdmin(req: FastifyRequest, adminKey: string): boolean {
  if (!adminKey) return true;
  const header = req.headers['x-admin-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value && value === adminKey) return true;
  const q = (req.query as Record<string, string | undefined>)?.k;
  return !!q && q === adminKey;
}

function unauthorized(reply: FastifyReply, msg = '需要管理员密钥'): void {
  reply.code(401).send({ error: msg });
}

/**
 * 给链接补上语言参数(?lang=zh|en)。
 *
 * 大屏二维码是给投影/LED 设备扫的,扫出来就该是本场设置的语言,
 * 不然现场还要再手动切一次。
 */
function withLang(url: string, locale: string | null | undefined): string {
  if (locale !== 'zh-CN' && locale !== 'en-US') return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}lang=${locale === 'en-US' ? 'en' : 'zh'}`;
}

/**
 * 配置补丁。
 *
 * rules / presentation / home / away 允许**只带一部分** —— 配置页的开关是"点一下就生效"的,
 * 必须能只发这一个字段,否则用户在队名框里敲到一半,一个开关就会把半截队名推到现场大屏。
 * 队伍字段由 mergeTeamConfig 合并(比分/犯规/暂停一律不许带)。
 */
type ConfigPatch = Partial<Omit<Match, 'rules' | 'presentation' | 'home' | 'away'>> & {
  rules?: Partial<Match['rules']>;
  presentation?: Partial<Match['presentation']>;
  home?: Partial<Team>;
  away?: Partial<Team>;
};

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { hub, store, adminKey } = deps;

  /**
   * 请求是否带着本场的【控制令牌】。
   *
   * 控制令牌是计分员手上就有的东西(扫二维码就有),而且它本来就能通过
   * WS 的 `match.update` 改规则与显示设置 —— 所以"改本场参数"这件事
   * 要管理员密钥才能做,逻辑上是不自洽的:现场为了把进攻钟从 24 改成 20,
   * 不应该还要跑去找管理员密钥。这里把同一条路补到 REST 上。
   *
   * 真正需要管理员密钥的只有破坏性操作:重置比赛、删除比赛。
   */
  const hasControlToken = (req: FastifyRequest, matchId: string): boolean => {
    const tokens = hub.tokensOf(matchId);
    if (!tokens) return false;
    const header = req.headers['x-control-token'];
    const value = Array.isArray(header) ? header[0] : header;
    if (value && value === tokens.operatorToken) return true;
    const q = (req.query as Record<string, string | undefined>)?.t;
    return !!q && q === tokens.operatorToken;
  };

  /* ------------------------------ 健康 ------------------------------ */

  app.get('/api/health', async () => ({
    ok: true,
    version: config.version,
    uptimeMs: Math.round(process.uptime() * 1000),
    serverTs: serverNow(),
    dbWritable: true,
    wsClients: hub.health(),
  }));

  /* ------------------------------ 场馆语言 ------------------------------ */
  /*
   * 语言是"整个场馆一个",所以单独开一对接口:
   *   - 管理台(场地清单)没有"本场"概念,它的语言跟着场馆走;
   *   - 任何一处改语言(管理台/控制台/配置页/大屏角落)都写到这里,
   *     服务端再镜像到每一场比赛 —— 于是大屏、控制台、管理台永远是同一个语言。
   *
   * 读取不做鉴权(公开信息);写入也不做鉴权:
   * 它只改界面语言,不是破坏性操作,校内封闭网络里不值得为它卡住现场。
   */

  app.get('/api/locale', async () => ({ locale: hub.getVenueLocale() }));

  app.put<{ Body: { locale?: unknown } }>('/api/locale', async (req, reply) => {
    const raw = (req.body ?? {}).locale;
    if (raw !== null && raw !== undefined && !isLocale(raw)) {
      return reply.code(400).send({ error: '语言只能是 zh-CN 或 en-US' });
    }
    // null = 复位成默认语言(场馆语言必须是具体的,不能"各看各的")
    const locale = hub.setVenueLocale(raw === null || raw === undefined ? null : (raw as Locale));
    return { locale };
  });

  /* ------------------------------ 比赛列表 ------------------------------ */

  app.get('/api/matches', async () => ({
    matches: hub.listMatches(),
    health: hub.health(),
    serverTs: serverNow(),
  }));

  app.get<{ Params: { id: string } }>('/api/matches/:id', async (req, reply) => {
    const match = hub.getMatch(req.params.id);
    if (!match) return reply.code(404).send({ error: '比赛不存在' });
    const body: { match: Match; serverTs: number; links?: unknown } = { match, serverTs: serverNow() };
    if (isAdmin(req, adminKey)) {
      const t = hub.tokensOf(match.id);
      if (t) {
        const base = baseUrl(req);
        body.links = {
          controlUrl: `${base}/m/${match.id}/control?t=${t.operatorToken}`,
          displayUrl: withLang(`${base}/m/${match.id}/display`, match.presentation.locale),
          operatorToken: t.operatorToken,
          graphicsToken: t.graphicsToken,
        };
      }
    }
    return body;
  });

  /* ------------------------------ 创建比赛 ------------------------------ */
  // 创建不做鉴权:这是校内封闭网络里的开赛流程,任何人都可能需要临时开一场。
  // 令牌由服务端随机生成,拿到链接才能控制;破坏性操作(改配置/重置/删除)仍需管理员密钥。

  app.post<{ Body: CreateMatchRequest }>('/api/matches', async (req, reply) => {
    const created = hub.createMatch(req.body ?? {});
    const base = baseUrl(req);
    return reply.code(201).send({
      match: created.match,
      operatorToken: created.operatorToken,
      graphicsToken: created.graphicsToken,
      controlUrl: `${base}/m/${created.match.id}/control?t=${created.operatorToken}`,
      displayUrl: withLang(`${base}/m/${created.match.id}/display`, created.match.presentation.locale),
    });
  });

  app.patch<{ Params: { id: string }; Body: ConfigPatch }>(
    '/api/matches/:id',
    async (req, reply) => {
      const current = hub.getMatch(req.params.id);
      if (!current) return reply.code(404).send({ error: '比赛不存在' });
      // 改配置:管理员密钥或本场控制令牌,二者有其一即可
      if (!isAdmin(req, adminKey) && !hasControlToken(req, req.params.id)) {
        return unauthorized(reply);
      }
      const patch = req.body ?? {};
      // 计划开赛时间只认 "HH:MM":脏数据会让大屏算出一个莫名其妙的倒计时,宁可当场拒掉
      if (patch.startTime !== undefined && patch.startTime !== null && !isValidStartTime(patch.startTime)) {
        return reply.code(400).send({ error: '开赛时间格式应为 HH:MM' });
      }
      const next: Match = {
        ...current,
        ...patch,
        // 队伍只允许改配置字段(队名/队色/logo),
        // 比分与犯规暂停必须走命令通道,否则锚点语义与撤销栈会全部对不上
        home: mergeTeamConfig(current.home, patch.home ?? {}),
        away: mergeTeamConfig(current.away, patch.away ?? {}),
        rules: { ...current.rules, ...(patch.rules ?? {}) },
        presentation: { ...current.presentation, ...(patch.presentation ?? {}) },
        // 运动项目只认已登记的值,其余一律沿用当前值
        sport: patch.sport === 'basketball' ? 'basketball' : current.sport,
        // 计划开赛时间:null = 清空(不显示开赛倒计时);字符串 = 覆盖;没给这个字段 = 保持原值
        startTime:
          patch.startTime === null
            ? null
            : typeof patch.startTime === 'string'
              ? patch.startTime.trim()
              : current.startTime ?? null,
        // 时钟与比分必须走命令通道(保证锚点语义正确),这里一律沿用当前值
        id: current.id,
        clock: current.clock,
        shotClock: current.shotClock,
        // 暂停倒计时同样只认命令通道(timeout.request / timeout.end)
        timeout: current.timeout,
        possession: current.possession,
        status: current.status,
        seq: current.seq,
        createdAt: current.createdAt,
        updatedAt: serverNow(),
      };
      hub.replaceMatch(next);
      const t = hub.tokensOf(req.params.id);
      const base = baseUrl(req);
      return {
        match: hub.getMatch(req.params.id),
        operatorToken: t?.operatorToken,
        graphicsToken: t?.graphicsToken,
        controlUrl: t ? `${base}/m/${req.params.id}/control?t=${t.operatorToken}` : undefined,
        displayUrl: withLang(`${base}/m/${req.params.id}/display`, hub.getMatch(req.params.id)?.presentation.locale),
      };
    },
  );

  app.post<{ Params: { id: string } }>('/api/matches/:id/reset', async (req, reply) => {
    if (!isAdmin(req, adminKey)) return unauthorized(reply);
    const match = hub.resetMatch(req.params.id);
    if (!match) return reply.code(404).send({ error: '比赛不存在' });
    return { match };
  });

  app.delete<{ Params: { id: string } }>('/api/matches/:id', async (req, reply) => {
    if (!isAdmin(req, adminKey)) return unauthorized(reply);
    const ok = hub.deleteMatch(req.params.id);
    if (!ok) return reply.code(404).send({ error: '比赛不存在' });
    return { ok: true };
  });

  /* ------------------------------ 二维码 ------------------------------ */

  app.get<{ Params: { id: string }; Querystring: { role?: string } }>(
    '/api/matches/:id/qr',
    async (req, reply) => {
      const match = hub.getMatch(req.params.id);
      if (!match) return reply.code(404).send({ error: '比赛不存在' });
      const role = parseRole(req.query.role);
      const t = hub.tokensOf(match.id);
      if (!t) return reply.code(404).send({ error: '比赛不存在' });

      const base = baseUrl(req);
      // 控制台链接必须带 operatorToken(否则计分员扫码后连不上),
      // 语言参数对本场设置,让扫码即是对的语言。
      const url =
        role === 'display'
          ? withLang(`${base}/m/${match.id}/display`, match.presentation.locale)
          : withLang(`${base}/m/${match.id}/control?t=${t.operatorToken}`, match.presentation.locale);
      const dataUrl = await QRCode.toDataURL(url, { width: 512, margin: 1 });
      // 顺带把控制令牌明文给出:配置页要靠它保存本场参数(改配置不需要管理员密钥)
      return { dataUrl, url, role, token: role === 'control' ? t.operatorToken : undefined };
    },
  );

  /* ------------------------------ 日志 ------------------------------ */

  app.get<{ Params: { id: string } }>('/api/matches/:id/logs', async (req, reply) => {
    const match = hub.getMatch(req.params.id);
    if (!match) return reply.code(404).send({ error: '比赛不存在' });
    const logs = store.listLogs(req.params.id, 100).map((l) => ({
      id: l.id,
      at: l.at,
      message: l.message,
    }));
    return { logs };
  });

  /* ------------------------------ Logo 上传 ------------------------------ */
  // 同时支持 multipart(form-data,字段名 file)与 base64 JSON 两种方式

  app.post('/api/uploads/logo', async (req, reply) => {
    fs.mkdirSync(paths.uploads, { recursive: true });

    const save = (buf: Buffer, ext: string): string => {
      const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      fs.writeFileSync(path.join(paths.uploads, name), buf);
      return `/uploads/${name}`;
    };

    // multipart 分支
    if (req.isMultipart()) {
      const file = await (req as unknown as { file(): Promise<{ filename: string; toBuffer(): Promise<Buffer> } | undefined> }).file();
      if (!file) return reply.code(400).send({ error: '缺少文件' });
      const buf = await file.toBuffer();
      if (buf.byteLength > 2 * 1024 * 1024) return reply.code(413).send({ error: '图片不能超过 2MB' });
      const ext = (path.extname(file.filename || '').replace('.', '').toLowerCase()) || 'png';
      const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'png';
      return { url: save(buf, safeExt) };
    }

    // base64 JSON 分支
    const body = req.body as { dataUrl?: string } | undefined;
    if (!body?.dataUrl) return reply.code(400).send({ error: '缺少文件' });
    const m = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,(.+)$/i.exec(body.dataUrl);
    if (!m) return reply.code(400).send({ error: '仅支持 base64 图片' });
    const ext = m[1]!.toLowerCase() === 'svg+xml' ? 'svg' : m[1]!.split('+')[0]!.replace('jpeg', 'jpg');
    const buf = Buffer.from(m[2]!, 'base64');
    if (buf.byteLength > 2 * 1024 * 1024) return reply.code(413).send({ error: '图片不能超过 2MB' });
    return { url: save(buf, ext) };
  });

  /* ------------------------------ 静态资源 ------------------------------ */
  // 上传的 Logo 由 index.ts 用独立的 fastify-static 实例挂载到 /uploads
}

/** SPA 兜底:非 /api /ws 的路径一律返回 index.html */
export function registerSpa(app: FastifyInstance): void {
  const indexFile = path.join(config.clientDir, 'index.html');
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'not found' });
    }
    if (!fs.existsSync(indexFile)) {
      return reply.code(404).type('text/plain; charset=utf-8').send(
        '前端尚未构建。请先执行 npm run build:client,或在开发模式访问 Vite 端口 5173。',
      );
    }
    return reply.type('text/html; charset=utf-8').send(fs.createReadStream(indexFile));
  });
}

export type { Role };
