/**
 * iPad 防锁屏。
 *
 * 首选 Wake Lock API(navigator.wakeLock.request('screen'));
 * 不支持或被拒绝时,退化为【循环播放静音音频】—— 这是 Safari 上唯一
 * 能阻止页面进入后台休眠的老办法(配合静音的 WAV)。
 *
 * 页面重新可见(visibilitychange)时必须重新申请:Wake Lock 在页面隐藏时
 * 会被系统自动释放。
 */
import { useEffect, useRef, useState } from 'react';
import { getLocale, translate } from '../i18n';
import { SILENT_WAV_DATA_URL } from './silentWav';

export type WakeMethod = 'none' | 'wakelock' | 'audio';

export interface WakeLockState {
  /** 浏览器是否支持 Wake Lock API */
  supported: boolean;
  /** 当前是否正在"保持屏幕常亮" */
  active: boolean;
  /** 实际生效的方式 */
  method: WakeMethod;
  /** 失败原因(仅供排查) */
  error: string | null;
}

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function getWakeLock(): WakeLockLike | null {
  const nav = navigator as Navigator & { wakeLock?: WakeLockLike };
  return nav.wakeLock ?? null;
}

export function useWakeLock(enabled = true): WakeLockState {
  const [state, setState] = useState<WakeLockState>({
    supported: false,
    active: false,
    method: 'none',
    error: null,
  });

  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const methodRef = useRef<WakeMethod>('none');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const stopAudio = () => {
      const a = audioRef.current;
      if (a) {
        try {
          a.pause();
          a.currentTime = 0;
        } catch {
          /* ignore */
        }
        audioRef.current = null;
      }
      if (methodRef.current === 'audio') methodRef.current = 'none';
    };

    const startAudioFallback = async (): Promise<void> => {
      if (audioRef.current) return;
      try {
        const audio = new Audio(SILENT_WAV_DATA_URL);
        audio.loop = true;
        audio.preload = 'auto';
        audio.volume = 0;
        audioRef.current = audio;
        await audio.play();
        if (!mountedRef.current) {
          audio.pause();
          return;
        }
        methodRef.current = 'audio';
        setState((s) => ({ ...s, active: true, method: 'audio', error: s.error }));
      } catch (e) {
        if (!mountedRef.current) return;
        setState((s) => ({
          ...s,
          active: false,
          method: 'none',
          error: e instanceof Error ? e.message : translate(getLocale(), 'error.wake.silent'),
        }));
      }
    };

    const releaseSentinel = () => {
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s && !s.released) {
        try {
          void s.release();
        } catch {
          /* ignore */
        }
      }
    };

    const requestWakeLock = async (): Promise<void> => {
      const wl = getWakeLock();
      if (!wl) {
        await startAudioFallback();
        return;
      }
      try {
        const sentinel = await wl.request('screen');
        if (!mountedRef.current) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        sentinelRef.current = sentinel;
        methodRef.current = 'wakelock';
        setState((s) => ({ ...s, supported: true, active: true, method: 'wakelock', error: null }));
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null;
          if (methodRef.current === 'wakelock') methodRef.current = 'none';
          if (mountedRef.current) setState((s) => ({ ...s, active: false, method: 'none' }));
        });
      } catch (e) {
        await startAudioFallback();
        if (mountedRef.current) {
          setState((s) => ({
            ...s,
            supported: true,
            error: e instanceof Error ? e.message : translate(getLocale(), 'error.wake.lock'),
          }));
        }
      }
    };

    if (!enabled) return;

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (methodRef.current === 'wakelock' && !sentinelRef.current) {
          void requestWakeLock();
        } else if (methodRef.current === 'none' && !audioRef.current) {
          void requestWakeLock();
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    void requestWakeLock();

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      releaseSentinel();
      stopAudio();
      setState({ supported: false, active: false, method: 'none', error: null });
    };
  }, [enabled]);

  return state;
}
