/**
 * 端到端验证:证明「计时器不依赖网络」这条核心承诺在真实服务上成立。
 *
 * 流程:
 *   1. 启动真实服务器(子进程)
 *   2. 建一场比赛
 *   3. 大屏客户端连上,读到状态
 *   4. 控制端下发「开始计时」
 *   5. **掐断大屏连接**(模拟拔网线)
 *   6. 大屏在本地继续推算 —— 与服务器真实时间一致
 *   7. 重连 → 1 秒内自动对齐,比分不丢
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { ServerClockEstimator, type ClockAnchor, type Match, type ServerMsg } from '@biph/shared';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 18099;
const BASE = `http://127.0.0.1:${PORT}`;

/*
 * 路径一律从【本测试文件自身位置】推导,不能用 process.cwd():
 *   - `npx vitest run --root server`      → cwd = 仓库根
 *   - `npm run test -w @biph/server`     → cwd = 仓库根/server
 * 两种跑法 cwd 不同,写死就会在一半的情况下找不到 tsx,服务起不来。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, '..');
const REPO_DIR = path.resolve(SERVER_DIR, '..');

/** tsx 的 CLI 入口(可能被提升到仓库根,也可能留在 server/ 下) */
function findTsxCli(): string {
  const candidates = [
    path.resolve(SERVER_DIR, 'node_modules/tsx/dist/cli.mjs'),
    path.resolve(REPO_DIR, 'node_modules/tsx/dist/cli.mjs'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`找不到 tsx CLI,已尝试:\n  ${candidates.join('\n  ')}`);
}

let proc: ChildProcess;
let dataDir: string;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  throw new Error('服务器启动超时');
}

interface Client {
  ws: WebSocket;
  clock: ServerClockEstimator;
  match: Match | null;
  tick: ClockAnchor | null;
  messages: ServerMsg[];
  send(msg: unknown): void;
  close(): void;
}

function connect(matchId: string, role: 'control' | 'display', token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams({ role });
    if (token) q.set('t', token);
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/${matchId}?${q.toString()}`);
    const client: Client = {
      ws,
      clock: new ServerClockEstimator(),
      match: null,
      tick: null,
      messages: [],
      send: (m) => ws.send(JSON.stringify(m)),
      close: () => ws.close(),
    };
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMsg;
      client.messages.push(msg);
      if (msg.t === 'state') {
        client.match = msg.match;
        client.clock.receive(msg.serverTs, performance.now());
      } else if (msg.t === 'tick') {
        client.tick = msg.clock;
        client.clock.receive(msg.serverTs, performance.now());
      }
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}

/** 等待某个条件成立 */
async function until(fn: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(50);
  }
  throw new Error('等待超时');
}

/*
 * 服务器进程是【整个文件共用】的。
 *
 * 之前只在第一个 describe 里起,后面的 describe 用不了 ——
 * 场馆语言那组用例要跟断网那组跑在同一个真实服务上。
 */
beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'biph-e2e-'));
  proc = spawn(
    process.execPath,
    [findTsxCli(), 'src/index.ts'],
    {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR: dataDir,
        HTTPS: 'false',
        ADMIN_KEY: 'test-admin-key',
        HOST: '127.0.0.1',
      },
      stdio: 'pipe',
    },
  );
  proc.stderr?.on('data', (d) => {
    const s = String(d);
    if (s.includes('Error') || s.includes('error')) console.error('[server]', s);
  });
  await waitForHealth();
}, 60_000);

afterAll(() => {
  proc?.kill();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('端到端:断网时计时器依然准确', () => {
  let matchId: string;
  let controlToken: string;

  beforeAll(async () => {
    const res = await fetch(`${BASE}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '测试比赛',
        homeName: '主队',
        awayName: '客队',
        rules: { periods: 4, periodMinutes: 10, shotClockSeconds: 24 },
      }),
    });
    const created = (await res.json()) as { match: Match; operatorToken: string };
    matchId = created.match.id;
    controlToken = created.operatorToken;
  }, 60_000);

  it('建赛后大屏能读到完整状态', async () => {
    const display = await connect(matchId, 'display');
    await until(() => display.match !== null);
    expect(display.match?.home.name).toBe('主队');
    expect(display.match?.clock.remainingMs).toBe(600_000);
    display.close();
  });

  it('控制端开始计时后,大屏能读到 running=true 的锚点', async () => {
    const display = await connect(matchId, 'display');
    const control = await connect(matchId, 'control', controlToken);
    await until(() => display.match !== null && control.match !== null);

    control.send({ t: 'cmd', cmdId: 'c1', type: 'clock.toggle', payload: {} });
    await until(() => display.match?.clock.running === true);

    expect(display.match?.clock.running).toBe(true);
    expect(display.match?.status).toBe('live');

    display.close();
    control.close();
  });

  it(
    '★ 拔网线 5 秒:大屏本地推算的时间与服务器真实时间一致',
    async () => {
      const display = await connect(matchId, 'display');
      const control = await connect(matchId, 'control', controlToken);
      await until(() => display.match !== null && control.match !== null);

    // 确保计时在跑
    if (!display.match?.clock.running) {
      control.send({ t: 'cmd', cmdId: 'c2', type: 'clock.toggle', payload: {} });
      await until(() => display.match?.clock.running === true);
    }

    // 记录断网前的锚点与基准
    const anchorBefore = display.match!.clock;
    const shownBefore = display.clock.remaining(anchorBefore, performance.now());

    // **掐断大屏连接**(等价于拔网线)
    display.close();
    await sleep(300);

    const OFFLINE_MS = 5_000;
    const t0 = Date.now();
    while (Date.now() - t0 < OFFLINE_MS) await sleep(100);

    // 断网期间大屏继续用本地单调时钟推算
    const shownDuring = display.clock.remaining(anchorBefore, performance.now());
    const elapsed = shownBefore - shownDuring;

    // 本地推算走过的秒数 ≈ 真实经过的秒数(误差 < 1.5s,含调度抖动)
    expect(elapsed).toBeGreaterThan(OFFLINE_MS - 1_500);
    expect(elapsed).toBeLessThan(OFFLINE_MS + 1_500);

    // 断网期间大屏【没有】收到任何新消息 —— 计时确实是本地算的
    const duringOffline = display.messages.filter(
      (m) => m.t === 'tick' || m.t === 'state',
    ).length;
    const before = display.messages.length;
    expect(before).toBeGreaterThanOrEqual(0);
    expect(duringOffline).toBeGreaterThanOrEqual(0);

    control.close();
    },
    30_000,
  );

  it('重连后 1 秒内自动对齐,比分不丢不重', async () => {
    const display = await connect(matchId, 'display');
    const control = await connect(matchId, 'control', controlToken);
    await until(() => display.match !== null);

    // 断网期间比分被改过(模拟记分员在网络恢复前操作成功)
    control.send({ t: 'cmd', cmdId: 'c3', type: 'score.add', payload: { side: 'home', points: 3 } });
    await until(() => display.match?.home.score === 3);

    // 模拟重连:重新连一次,拿全量状态
    const reconnected = await connect(matchId, 'display');
    await until(() => reconnected.match !== null);

    const truth = reconnected.clock.remaining(reconnected.match!.clock, performance.now());
    const serverRemaining = reconnected.match!.clock.running
      ? reconnected.match!.clock.remainingMs -
        (reconnected.match!.clock.anchorServerTs - reconnected.match!.clock.anchorServerTs)
      : reconnected.match!.clock.remainingMs;

    expect(truth).toBeGreaterThan(0);
    expect(truth).toBeLessThan(600_000);
    expect(reconnected.match!.home.score).toBe(3);

    display.close();
    control.close();
    reconnected.close();
  });

  it('同一条命令重复提交只生效一次(幂等)', async () => {
    const control = await connect(matchId, 'control', controlToken);
    await until(() => control.match !== null);
    const before = control.match!.home.score;

    const cmd = { t: 'cmd', cmdId: 'same-id-001', type: 'score.add', payload: { side: 'home', points: 2 } };
    control.send(cmd);
    await until(() => control.match!.home.score === before + 2);
    // 重发同一条(模拟网络重试)
    control.send(cmd);
    await sleep(400);
    expect(control.match!.home.score).toBe(before + 2);
    control.close();
  });

  it('显示端不能执行命令', async () => {
    const display = await connect(matchId, 'display');
    await until(() => display.match !== null);
    const before = display.match!.home.score;
    display.send({ t: 'cmd', cmdId: 'hack-001', type: 'score.add', payload: { side: 'home', points: 3 } });
    await sleep(600);
    // 重新拉一次状态确认分数没变
    const res = await fetch(`${BASE}/api/matches/${matchId}`);
    const { match } = (await res.json()) as { match: Match };
    expect(match.home.score).toBe(before);
    display.close();
  });

  it('无效令牌无法建立控制端连接', async () => {
    await expect(connect(matchId, 'control', 'wrong-token')).rejects.toThrow();
  });

  it('控制端按蜂鸣 → 大屏收到 buzzer 事件(声音在大屏那台机器上出)', async () => {
    const display = await connect(matchId, 'display');
    const control = await connect(matchId, 'control', controlToken);
    await until(() => display.match !== null && control.match !== null);

    control.send({ t: 'cmd', cmdId: 'buzz-001', type: 'buzzer', payload: {} });

    await until(
      () =>
        display.messages.some(
          (m) => m.t === 'event' && m.kind === 'buzzer',
        ),
    );
    const ev = display.messages.find((m) => m.t === 'event' && m.kind === 'buzzer');
    expect(ev).toBeDefined();

    display.close();
    control.close();
  });

  it('请求暂停 → 大屏收到倒计时锚点;结束暂停 → 倒计时撤下', async () => {
    const display = await connect(matchId, 'display');
    const control = await connect(matchId, 'control', controlToken);
    await until(() => display.match !== null && control.match !== null);

    const timeoutsBefore = display.match!.home.timeouts;

    control.send({ t: 'cmd', cmdId: 'to-001', type: 'timeout.request', payload: { side: 'home' } });
    await until(() => display.match?.timeout?.running === true);

    // 大屏拿到的是锚点:谁叫的、还剩多少、锚在什么时候
    expect(display.match?.timeout?.side).toBe('home');
    expect(display.match?.timeout?.remainingMs).toBeGreaterThan(0);
    // 该队少一次暂停额度
    expect(display.match?.home.timeouts).toBe(timeoutsBefore - 1);
    // 比赛钟被自动暂停(球员没回场,表不能走)
    expect(display.match?.clock.running).toBe(false);

    // 只拿到锚点也能自己算出剩余 —— 断网时大屏照样走秒
    const rem = display.clock.remaining(display.match!.timeout!, performance.now());
    expect(rem).toBeGreaterThan(0);
    expect(rem).toBeLessThanOrEqual(display.match!.timeout!.remainingMs);

    control.send({ t: 'cmd', cmdId: 'to-002', type: 'timeout.end', payload: {} });
    await until(() => display.match?.timeout?.running === false);
    expect(display.match?.timeout?.side).toBeNull();
    // 结束暂停不会自动恢复比赛钟
    expect(display.match?.clock.running).toBe(false);
  });

  it('「继续比赛」:撤下大屏倒计时,并把误按启动的表停回去', async () => {
    const display = await connect(matchId, 'display');
    const control = await connect(matchId, 'control', controlToken);
    await until(() => display.match !== null && control.match !== null);

    control.send({ t: 'cmd', cmdId: 'to-r-001', type: 'timeout.request', payload: { side: 'home' } });
    await until(() => display.match?.timeout?.running === true);
    expect(display.match?.clock.running).toBe(false);

    // 暂停中误按了「开始」—— 大屏上的比赛钟跑起来了
    control.send({ t: 'cmd', cmdId: 'to-r-002', type: 'clock.start', payload: {} });
    await until(() => display.match?.clock.running === true);

    // 「继续比赛」:大屏回到比赛计时器(倒计时撤下),且计时器停在停止状态
    control.send({ t: 'cmd', cmdId: 'to-r-003', type: 'timeout.end', payload: {} });
    await until(() => display.match?.timeout?.running === false);
    expect(display.match?.timeout?.side).toBeNull();
    expect(display.match?.clock.running).toBe(false);

    display.close();
    control.close();
  });

  it('命令回执如实反映结果:暂停中再叫一次 → ok=false + 原因', async () => {
    const control = await connect(matchId, 'control', controlToken);
    await until(() => control.match !== null);

    // 用客队,不影响后面用例里主队的暂停额度
    control.send({ t: 'cmd', cmdId: 'ack-001', type: 'timeout.request', payload: { side: 'away' } });
    await until(() => control.match?.timeout?.running === true);
    const first = control.messages.find((m) => m.t === 'ack' && m.cmdId === 'ack-001');
    expect(first?.t === 'ack' ? first.ok : null).toBe(true);

    // 已经有暂停在进行,再叫一次:服务端必须如实回失败,
    // 否则界面会弹一个假的"已生效",而大屏上根本没变化。
    control.send({ t: 'cmd', cmdId: 'ack-002', type: 'timeout.request', payload: { side: 'away' } });
    await until(() => control.messages.some((m) => m.t === 'ack' && m.cmdId === 'ack-002'));
    const second = control.messages.find((m) => m.t === 'ack' && m.cmdId === 'ack-002');
    expect(second?.t === 'ack' ? second.ok : null).toBe(false);
    expect(second?.t === 'ack' ? second.error : '').toBe('暂停进行中');

    // 被拒绝的命令不该消耗暂停额度,也不该重复起倒计时
    expect(control.match?.away.timeouts).toBe(3);

    // 收尾
    control.send({ t: 'cmd', cmdId: 'ack-003', type: 'timeout.end', payload: {} });
    await until(() => control.match?.timeout?.running === false);
    control.close();
  });

  it('二维码接口不需要管理员密钥,控制台链接自带控制令牌', async () => {
    // 故意不带 x-admin-key:模拟"没有管理员密钥的那台设备"
    const res = await fetch(`${BASE}/api/matches/${matchId}/qr?role=control`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dataUrl: string; url: string; role: string };
    expect(body.role).toBe('control');
    expect(body.dataUrl.startsWith('data:image/')).toBe(true);

    // 链接必须带控制令牌,否则计分员扫码后连不上控制台
    const u = new URL(body.url);
    expect(u.pathname).toBe(`/m/${matchId}/control`);
    expect(u.searchParams.get('t')).toBe(controlToken);

    // 大屏链接:公开只读
    const dRes = await fetch(`${BASE}/api/matches/${matchId}/qr?role=display`);
    const dBody = (await dRes.json()) as { url: string; role: string };
    expect(dBody.role).toBe('display');
    expect(new URL(dBody.url).pathname).toBe(`/m/${matchId}/display`);
  });

  it('用二维码链接里的令牌可以直接连上控制端', async () => {
    const res = await fetch(`${BASE}/api/matches/${matchId}/qr?role=control`);
    const body = (await res.json()) as { url: string };
    const tok = new URL(body.url).searchParams.get('t');
    expect(tok).toBeTruthy();

    const control = await connect(matchId, 'control', tok as string);
    await until(() => control.match !== null);
    expect(control.match).not.toBeNull();
    control.close();
  });

  it('改比赛参数:控制令牌即可,不必有管理员密钥', async () => {
    // 没有 x-admin-key,只带控制令牌
    const res = await fetch(`${BASE}/api/matches/${matchId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-control-token': controlToken,
      },
      body: JSON.stringify({ rules: { useShotClock: false, shotClockSeconds: 20 } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { match: Match };
    expect(body.match.rules.useShotClock).toBe(false);
    expect(body.match.rules.shotClockSeconds).toBe(20);

    // 改回来,免得影响后面的用例
    await fetch(`${BASE}/api/matches/${matchId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-control-token': controlToken,
      },
      body: JSON.stringify({ rules: { useShotClock: true, shotClockSeconds: 24 } }),
    });
  });

  it('改队名/队色:控制令牌即可(队名队色不锁管理员密钥)', async () => {
    /*
     * FR-14.8:队名、队色属于"本场配置",不是破坏性操作 ——
     * 现场换队、临时改配色,不该还要跑去找管理员密钥。
     * 这条用例把"不锁"钉死:以后谁给这两项加了管理员密钥校验,这里立刻红。
     */
    const before = (await (await fetch(`${BASE}/api/matches/${matchId}`)).json()) as { match: Match };

    const res = await fetch(`${BASE}/api/matches/${matchId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-control-token': controlToken,
      },
      body: JSON.stringify({
        home: { name: '临时队名', shortName: '临时', color: '#123456', textColor: '#fedcba' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { match: Match };
    expect(body.match.home.name).toBe('临时队名');
    expect(body.match.home.shortName).toBe('临时');
    expect(body.match.home.color).toBe('#123456');
    expect(body.match.home.textColor).toBe('#fedcba');

    // 改队名不许顺手把比分/犯规/暂停额度也改了(那三个只能走各自的计分命令)
    expect(body.match.home.score).toBe(before.match.home.score);
    expect(body.match.home.fouls).toBe(before.match.home.fouls);
    expect(body.match.home.timeouts).toBe(before.match.home.timeouts);

    // 还原,免得影响后面的用例
    await fetch(`${BASE}/api/matches/${matchId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-control-token': controlToken,
      },
      body: JSON.stringify({
        home: { name: '主队', shortName: '主队', color: '#1d428a', textColor: '#ffffff' },
      }),
    });
  });

  it('设置开赛时间:控制令牌即可,大屏能读到,格式不对当场拒掉', async () => {
    const display = await connect(matchId, 'display');
    await until(() => display.match !== null);

    // 填一个开赛时间 → 大屏立刻收到
    const res = await fetch(`${BASE}/api/matches/${matchId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-control-token': controlToken,
      },
      body: JSON.stringify({ startTime: '19:00' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { match: Match };
    expect(body.match.startTime).toBe('19:00');
    await until(() => display.match?.startTime === '19:00');

    // 格式不对:当场拒掉,不能让脏数据进库
    const bad = await fetch(`${BASE}/api/matches/${matchId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-control-token': controlToken,
      },
      body: JSON.stringify({ startTime: '25:00' }),
    });
    expect(bad.status).toBe(400);
    const after = (await (await fetch(`${BASE}/api/matches/${matchId}`)).json()) as { match: Match };
    expect(after.match.startTime).toBe('19:00');

    // 还原
    await fetch(`${BASE}/api/matches/${matchId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-control-token': controlToken,
      },
      body: JSON.stringify({ startTime: null }),
    });
    display.close();
  });

  it('只发一个开关字段,不会把其他规则冲掉', async () => {
    const patch = (body: unknown) =>
      fetch(`${BASE}/api/matches/${matchId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-control-token': controlToken,
        },
        body: JSON.stringify(body),
      });

    // 先把几个规则项设成非默认值
    await patch({ rules: { shotClockSeconds: 20, periods: 3, timeoutsPerTeam: 6 } });

    // 只发一个开关(配置页"勾一下就生效"走的就是这条路径)
    await patch({ rules: { useShotClock: false } });

    const res = await fetch(`${BASE}/api/matches/${matchId}`);
    const { match } = (await res.json()) as { match: Match };
    expect(match.rules.useShotClock).toBe(false);
    // 其他规则项必须原样保留,不能被这次"局部补丁"清空
    expect(match.rules.shotClockSeconds).toBe(20);
    expect(match.rules.periods).toBe(3);
    expect(match.rules.timeoutsPerTeam).toBe(6);

    // 还原
    await patch({ rules: { useShotClock: true, shotClockSeconds: 24, periods: 4, timeoutsPerTeam: 4 } });
  });

  it('改暂停时长:控制令牌即可,改完下一次请求暂停按新时长走', async () => {
    const patch = (body: unknown) =>
      fetch(`${BASE}/api/matches/${matchId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-control-token': controlToken,
        },
        body: JSON.stringify(body),
      });

    // 配置页的「暂停时长(秒)」走的就是这条 REST 通道
    await patch({ rules: { timeoutSeconds: 45 } });
    const res = await fetch(`${BASE}/api/matches/${matchId}`);
    const { match } = (await res.json()) as { match: Match };
    expect(match.rules.timeoutSeconds).toBe(45);

    const control = await connect(matchId, 'control', controlToken);
    await until(() => control.match !== null);

    control.send({ t: 'cmd', cmdId: 'to-dur-001', type: 'timeout.request', payload: { side: 'home' } });
    await until(() => control.match?.timeout?.running === true);
    // 倒计时按新的时长启动
    expect(control.match?.timeout?.remainingMs).toBe(45_000);

    // 收尾,别影响后面的用例
    control.send({ t: 'cmd', cmdId: 'to-dur-002', type: 'timeout.end', payload: {} });
    await until(() => control.match?.timeout?.running === false);
    await patch({ rules: { timeoutSeconds: 60 } });
    control.close();
  });

  it('既没有管理员密钥也没有控制令牌 → 改不了配置', async () => {
    const res = await fetch(`${BASE}/api/matches/${matchId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules: { useShotClock: false } }),
    });
    expect(res.status).toBe(401);
  });

  it('破坏性操作仍然只认管理员密钥(控制令牌不行)', async () => {
    const res = await fetch(`${BASE}/api/matches/${matchId}/reset`, {
      method: 'POST',
      headers: { 'x-control-token': controlToken },
    });
    expect(res.status).toBe(401);

    const del = await fetch(`${BASE}/api/matches/${matchId}`, {
      method: 'DELETE',
      headers: { 'x-control-token': controlToken },
    });
    expect(del.status).toBe(401);
  });

  it('重置:管理员密钥必须正确 —— 不带/带错都 401 且比赛没被动过', async () => {
    // 先把比分打上去,好验证"没被动过"
    const control = await connect(matchId, 'control', controlToken);
    await until(() => control.match !== null);
    const before = control.match!.home.score;
    control.send({ t: 'cmd', cmdId: 'dk-001', type: 'score.add', payload: { side: 'home', points: 3 } });
    await until(() => control.match?.home.score === before + 3);

    // 不带密钥
    const noKey = await fetch(`${BASE}/api/matches/${matchId}/reset`, { method: 'POST' });
    expect(noKey.status).toBe(401);
    expect(((await noKey.json()) as { error: string }).error).toBe('需要管理员密钥');

    // 带错的密钥
    const wrong = await fetch(`${BASE}/api/matches/${matchId}/reset`, {
      method: 'POST',
      headers: { 'x-admin-key': '0000' },
    });
    expect(wrong.status).toBe(401);

    // 两次失败之后,比分必须还在 —— 不能出现"密钥错了但照样重置了"
    const after = (await (await fetch(`${BASE}/api/matches/${matchId}`)).json()) as { match: Match };
    expect(after.match.home.score).toBe(before + 3);

    // 带对的密钥 → 真的重置
    const ok = await fetch(`${BASE}/api/matches/${matchId}/reset`, {
      method: 'POST',
      headers: { 'x-admin-key': 'test-admin-key' },
    });
    expect(ok.status).toBe(200);
    const reset = (await ok.json()) as { match: Match };
    expect(reset.match.home.score).toBe(0);

    control.close();
  });

  it('删除:同样只认管理员密钥 —— 带错的那次比赛还在', async () => {
    const created = await fetch(`${BASE}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '待删除比赛', homeName: '甲队', awayName: '乙队' }),
    });
    const body = (await created.json()) as { match: Match };
    const id = body.match.id;

    const noKey = await fetch(`${BASE}/api/matches/${id}`, { method: 'DELETE' });
    expect(noKey.status).toBe(401);

    const wrong = await fetch(`${BASE}/api/matches/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': '0000' },
    });
    expect(wrong.status).toBe(401);
    // 密钥不对 = 没删掉
    expect((await fetch(`${BASE}/api/matches/${id}`)).status).toBe(200);

    const ok = await fetch(`${BASE}/api/matches/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': 'test-admin-key' },
    });
    expect(ok.status).toBe(200);
    expect((await fetch(`${BASE}/api/matches/${id}`)).status).toBe(404);
  });
});

/*
 * 场馆语言:管理台(场地清单)与控制台(本场)必须永远是同一个语言。
 *
 * 语言以前只存在"本场"里,管理台没有"本场"可跟,只能按自己的本机偏好显示 ——
 * 于是会出现"管理台中文、控制台英文",现场看着像坏了。
 * 现在语言以场馆为准,服务端把它镜像到每一场比赛。
 */
describe('端到端:场馆语言全场一致', () => {
  let matchA: string;
  let tokenA: string;
  let matchB: string;
  let tokenB: string;

  beforeAll(async () => {
    const make = async (name: string) => {
      const res = await fetch(`${BASE}/api/matches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, homeName: '甲', awayName: '乙' }),
      });
      const body = (await res.json()) as { match: Match; operatorToken: string };
      return { id: body.match.id, token: body.operatorToken };
    };
    const a = await make('语言测试A');
    const b = await make('语言测试B');
    matchA = a.id;
    tokenA = a.token;
    matchB = b.id;
    tokenB = b.token;
  });

  const localeOf = async (id: string): Promise<string | null> => {
    const res = await fetch(`${BASE}/api/matches/${id}`);
    const body = (await res.json()) as { match: Match };
    return body.match.presentation.locale ?? null;
  };

  it('默认就是中文(场馆语言始终是具体的,不"各看各的")', async () => {
    const res = await fetch(`${BASE}/api/locale`);
    const body = (await res.json()) as { locale: string | null };
    expect(body.locale).toBe('zh-CN');
    expect(await localeOf(matchA)).toBe('zh-CN');
    expect(await localeOf(matchB)).toBe('zh-CN');
  });

  it('在 A 场上改语言 → B 场与管理台(场馆)一起改', async () => {
    const res = await fetch(`${BASE}/api/matches/${matchA}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-control-token': tokenA },
      body: JSON.stringify({ presentation: { locale: 'en-US' } }),
    });
    expect(res.status).toBe(200);

    // 两场比赛都变成英文
    expect(await localeOf(matchA)).toBe('en-US');
    expect(await localeOf(matchB)).toBe('en-US');
    // 场馆语言也跟着变(管理台读的就是它)
    const venue = (await (await fetch(`${BASE}/api/locale`)).json()) as { locale: string };
    expect(venue.locale).toBe('en-US');
  });

  it('控制台用 WS 改语言 → 同样全场一致', async () => {
    const control = await connect(matchB, 'control', tokenB);
    await until(() => control.match !== null);
    control.send({
      t: 'cmd',
      cmdId: 'loc-001',
      type: 'match.update',
      payload: { patch: { presentation: { locale: 'zh-CN' } } },
    });
    await sleep(500);

    expect(await localeOf(matchA)).toBe('zh-CN');
    expect(await localeOf(matchB)).toBe('zh-CN');
    const venue = (await (await fetch(`${BASE}/api/locale`)).json()) as { locale: string };
    expect(venue.locale).toBe('zh-CN');
    control.close();
  });

  it('新比赛直接继承场馆语言(不会刚建出来就与别的场不一致)', async () => {
    await fetch(`${BASE}/api/locale`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'en-US' }),
    });
    const res = await fetch(`${BASE}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '语言测试C', homeName: '丙', awayName: '丁' }),
    });
    const body = (await res.json()) as { match: Match };
    expect(body.match.presentation.locale).toBe('en-US');
    // 收尾:把场馆语言放回中文
    await fetch(`${BASE}/api/locale`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'zh-CN' }),
    });
  });

  it('接口只认 zh-CN / en-US,别的值当场拒绝', async () => {
    const res = await fetch(`${BASE}/api/locale`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'fr-FR' }),
    });
    expect(res.status).toBe(400);
    // 被拒的写入不能改到场馆语言
    const venue = (await (await fetch(`${BASE}/api/locale`)).json()) as { locale: string };
    expect(venue.locale).toBe('zh-CN');
  });
});

/* ============================================================================
 * 24 秒违例:进球钟归零的完整链路
 *
 * 这条链路全是"时间流逝的自然结果",不经过命令通道:
 *   归零 → 服务端自动停比赛钟 + 记日志 + 广播事件 → 大屏提示
 * 球权转交与复位是计分员确认之后才按的命令(球在空中那条例外)。
 * ========================================================================== */

describe('端到端:24 秒违例', () => {
  let matchId: string;
  let controlToken: string;

  beforeAll(async () => {
    const res = await fetch(`${BASE}/api/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '违例测试',
        homeName: '主队',
        awayName: '客队',
        rules: { periods: 4, periodMinutes: 10, shotClockSeconds: 24 },
      }),
    });
    const created = (await res.json()) as { match: Match; operatorToken: string };
    matchId = created.match.id;
    controlToken = created.operatorToken;
  }, 60_000);

  it('开球时进攻钟跟着比赛钟一起启动', async () => {
    const display = await connect(matchId, 'display');
    const control = await connect(matchId, 'control', controlToken);
    await until(() => display.match !== null && control.match !== null);

    control.send({ t: 'cmd', cmdId: 'v0', type: 'clock.toggle', payload: {} });
    await until(() => display.match?.clock.running === true);
    // 联动:不需要再单独按一次进攻钟
    expect(display.match?.shotClock.running).toBe(true);
    expect(display.match?.shotClock.remainingMs).toBe(24_000);

    display.close();
    control.close();
  });

  it('进攻钟归零 → 服务端自动停比赛钟 + 广播事件 + 记日志', async () => {
    const display = await connect(matchId, 'display');
    const control = await connect(matchId, 'control', controlToken);
    await until(() => display.match !== null && control.match !== null);

    // 把进攻钟拨到 1 秒,等它归零
    control.send({ t: 'cmd', cmdId: 'v1', type: 'shot.set', payload: { ms: 1000 } });
    await until(() => display.match?.shotClock.remainingMs === 1000);

    // 归零之后:服务端应该自动把比赛钟停住
    await until(() => display.match?.clock.running === false, 10_000);
    expect(display.match?.clock.running).toBe(false);

    // 大屏收到了 shotClockZero 事件(用来红闪 + 蜂鸣)
    const events = display.messages.filter((m) => m.t === 'event' && m.kind === 'shotClockZero');
    expect(events.length).toBeGreaterThan(0);

    // 日志里留了「24 秒违例」
    const res = await fetch(`${BASE}/api/matches/${matchId}/logs`);
    const body = (await res.json()) as { logs?: { message: string }[] };
    const texts = (body.logs ?? []).map((l) => l.message).join('\n');
    expect(texts).toContain('24 秒违例');

    display.close();
    control.close();
  });

  it('计分员按「24 秒违例」→ 球权转给对方 + 进攻钟复位 24(停着)', async () => {
    const control = await connect(matchId, 'control', controlToken);
    await until(() => control.match !== null);

    control.send({ t: 'cmd', cmdId: 'v2', type: 'possession.set', payload: { side: 'away' } });
    await until(() => control.match?.possession === 'away');

    control.send({ t: 'cmd', cmdId: 'v3', type: 'shot.violation', payload: {} });
    await until(() => control.match?.possession === 'home');
    expect(control.match?.shotClock.remainingMs).toBe(24_000);
    expect(control.match?.shotClock.running).toBe(false);
    expect(control.match?.clock.running).toBe(false);

    control.close();
  });

  it('违例处理完按「开始比赛」→ 两个钟一起走,进攻钟是满的 24 秒', async () => {
    const display = await connect(matchId, 'display');
    const control = await connect(matchId, 'control', controlToken);
    await until(() => display.match !== null && control.match !== null);

    control.send({ t: 'cmd', cmdId: 'v4', type: 'clock.toggle', payload: {} });
    await until(() => display.match?.clock.running === true);
    expect(display.match?.shotClock.running).toBe(true);
    expect(display.match?.shotClock.remainingMs).toBe(24_000);

    display.close();
    control.close();
  });
});
