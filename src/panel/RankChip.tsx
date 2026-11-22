import type { Tier } from '../analysis/candidates';
import { CHIP_BEST_RING_WIDTH, CHIP_FILL, TIER_STYLE, withAlpha } from '../analysis/palette';

/** A candidate's rank in its disc's tier colours; the played move carries the outer ring. */
export function RankChip({ tier, rank, played }: { tier: Tier; rank: number; played: boolean }) {
  const style = TIER_STYLE[tier];
  const ring = tier === 'best' ? CHIP_BEST_RING_WIDTH : style.ringWidth;
  return (
    <i
      data-played={played || undefined}
      className={[
        'inline-flex size-[21px] shrink-0 items-center justify-center rounded-full text-[0.6875rem] not-italic',
        style.bold ? 'font-bold' : '',
        played ? 'outline-2 outline-offset-1 outline-text outline-solid' : '',
      ].join(' ')}
      style={{
        background: CHIP_FILL[tier],
        boxShadow: `inset 0 0 0 ${ring}px ${withAlpha(style.ring, style.ringAlpha)}`,
        color: style.text,
      }}
    >
      {rank}
    </i>
  );
}
