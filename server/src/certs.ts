import forge from 'node-forge';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { paths } from './config.js';

export interface TlsOptions {
  key: string;
  cert: string;
}

/** 列出本机所有非内网 IPv4 地址 */
export function lanAddresses(): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family !== 'IPv4') continue;
      if (ni.internal) continue;
      out.push(ni.address);
    }
  }
  return out;
}

/**
 * 判断一个字符串是不是 IP 字面量(而不是域名)。
 *
 * 为什么必须分清:证书的 SAN 分两种条目 ——
 *   `DNS:foo.example`  只能用来匹配主机名
 *   `IP Address:10.0.0.5` 只能用来匹配 IP 地址
 * 按 RFC 6125,浏览器拿 IP 地址去访问时**只认 iPAddress 条目**,
 * 不会拿 DNS 条目去比对 IP。所以 `CERT_NAMES` 里如果填了 IP,
 * 必须写成 IP 条目,否则浏览器照样报"证书名称不匹配",
 * 而 WebSocket 没有"继续前往"可点 —— 控制台会一直连不上。
 */
export function isIpLiteral(value: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) return v4.slice(1).every((p) => Number(p) >= 0 && Number(p) <= 255);
  // IPv6:含冒号,且只由十六进制数字、冒号、点组成
  return value.includes(':') && /^[0-9a-fA-F:.]+$/.test(value);
}

/**
 * 生成(或复用)自签证书。
 *
 * 为什么需要 HTTPS:iPad Safari 的 Service Worker(PWA 离线外壳)与
 * Wake Lock(防锁屏)都要求安全上下文。纯 http://192.168.x.x 下两者全部失效,
 * 而 Wake Lock 一失效,计分员手机的屏幕就会在比赛中途锁死。
 *
 * SAN 里必须同时写 DNS 名与 IP,否则 iPad 用 IP 访问会报证书不匹配。
 */
export function ensureCert(extraNames: string[] = []): TlsOptions {
  fs.mkdirSync(paths.cert, { recursive: true });
  const keyFile = path.join(paths.cert, 'server.key');
  const certFile = path.join(paths.cert, 'server.crt');

  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return {
      key: fs.readFileSync(keyFile, 'utf8'),
      cert: fs.readFileSync(certFile, 'utf8'),
    };
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 825 * 24 * 3600 * 1000);

  const host = os.hostname();
  const attrs = [{ name: 'commonName', value: host }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  // CERT_NAMES 里可能混着域名和 IP,必须分开:
  // 域名进 DNS 条目,IP 进 IPAddress 条目 —— 浏览器只认对的那一种。
  const extraDns: string[] = [];
  const extraIps: string[] = [];
  for (const name of extraNames) {
    if (isIpLiteral(name)) extraIps.push(name);
    else extraDns.push(name);
  }

  const dnsNames = new Set<string>(['localhost', host, ...extraDns]);
  const ipNames = new Set<string>(['127.0.0.1', ...lanAddresses(), ...extraIps]);

  const altNames = [
    ...[...dnsNames].map((value) => ({ type: 2, value })),
    ...[...ipNames].map((ip) => ({ type: 7, ip })),
  ];

  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    {
      name: 'keyUsage',
      keyCertSign: true,
      digitalSignature: true,
      keyEncipherment: true,
    },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);

  fs.writeFileSync(keyFile, keyPem, { mode: 0o600 });
  fs.writeFileSync(certFile, certPem);

  return { key: keyPem, cert: certPem };
}
