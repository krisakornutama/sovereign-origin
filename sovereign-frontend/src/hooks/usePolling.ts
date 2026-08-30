import { useEffect, useRef } from 'react';

export function usePolling(fn: () => void, ms: number, opts: { pauseWhenHidden?: boolean } = {}) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let id: any;
    const tick = () => {
      if (opts.pauseWhenHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      ref.current();
    };
    id = setInterval(tick, ms);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [ms, opts.pauseWhenHidden]);
}
