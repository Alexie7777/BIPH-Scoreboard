/**
 * requestAnimationFrame 驱动的节拍器。
 *
 * 显示层用它来"每秒格式化一次"——不自己写递减计数器,
 * 也不依赖 setInterval 的精度。
 */
import { useEffect, useRef } from 'react';

export function useTicker(callback: (perfNow: number) => void, active = true): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      cbRef.current(performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

export default useTicker;
