import type { SVGProps } from 'react';
import { useJobStore } from '../job/jobStore';
import type { TrendNode } from '../transport/generated/TrendNode';

/** A cell's height, and a queued boost cell's (mockup analysis-controls.html, sections 3–4). */
const CELL = 3;
const TALL = 8;

type Cell = 'working' | 'boost' | 'result' | 'queued';

/**
 * The coverage strip under the graph's 0% line (P2 M2 design 5.3): one cell per main-line node,
 * centred on its move. Solid with a result, faint when queued, green while searched; during the
 * boost pass its queued cells stand taller, and drop back once done. It shows from a job's start
 * until the game is closed.
 */
export function CoverageStrip({
  nodes,
  x,
  y,
  span,
}: {
  nodes: readonly TrendNode[];
  /** A node's x in the graph. */
  x: (index: number) => number;
  /** The strip's top. */
  y: number;
  /** The plot's width. */
  span: number;
}) {
  const shown = useJobStore((s) => s.strip);
  const progress = useJobStore((s) => s.progress);
  if (!shown || nodes.length === 0) return null;
  const queued = new Set(progress?.queued ?? []);
  const working = progress?.working ?? null;
  const boosting = progress?.state === 'boosting';
  const w = span / nodes.length;

  const kind = (i: number): Cell | null => {
    if (i === working) return 'working';
    if (boosting && queued.has(i)) return 'boost';
    if (nodes[i].stats) return 'result';
    return queued.has(i) ? 'queued' : null;
  };

  return (
    <g data-strip aria-hidden>
      {nodes.map((_, i) => {
        const cell = kind(i);
        if (!cell) return null;
        const left = x(i) - w / 2;
        return <rect key={i} data-index={i} data-cell={cell} {...look(cell, left)} />;
      })}
    </g>
  );

  function look(cell: Cell, left: number): SVGProps<SVGRectElement> {
    switch (cell) {
      case 'working':
        return {
          x: left - 0.5,
          y: boosting ? y - 5 : y - 0.5,
          width: Math.max(2, w) + 1,
          height: boosting ? TALL : CELL + 1,
          rx: 1,
          fill: 'var(--engine-ok)',
        };
      case 'boost':
        return {
          x: left,
          y: y - 5,
          width: Math.max(1.6, w),
          height: TALL,
          rx: 0.5,
          fill: 'var(--text)',
          opacity: 0.55,
        };
      case 'result':
        return {
          x: left,
          y,
          width: w + 0.2,
          height: CELL,
          fill: 'var(--text-muted)',
          opacity: 0.75,
        };
      case 'queued':
        return { x: left, y, width: w + 0.2, height: CELL, fill: 'var(--line)', opacity: 0.35 };
    }
  }
}
