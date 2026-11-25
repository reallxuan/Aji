import { useDeviceStore } from '../device/deviceStore';
import { startedNarrow } from '../layout/startedNarrow';
import { effectiveStyle, type StyleChoice } from './styles';

/** The board and stones to draw: the device's choice, or the default for how it started. */
export function useBoardStyle(): StyleChoice {
  const boardStyle = useDeviceStore((s) => s.settings.boardStyle);
  const layout = useDeviceStore((s) => s.settings.layout);
  const stored = useDeviceStore((s) => s.settings.startedNarrow);
  // The first launch stores its answer; until then (or in a store this build cannot write), the
  // session's own.
  return effectiveStyle({ boardStyle }, boardStyle ? false : (stored ?? startedNarrow(layout)));
}

/** The wood boards' grain strength on this device (UI polish design 3). */
export function useGrainStrength(): number {
  return useDeviceStore((s) => s.settings.grainStrength);
}
