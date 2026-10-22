/**
 * CSS 自定义属性的小工具。
 *
 * TypeScript 的 CSSProperties 不带索引签名,直接写
 * `style={{ '--team-color': c }}` 会报错,统一走这里做一次断言。
 */
import type { CSSProperties } from 'react';

export function cssVars(vars: Record<string, string | number | undefined>): CSSProperties {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as CSSProperties;
}
