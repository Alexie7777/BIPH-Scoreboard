import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { parseRole } from '@biph/shared';
import { config, paths } from './config.js';
import { Store } from './db.js';
import { Hub } from './hub.js';
import { registerRoutes, registerSpa } from './routes.js';
import { ensureCert, lanAddresses } from './certs.js';
import { serverNow } from './clock.js';

// node:sqlite 目前仍带 ExperimentalWarning,滤掉以免干扰日志
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning') return;
  console.warn(w);
});

async function main(): Promise<void> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(paths.uploads, { recursive: true });

  /* ------------------------- 管理员密钥 ------------------------- */
  const store = new Store(paths.db);
  /*
   * 密钥默认写死成 1818(见 config.DEFAULT_ADMIN_KEY):
   * 它防的是"手滑把正在打的比赛删了",不是外部攻击 ——
   * 随机密钥要专门有人去服务器上捞、抄下来、记住,现场几乎做不到,闸门等于没有。
   * 想更严就启动时用 ADMIN_KEY 环境变量覆盖。
   */
  const adminKey = config.adminKey;

  /* ------------------------- HTTP / WS ------------------------- */
  // TLS 必须在创建实例前准备好:https 是实例级选项,不是 listen 级选项
  const tls = config.https ? ensureCert(config.extraCertNames) : null;

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: undefined,
    },
    bodyLimit: 4 * 1024 * 1024,
    ...(tls ? { https: tls } : {}),
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });

  // 浏览器 fetch 在没有 body 时不会带 Content-Type,
  // Fastify 默认会因此报 415。这里放宽:空 body 一律当成 {}。
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(null, {});
    }
  });

  if (fs.existsSync(config.clientDir)) {
    await app.register(fastifyStatic, { root: config.clientDir, prefix: '/' });
  }

  // 上传的队徽 / 队标,独立挂载(不依赖前端是否已构建)
  await app.register(fastifyStatic, {
    root: paths.uploads,
    prefix: '/uploads/',
    decorateReply: false,
    cacheControl: true,
    maxAge: 86400,
  });

  const hub = new Hub(store);
  hub.load();
  hub.start();

  registerRoutes(app, { hub, store, adminKey });

  /* ------------------------- WS 频道 ------------------------- */
  app.get<{ Params: { matchId: string } }>(
    '/ws/:matchId',
    {
      websocket: true,
      // 在 HTTP 升级阶段就校验令牌:无效令牌拿不到 101 握手,直接 401
      preValidation: async (req, reply) => {
        const q = req.query as Record<string, string | undefined>;
        const role = parseRole(q.role);
        if (role === 'display') return; // 显示端公开只读
        const tokens = hub.tokensOf(req.params.matchId);
        if (!tokens) {
          reply.code(404).send({ error: '比赛不存在' });
          return;
        }
        const ok =
          role === 'control'
            ? q.t === tokens.operatorToken
            : q.t === tokens.graphicsToken || q.t === tokens.operatorToken;
        if (!ok) reply.code(401).send({ error: '令牌无效' });
      },
    },
    (socket, req) => {
      const matchId = req.params.matchId;
      const q = req.query as Record<string, string | undefined>;
      const role = parseRole(q.role);
      const token = q.t ?? null;

      const conn = hub.addConn(socket as never, matchId, role, token);
      if (!conn) {
        (socket as never as { close(code: number, reason: string): void }).close(
          4001,
          'unauthorized',
        );
        return;
      }
      socket.on('message', (data: Buffer) => {
        hub.handleMessage(conn, data.toString());
      });
      socket.on('close', () => hub.removeConn(conn));
      socket.on('error', () => hub.removeConn(conn));
    },
  );

  registerSpa(app);

  /* ------------------------- 启动 ------------------------- */
  const ips = lanAddresses();
  const proto = tls ? 'https' : 'http';

  const start = await app.listen({ port: config.port, host: config.host });

  const shown = ips.length ? ips : ['127.0.0.1'];
  app.log.info('──────────────────────────────────────────────');
  app.log.info(` BIPH 场地管理台 已启动  ${proto}://${shown[0]}:${config.port}`);
  for (const ip of shown) app.log.info(`   ${proto}://${ip}:${config.port}`);
  app.log.info(`   管理员密钥: ${process.env.ADMIN_KEY ? '(来自 ADMIN_KEY 环境变量)' : '(默认值)'}`);
  app.log.info(`   数据目录: ${config.dataDir}`);

  // 证书的坑:Docker 里 os.networkInterfaces() 只能看到【容器】自己的网卡,
  // 所以自签证书的 SAN 里是 172.x,没有宿主机的 IP。浏览器会报"证书名称不匹配",
  // 页面可以点"继续前往"硬过,但 WebSocket 同样被拦死 —— 控制台会一直连不上。
  if (tls && config.extraCertNames.length === 0) {
    app.log.info('──────────────────────────────────────────────');
    app.log.info(' 提示:证书只包含本机网卡地址。');
    app.log.info('       如果你在 Docker 里跑,上面那些 IP 是【容器】的(172.x),');
    app.log.info('       宿主机 IP 不在里面 —— 浏览器会报"证书名称不匹配",');
    app.log.info('       而且 WebSocket 会被直接拦死(控制台连不上)。');
    app.log.info('       请在 docker-compose.yml 里设 CERT_NAMES: "<宿主机IP>",');
    app.log.info('       然后删掉 /data/cert/ 下的旧证书再重启,让它重新签。');
  }
  app.log.info('──────────────────────────────────────────────');

  const shutdown = async (): Promise<void> => {
    hub.stop();
    store.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // 兜底:定期 ping,清理僵死连接
  const keepAlive = setInterval(() => {
    for (const conn of (hub as unknown as { conns: Map<string, { ws: { readyState: number; terminate(): void } }> }).conns.values()) {
      if (conn.ws.readyState !== 1) conn.ws.terminate();
    }
  }, 30_000);
  keepAlive.unref?.();
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});

export { serverNow, path };
