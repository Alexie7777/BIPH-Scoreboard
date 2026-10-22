/**
 * 颜色工具 —— 仅做"看得见的对比度提示"。
 *
 * 队名/字色由计分员手填,填出"深底深字"时必须提醒,否则大屏上根本读不出来。
 */
import { translate, type Locale } from '../i18n';

/** '#rrggbb' / '#rgb' → [r, g, b] */
export function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** 相对亮度(WCAG) */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb;
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** 对比度 1~21 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastLevel = 'good' | 'ok' | 'bad';

export function contrastLevel(ratio: number): ContrastLevel {
  if (ratio >= 4.5) return 'good';
  if (ratio >= 3) return 'ok';
  return 'bad';
}

/** 生成一段对比度提示(按当前语言) */
export function describeContrast(
  bg: string,
  fg: string,
  locale: Locale,
): { ratio: number; level: ContrastLevel; text: string } {
  if (!hexToRgb(bg) || !hexToRgb(fg)) {
    return { ratio: 0, level: 'ok', text: translate(locale, 'contrast.invalid') };
  }
  const ratio = contrastRatio(bg, fg);
  const level = contrastLevel(ratio);
  const text =
    level === 'good'
      ? translate(locale, 'contrast.good', { r: ratio.toFixed(1) })
      : level === 'ok'
        ? translate(locale, 'contrast.ok', { r: ratio.toFixed(1) })
        : translate(locale, 'contrast.bad', { r: ratio.toFixed(1) });
  return { ratio, level, text };
}

/** 在给定底色上挑一个可读的字色(黑白二选一) */
export function readableTextColor(bg: string): string {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111111') ? '#ffffff' : '#111111';
}

/**
 * 把队色调亮到"深色大屏上读得清"的程度。
 *
 * 队色是各校自己定的,可能是深蓝/深绿这类在近黑背景上看不清的颜色。
 * 大屏上我们仍然想保留"这是哪支队"的颜色识别,只是把它提亮,
 * 而不是直接换成白色(那样两支队就没区别了)。
 */
export function readableAccent(hex: string, bg = '#0b0e14', minRatio = 3): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const toHex = (c: [number, number, number]) =>
    '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

  let cur: [number, number, number] = [rgb[0], rgb[1], rgb[2]];
  for (let i = 0; i <= 60; i += 1) {
    const c = toHex(cur);
    if (contrastRatio(c, bg) >= minRatio) return c;
    cur = [cur[0] + (255 - cur[0]) * 0.05, cur[1] + (255 - cur[1]) * 0.05, cur[2] + (255 - cur[2]) * 0.05];
  }
  return '#ffffff';
}
