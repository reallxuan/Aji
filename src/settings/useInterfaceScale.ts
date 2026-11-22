import { useEffect } from 'react';
import { useDeviceStore } from '../device/deviceStore';

/**
 * The interface scale (P2 M1 design 5.9): the root font size as a percentage, so everything sized
 * in rem scales with it at once. The board is sized in pixels from the window, so it does not.
 */
export function useInterfaceScale(): void {
  const scale = useDeviceStore((s) => s.settings.interfaceScale);
  useEffect(() => {
    document.documentElement.style.fontSize = scale === 100 ? '' : `${scale}%`;
  }, [scale]);
}
