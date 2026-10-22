/**
 * 七段数码管 —— 纯 SVG 绘制,不依赖任何数码管字体(局域网无外网时字体必掉)。
 *
 * 段位命名:
 *   a 顶 / b 右上 / c 右下 / d 底 / e 左下 / f 左上 / g 中
 *
 * 每个字符占固定宽度(等宽),冒号占较窄的宽度;
 * 未点亮的段画成低对比度"鬼影",点亮的段覆盖在上面。
 */
import type { CSSProperties } from 'react';

export interface SevenSegmentProps {
  /** 只支持 0-9 与 ':'(其它字符渲染为全灭) */
  value: string;
  /** 点亮颜色 */
  color?: string;
  /** 未点亮颜色 */
  dimColor?: string;
  /** 整体高度(px) */
  height?: number;
  /** 整体宽度(px),可选;给了就按给定宽度渲染 */
  width?: number;
  /** 是否渲染冒号 */
  colon?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const DIGIT_W = 100;
const DIGIT_H = 180;
const COLON_W = 44;
const GAP = 12;

/** 段位多边形(坐标系 100 × 180) */
const SEGMENT_POLY: Record<string, string> = {
  a: '10,0 90,0 100,10 90,20 10,20 0,10',
  b: '100,10 90,20 90,80 100,90',
  c: '100,90 90,100 90,160 100,170',
  d: '10,160 90,160 100,170 90,180 10,180 0,170',
  e: '0,90 10,100 10,160 0,170',
  f: '0,10 10,20 10,80 0,90',
  g: '10,80 90,80 100,90 90,100 10,100 0,90',
};

/** 每个数字点亮哪些段 */
const DIGIT_SEGMENTS: Record<string, string[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
};

const SEGMENT_ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

export function SevenSegment({
  value,
  color = '#ffb020',
  dimColor = 'rgba(255,255,255,0.08)',
  height = 120,
  width,
  colon = true,
  className,
  style,
  title,
}: SevenSegmentProps) {
  const chars = (colon ? value : value.replace(/:/g, '')).split('');

  let x = 0;
  let total = 0;
  const items = chars.map((ch) => {
    if (ch === ':') {
      const item = { ch, x, w: COLON_W };
      x += COLON_W;
      total = x;
      return item;
    }
    const item = { ch, x, w: DIGIT_W };
    x += DIGIT_W + GAP;
    total = x - GAP;
    return item;
  });

  const viewBoxWidth = Math.max(total, 1);
  const viewBoxHeight = DIGIT_H;

  // 宽高比:用户给了 width 就按 width 渲染(内部等比,preserveAspectRatio 保证不变形)
  const svgWidth = width ?? Math.round((height * viewBoxWidth) / viewBoxHeight);
  const svgHeight = height;

  return (
    <svg
      className={className ? `seg ${className}` : 'seg'}
      viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
      width={svgWidth}
      height={svgHeight}
      preserveAspectRatio="xMidYMid meet"
      style={style}
      role="img"
      aria-label={title ?? value}
      shapeRendering="geometricPrecision"
    >
      {items.map((item, i) => {
        if (item.ch === ':') {
          return (
            <g key={`c${i}`} transform={`translate(${item.x},0)`}>
              <circle cx={COLON_W / 2} cy={52} r={9} fill={color} />
              <circle cx={COLON_W / 2} cy={128} r={9} fill={color} />
            </g>
          );
        }
        const lit = DIGIT_SEGMENTS[item.ch] ?? [];
        return (
          <g key={`d${i}`} transform={`translate(${item.x},0)`}>
            {SEGMENT_ORDER.map((seg) => (
              <polygon key={seg} points={SEGMENT_POLY[seg]} fill={dimColor} />
            ))}
            {SEGMENT_ORDER.map((seg) =>
              lit.includes(seg) ? <polygon key={`on-${seg}`} points={SEGMENT_POLY[seg]} fill={color} /> : null,
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default SevenSegment;
