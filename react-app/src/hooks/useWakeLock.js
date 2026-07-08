import { useEffect, useRef } from 'react';

export function useWakeLock(enabled) {
  const wakeLockRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function releaseWakeLock() {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch {
          // Ignore release failures.
        }
        wakeLockRef.current = null;
      }
    }

    async function requestWakeLock() {
      if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
        await releaseWakeLock();
        return;
      }

      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await lock.release().catch(() => {});
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener('release', () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null;
        });
      } catch {
        await releaseWakeLock();
      }
    }

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabled) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [enabled]);
}
