import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 定位前端构建产物目录。
 *
 * 这个路径不能用 path.resolve(相对路径) 一把梭 —— 那是相对【进程 CWD】解析的,
 * 而 CWD 在三种运行方式下各不相同:
 *
 *   开发   tsx src/index.ts        CWD = <repo>/server   产物在 <repo>/client/dist
 *   本地   node server/dist/...    CWD = 任意            产物在 <repo>/client/dist
 *   Docker WORKDIR=/app           CWD = /app            产物在 /app/client/dist
 *
 * 只要用错一个,容器里就会变成"前端尚未构建",页面全是 404。
 * 所以这里按候选列表逐个探测,取第一个真的带 index.html 的目录。
 */
function resolveClientDir(): string {
  const override = process.env.CLIENT_DIR;
  if (override) return path.resolve(override);

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // 编译产物: <repo>/server/dist -> <repo>/client/dist ; Docker: /app/server/dist -> /app/client/dist
    path.resolve(moduleDir, '../client/dist'),
    // 源码目录: <repo>/server/src -> <repo>/client/dist
    path.resolve(moduleDir, '../../client/dist'),
    // 以 CWD 为基准(Docker 的 WORKDIR=/app)
    path.resolve(process.cwd(), 'client/dist'),
    path.resolve(process.cwd(), '../client/dist'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  // 一个都没找到:返回最可能的那个,让报错信息指向正确的位置
  return candidates[0] ?? path.resolve(moduleDir, '../client/dist');
}

/** 读取环境变量,带默认值 */
function env(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

/**
 * 管理员密钥的默认值。
 *
 * 为什么写死成一个固定值:这个密钥防的是【误触】,不是黑客 ——
 * 校内封闭网络里,现场真正要挡的是"手滑把正在打的比赛删了"。
 * 随机密钥意味着每次部署都要有人先去服务器上把密钥捞出来、抄在本子上、
 * 贴在机房门上 —— 实际执行率接近零,闸门形同虚设,反而给人"有安全"的错觉。
 * 真要更严,启动时用 ADMIN_KEY 环境变量覆盖即可。
 */
export const DEFAULT_ADMIN_KEY = '1818';

export const config = {
  /** 监听端口 */
  port: envInt('PORT', 8080),
  /** 监听地址,默认 0.0.0.0 以便局域网访问 */
  host: env('HOST', '0.0.0.0'),

  /** 数据目录(SQLite / 上传 logo / 自签证书) */
  dataDir: path.resolve(env('DATA_DIR', './data')),

  /**
   * 管理员密钥。
   *
   * 默认就是 DEFAULT_ADMIN_KEY(写死),不再随机生成、也不再落盘成 ADMIN_KEY.txt ——
   * 密钥是公开的,落盘反而给人"它是个秘密"的错觉。
   */
  adminKey: env('ADMIN_KEY', DEFAULT_ADMIN_KEY),

  /** 是否启用 HTTPS(iPad 的 PWA / Wake Lock 需要安全上下文) */
  https: envBool('HTTPS', true),

  /** 自签证书的额外域名/IP(逗号分隔) */
  extraCertNames: env('CERT_NAMES', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** 心跳广播间隔(ms) */
  tickIntervalMs: envInt('TICK_INTERVAL_MS', 1000),

  /** 内部循环间隔(ms),用于零值检测 */
  loopIntervalMs: envInt('LOOP_INTERVAL_MS', 200),

  /** 撤销栈深度 */
  undoDepth: envInt('UNDO_DEPTH', 20),

  /** 客户端静态资源目录(自动探测,也可用 CLIENT_DIR 显式指定) */
  clientDir: resolveClientDir(),

  version: '0.1.0',
} as const;

export const paths = {
  db: path.join(config.dataDir, 'scoreboard.db'),
  uploads: path.join(config.dataDir, 'uploads'),
  cert: path.join(config.dataDir, 'cert'),
};
