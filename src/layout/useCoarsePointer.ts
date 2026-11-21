import { useEffect, useState } from 'react';

const QUERY = '(pointer: coarse)';

/** Whether the primary pointer is coarse (a finger), kept current as it changes. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => window.matchMedia?.(QUERY).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(QUERY);
    if (!query) return;
    const onChange = () => setCoarse(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return coarse;
}
