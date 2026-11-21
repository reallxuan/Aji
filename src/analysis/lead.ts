import { useDeviceStore } from '../device/deviceStore';
import { komiOf } from '../game/komi';
import { useGameStore } from '../game/gameStore';
import type { Color } from '../transport/generated/Color';

/**
 * `side`'s lead counted on the board alone (design 5.10, 盘面): KataGo's lead includes komi, so
 * Black's board count adds it back and White's takes it away. `scoreLead` is from `side`'s view.
 */
export function boardLead(scoreLead: number, komi: number, side: Color): number {
  return side === 'black' ? scoreLead + komi : scoreLead - komi;
}

/**
 * The komi to take out of every lead shown, or `null` to show KataGo's lead with komi (the
 * default, 含贴目). The komi is the open game's.
 */
export function useBoardKomi(): number | null {
  const withKomi = useDeviceStore((s) => s.settings.scoreWithKomi);
  const rules = useGameStore((s) => s.snapshot?.rules.current ?? null);
  return withKomi || !rules ? null : komiOf(rules);
}
