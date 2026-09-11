import { useEffect } from 'react';
interface WakeLockSentinelLike {
  release(): Promise<void>;
}
type NavigatorWithWakeLock = Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let sentinel: WakeLockSentinelLike | undefined;
    let cancelled = false;
    const request = async () => {
      try {
        const api = (navigator as NavigatorWithWakeLock).wakeLock;
        if (api && !cancelled) sentinel = await api.request('screen');
      } catch {
        /* Browser may deny without user gesture. */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
