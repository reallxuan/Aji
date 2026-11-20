import { useEffect, useState } from 'react';

const read = () => window.devicePixelRatio || 1;

/**
 * The current device pixel ratio. A `(resolution: Ndppx)` query stops matching when the ratio
 * changes, for example when the window moves to another screen or the page zoom changes; the
 * hook then reads the new ratio and listens for the next change.
 */
export function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(read);
  useEffect(() => {
    const matchMedia = window.matchMedia?.bind(window);
    if (!matchMedia) return;
    const query = matchMedia(`(resolution: ${ratio}dppx)`);
    const onChange = () => setRatio(read());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [ratio]);
  return ratio;
}
