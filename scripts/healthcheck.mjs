/**
 * 容器健康检查探针。
 *
 * 为什么不能直接 `fetch('http://127.0.0.1:8080/api/health')`:
 *   服务默认只听 HTTPS(自签证书),http 请求会直接失败,
 *   容器会被永久标记成 unhealthy —— 服务其实好好的,监控却在报警。
 *
 * 所以这里两条路都探:
 *   1) https,关掉证书校验(自签证书没有可信任的 CA);
 *   2) https 探不通再退回 http —— 用户把 HTTPS 关掉(HTTPS=false)时服务只听 http。
 * 两条都探不通,才算真的不健康。
 *
 * 退出码:0 = 健康,1 = 不健康。
 */
import http from 'node:http';
import https from 'node:https';

const PORT = Number(process.env.PORT || 8080);
const HOST = '127.0.0.1';
const PATH = '/api/health';
const TIMEOUT = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 8000);

function probe(agent) {
  return new Promise((resolve) => {
    const req = agent.get(
      { host: HOST, port: PORT, path: PATH, rejectUnauthorized: false, timeout: TIMEOUT },
      (res) => {
        res.resume(); // 把响应体消费掉,否则 socket 挂着不释放
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

const ok = (await probe(https)) || (await probe(http));
process.exit(ok ? 0 : 1);
