/**
 * 配置层测试:管理员密钥的默认值。
 *
 * 为什么把密钥写死成 1818:
 * 这个密钥防的是【误触】,不是黑客 —— 校内封闭网络里,现场真正要挡的
 * 是"手滑把正在打的比赛删了"。随机密钥意味着每次部署都要有人先去服务器上
 * 把密钥捞出来、抄在本子上、贴在机房门上,实际执行率接近零:
 * 闸门形同虚设,反而给人"这里有安全"的错觉。
 * 真要更严,启动时用 ADMIN_KEY 环境变量覆盖即可。
 */
import { describe, expect, it, vi } from 'vitest';

describe('管理员密钥', () => {
  it('没有设 ADMIN_KEY 时,就是默认的 1818', async () => {
    const prev = process.env.ADMIN_KEY;
    delete process.env.ADMIN_KEY;
    try {
      vi.resetModules();
      const mod = await import('../src/config.js');
      expect(mod.DEFAULT_ADMIN_KEY).toBe('1818');
      expect(mod.config.adminKey).toBe('1818');
    } finally {
      if (prev === undefined) delete process.env.ADMIN_KEY;
      else process.env.ADMIN_KEY = prev;
    }
  });

  it('ADMIN_KEY 环境变量可以覆盖默认值', async () => {
    const prev = process.env.ADMIN_KEY;
    process.env.ADMIN_KEY = 'my-own-key';
    try {
      vi.resetModules();
      const mod = await import('../src/config.js');
      expect(mod.config.adminKey).toBe('my-own-key');
      // 常量本身不环境变量影响 —— 它就是那个"默认"
      expect(mod.DEFAULT_ADMIN_KEY).toBe('1818');
    } finally {
      if (prev === undefined) delete process.env.ADMIN_KEY;
      else process.env.ADMIN_KEY = prev;
    }
  });

  it('空的 ADMIN_KEY 视同没设(仍然用默认值)', async () => {
    const prev = process.env.ADMIN_KEY;
    process.env.ADMIN_KEY = '';
    try {
      vi.resetModules();
      const mod = await import('../src/config.js');
      expect(mod.config.adminKey).toBe('1818');
    } finally {
      if (prev === undefined) delete process.env.ADMIN_KEY;
      else process.env.ADMIN_KEY = prev;
    }
  });
});
