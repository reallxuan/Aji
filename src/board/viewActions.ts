import { useViewStore } from '../analysis/viewStore';
import type { MoveNumbers } from '../device/deviceSettings';
import { useDeviceStore } from '../device/deviceStore';
import { flipH, flipV, rotateCcw, rotateCw } from './orientation';

export const ROTATIONS = ['rotateCw', 'rotateCcw', 'flipH', 'flipV', 'resetOrientation'] as const;
const transforms = { rotateCw, rotateCcw, flipH, flipV, resetOrientation: () => 0 as const };

export function orient(action: (typeof ROTATIONS)[number]) {
  useViewStore.setState((s) => ({ orientation: transforms[action](s.orientation) }));
}

export function setNumberMode(mode: MoveNumbers['mode']) {
  const {
    settings: { moveNumbers },
    update,
  } = useDeviceStore.getState();
  const lastOn =
    mode === 'off' ? (moveNumbers.mode === 'off' ? moveNumbers.lastOn : moveNumbers.mode) : mode;
  update({ moveNumbers: { ...moveNumbers, mode, lastOn } });
}

export function toggleBranchNumbers() {
  const {
    settings: { moveNumbers },
    update,
  } = useDeviceStore.getState();
  update({ moveNumbers: { ...moveNumbers, restartInBranch: !moveNumbers.restartInBranch } });
}
