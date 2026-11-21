import { type RefObject, useLayoutEffect, useState } from 'react';
import type { PanelSize } from './usePanelWidth';

/** An element's content size, kept current as it resizes. */
export function useElementSize(ref: RefObject<HTMLElement | null>): PanelSize {
  const [size, setSize] = useState<PanelSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const box = el.getBoundingClientRect();
      setSize((s) =>
        s.width === box.width && s.height === box.height
          ? s
          : { width: box.width, height: box.height },
      );
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
