import { useEffect, useState } from 'react';

import { SESSION_INFO_REFRESH_MS } from '../constants.js';

/** mptl fork: the current time, refreshed every SESSION_INFO_REFRESH_MS while
 *  `active` (session meta lives in mutable OfficeState, not React state, so
 *  idle times only move when something re-renders). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), SESSION_INFO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
