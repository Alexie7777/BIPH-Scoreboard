/**
 * 自签证书测试:重点锁住 SAN 条目里【域名】与【IP】不能混。
 *
 * 背景(一个真实踩过的坑):
 * 证书的 SAN 分两种条目 ——
 *   DNS:foo.example     只能匹配主机名
 *   IP Address:10.0.0.5 只能匹配 IP 地址
 * 按 RFC 6125,浏览器拿 IP 去访问时**只认 iPAddress 条目**,
 * 不会拿 DNS 条目去比对 IP。
 *
 * 而 CERT_NAMES 之前是一律塞进 DNS 列表的 —— 于是部署时填了
 * `CERT_NAMES: "10.37.2.208"`,证书里出来的是 `DNS:10.37.2.208`,
 * 浏览器照样报"证书名称不匹配";页面可以点"继续前往"硬过,
 * 但 WebSocket 没有"继续前往"可点,控制台就一直连不上。
 */
import { describe, expect, it, vi } from 'vitest';
import forge from 'node-forge';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface AltName {
  type: number;
  value?: string;
  ip?: string;
}

async function genCert(extraNames: string[]): Promise<{ dns: string[]; ips: string[] }> {
  const prevDataDir = process.env.DATA_DIR;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biph-cert-'));
  process.env.DATA_DIR = tmp;
  try {
    vi.resetModules();
    const mod = await import('../src/certs.js');
    const { cert } = mod.ensureCert(extraNames);
    const parsed = forge.pki.certificateFromPem(cert);
    const ext = parsed.getExtension('subjectAltName') as { altNames?: AltName[] } | null;
    const alt = ext?.altNames ?? [];
    return {
      dns: alt.filter((a) => a.type === 2).map((a) => a.value ?? ''),
      ips: alt.filter((a) => a.type === 7).map((a) => a.ip ?? ''),
    };
  } finally {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('自签证书的 SAN', () => {
  it('CERT_NAMES 里的 IP 进 IPAddress 条目(不是 DNS 条目)', async () => {
    const { dns, ips } = await genCert(['10.37.2.208']);
    expect(ips).toContain('10.37.2.208');
    // 这条是本测试存在的全部理由:IP 绝不能只出现在 DNS 列表里
    expect(dns).not.toContain('10.37.2.208');
  });

  it('CERT_NAMES 里的域名照旧进 DNS 条目', async () => {
    const { dns, ips } = await genCert(['scoreboard.school.edu']);
    expect(dns).toContain('scoreboard.school.edu');
    expect(ips).not.toContain('scoreboard.school.edu');
  });

  it('域名和 IP 混着填也能各归各位', async () => {
    const { dns, ips } = await genCert(['10.37.2.208', 'scoreboard.school.edu', '192.168.1.20']);
    expect(ips).toContain('10.37.2.208');
    expect(ips).toContain('192.168.1.20');
    expect(dns).toContain('scoreboard.school.edu');
    expect(dns).not.toContain('10.37.2.208');
    expect(dns).not.toContain('192.168.1.20');
  });

  it('IPv6 也进 IPAddress 条目', async () => {
    const { dns, ips } = await genCert(['2001:db8::1']);
    expect(ips).toContain('2001:db8::1');
    expect(dns).not.toContain('2001:db8::1');
  });

  it('本机地址与 localhost 永远在证书里(不依赖 CERT_NAMES)', async () => {
    const { dns, ips } = await genCert([]);
    expect(dns).toContain('localhost');
    expect(ips).toContain('127.0.0.1');
  });
});

describe('isIpLiteral', () => {
  it('认得出 IP,认不出域名', async () => {
    vi.resetModules();
    const mod = await import('../src/certs.js');
    expect(mod.isIpLiteral('10.37.2.208')).toBe(true);
    expect(mod.isIpLiteral('192.168.1.20')).toBe(true);
    expect(mod.isIpLiteral('2001:db8::1')).toBe(true);
    expect(mod.isIpLiteral('scoreboard.school.edu')).toBe(false);
    expect(mod.isIpLiteral('localhost')).toBe(false);
    expect(mod.isIpLiteral('10.37.2')).toBe(false);
    expect(mod.isIpLiteral('999.1.1.1')).toBe(false);
  });
});
