import { useDeviceStore } from '../device/deviceStore';
import { startedNarrow } from '../layout/startedNarrow';
import type { Theme } from '../theme/theme';
import { useResolvedTheme } from '../theme/useResolvedTheme';
import { effectiveStyle, type StyleChoice } from './styles';

/**
 * The board and stones to draw in `theme` (default: the theme the window is in, dark boards
 * design): the device's choice for it, or the default for how the device started.
 */
export function useBoardStyle(theme?: Theme): StyleChoice {
  const resolved = useResolvedTheme();
  const boardStyles = useDeviceStore((s) => s.settings.boardStyles);
  const layout = useDeviceStore((s) => s.settings.layout);
  const stored = useDeviceStore((s) => s.settings.startedNarrow);
  const which = theme ?? resolved;
  // The first launch stores its answer; until then (or in a store this build cannot write), the
  // session's own.
  return effectiveStyle(
    { boardStyles },
    boardStyles[which] ? false : (stored ?? startedNarrow(layout)),
    which,
  );
}

/** The wood boards' grain strength on this device (UI polish design 3). */
export function useGrainStrength(): number {
  return useDeviceStore((s) => s.settings.grainStrength);
}
