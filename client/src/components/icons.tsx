/**
 * 内联 SVG 图标(不引入图标库、不使用 emoji)。
 */
import type { SVGProps } from 'react';

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function Svg({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconPlay({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <polygon points="7,4 20,12 7,20" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconPause({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconUndo({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </Svg>
  );
}

export function IconSwap({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M7 4 3 8l4 4" />
      <path d="M3 8h13a5 5 0 0 1 0 10h-2" />
      <path d="m17 20 4-4-4-4" />
    </Svg>
  );
}

export function IconBuzzer({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 9H4c0-2 2-3 2-9Z" />
      <path d="M10 21h4" />
    </Svg>
  );
}

export function IconFlag({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2 4 2 4H5" />
    </Svg>
  );
}

export function IconExternal({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </Svg>
  );
}

export function IconCopy({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </Svg>
  );
}

export function IconChevron({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="m9 5 7 7-7 7" />
    </Svg>
  );
}

export function IconReset({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4v5h5" />
    </Svg>
  );
}

export function IconPlus({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconMinus({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function IconWifiOff({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M2 2l20 20" />
      <path d="M8.6 16.4a5 5 0 0 1 6.8 0" />
      <path d="M5 12.9a10 10 0 0 1 3.2-2.2" />
      <path d="M15.8 10.7a10 10 0 0 1 3.2 2.2" />
      <path d="M2 8.8a15 15 0 0 1 4.2-2.7" />
      <path d="M10.9 5.2A15 15 0 0 1 22 8.8" />
      <circle cx="12" cy="20" r="1" fill="currentColor" />
    </Svg>
  );
}

export function IconClock({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

export function IconSettings({ size, ...rest }: IconProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </Svg>
  );
}
