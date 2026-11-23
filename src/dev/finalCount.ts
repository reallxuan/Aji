import { komiOf, scoringOf } from '../game/komi';
import { groupAt } from '../scoring/groups';
import type { Color } from '../transport/generated/Color';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { Point } from '../transport/generated/Point';
import type { ScoreSide } from '../transport/generated/ScoreSide';
import type { ScoreView } from '../transport/generated/ScoreView';

/**
 * The scenarios' final count, for working on the scoring card without a backend: regions
 * flood-filled once `dead` is lifted, as the backend does. With no ownership to read, it suggests
 * every stone that stands alone as dead.
 */
export function finalCount(game: GameSnapshot, dead: Point[]): ScoreView {
  const { size, stones } = game;
  const isDead = new Set(dead.map((p) => p.y * size + p.x));
  const live = stones.map((stone, i) => (isDead.has(i) ? null : stone));
  const owners: (Color | null)[] = [...live];
  const seen = new Set<number>();
  for (let start = 0; start < live.length; start++) {
    if (live[start] || seen.has(start)) continue;
    const region: number[] = [];
    const borders = new Set<Color>();
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop()!;
      region.push(i);
      for (const j of neighbours(i, size)) {
        const stone = live[j];
        if (stone) borders.add(stone);
        else if (!seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    const owner = borders.size === 1 ? [...borders][0] : null;
    for (const i of region) owners[i] = owner;
  }

  const side = (prisoners: number): ScoreSide => ({
    stones: 0,
    territory: 0,
    dead: 0,
    prisoners,
    total: 0,
  });
  const count = { black: side(game.captures[0]), white: side(game.captures[1]) };
  owners.forEach((owner, i) => {
    if (!owner) return;
    if (live[i]) count[owner].stones++;
    else if (stones[i]) count[owner].dead++;
    else count[owner].territory++;
  });
  const scoring = scoringOf(game.rules.current);
  const komi = komiOf(game.rules.current);
  for (const s of [count.black, count.white])
    s.total =
      scoring === 'area' ? s.stones + s.territory + s.dead : s.territory + 2 * s.dead + s.prisoners;
  count.white.total += komi;

  const suggestedDead = stones.flatMap((stone, i) => {
    const at = { x: i % size, y: Math.floor(i / size) };
    return stone && groupAt(stones, size, at).length === 1 ? [at] : [];
  });
  return {
    ...count,
    komi,
    margin: count.black.total - count.white.total,
    owners,
    // No ownership here: an open region stays neutral, as the backend leaves it without one.
    openByOwnership: false,
    suggestedDead,
  };
}

function neighbours(i: number, size: number): number[] {
  const [x, y] = [i % size, Math.floor(i / size)];
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x + 1 < size) out.push(i + 1);
  if (y > 0) out.push(i - size);
  if (y + 1 < size) out.push(i + size);
  return out;
}
