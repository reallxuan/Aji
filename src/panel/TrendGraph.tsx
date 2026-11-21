import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPercent } from '../analysis/format';
import { mistakes, plotRuns, plotted, scoreRange } from '../analysis/trend';
import { useTrendStore } from '../analysis/trendStore';
import { moveLabel } from '../board/coordinates';
import { useGameStore } from '../game/gameStore';
import { useFrameNavigate } from '../game/useFrameNavigate';
import { usePanelWidth } from '../layout/usePanelWidth';
import type { TrendNode } from '../transport/generated/TrendNode';

// Plot margins as in the approved mockup (trend-graph.html, section 2).
const PAD = { left: 52, right: 44, top: 12, bottom: 22 };
const MINUS = '−';

/** Where move-number ticks go: every 50 moves, or every 10 in a short game, by move number. */
function ticks(nodes: readonly TrendNode[]): Array<{ index: number; label: number }> {
  const last = nodes.at(-1)?.moveNumber ?? 0;
  const step = last < 50 ? 10 : 50;
  const out: Array<{ index: number; label: number }> = [];
  for (let m = step; m < last; m += step) {
    const index = nodes.findIndex((n) => n.moveNumber === m);
    if (index >= 0) out.push({ index, label: m });
  }
  return out;
}

/**
 * Black's win rate and lead over the main line (design 5.5): one slot per main-line node, gaps
 * left empty, mistake bars along the bottom, the current node dashed. Hover shows a node's
 * numbers; click or drag goes there. `width` is for tests; the panel's width otherwise.
 */
export function TrendGraph({ height, width }: { height: number; width?: number }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const panelWidth = usePanelWidth();
  const W = width ?? panelWidth;
  const nodes = useTrendStore((s) => s.nodes);
  const lineIndex = useGameStore((s) => s.snapshot?.lineIndex ?? 0);
  const boardSize = useGameStore((s) => s.snapshot?.size ?? 19);
  const go = useFrameNavigate();
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);

  const last = Math.max(1, nodes.length - 1);
  const gw = Math.max(0, W - PAD.left - PAD.right);
  const gh = Math.max(0, height - PAD.top - PAD.bottom);
  const range = useMemo(() => scoreRange(nodes), [nodes]);
  const runs = useMemo(() => plotRuns(nodes), [nodes]);
  const bars = useMemo(() => mistakes(nodes), [nodes]);
  const x = (i: number) => PAD.left + (i / last) * gw;
  const yWinrate = (w: number) => PAD.top + (1 - w) * gh;
  const yLead = (s: number) => PAD.top + (0.5 - s / (2 * range)) * gh;
  const wr = (i: number) => yWinrate(nodes[i].stats!.winrate);
  const sc = (i: number) => yLead(nodes[i].stats!.scoreLead);
  const bottom = yWinrate(0);

  const indexAt = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.round(((event.clientX - box.left - PAD.left) / Math.max(1, gw)) * last);
    return Math.max(0, Math.min(nodes.length - 1, i));
  };
  const goTo = (i: number) => {
    if (!nodes[i] || dragging.current === i) return;
    dragging.current = i;
    go({ move: nodes[i].moveNumber });
  };

  const line = (y: (i: number) => number, name: string, color: string, stroke: number) =>
    runs.map((run) =>
      run.length === 1 ? (
        <circle key={run[0]} data-line={name} cx={x(run[0])} cy={y(run[0])} r={1.4} fill={color} />
      ) : (
        <path
          key={run[0]}
          data-line={name}
          d={run.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)} ${y(i).toFixed(1)}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinejoin="round"
        />
      ),
    );

  const label = (text: string, lx: number, ly: number, anchor: 'start' | 'end', color: string) => (
    <text
      key={`${anchor}${text}`}
      x={lx}
      y={ly + 4}
      fontSize={10.5}
      fill={color}
      textAnchor={anchor}
    >
      {text}
    </text>
  );

  const left = PAD.left - 8;
  const right = W - PAD.right + 8;
  const axisLabels = [
    label('100%', left, yWinrate(1), 'end', 'var(--text-muted)'),
    label('50%', left, yWinrate(0.5), 'end', 'var(--text-muted)'),
    label('0%', left, bottom, 'end', 'var(--text-muted)'),
    label(`+${range}`, right, yWinrate(1), 'start', 'var(--score)'),
    label('0', right, yWinrate(0.5), 'start', 'var(--score)'),
    label(`${MINUS}${range}`, right, bottom, 'start', 'var(--score)'),
  ];
  const leadLine = line(sc, 'scoreLead', 'var(--score)', 1.4);
  const winrateLine = line(wr, 'winrate', 'var(--text)', 1.6);

  const current = nodes[lineIndex] ? lineIndex : null;
  const hovered = hover !== null ? nodes[hover] : null;

  return (
    <div>
      <div className="relative pt-1">
        <svg
          width={W}
          height={height}
          viewBox={`0 0 ${W} ${height}`}
          role="img"
          aria-label={t('analysis.graph.label')}
          className="block cursor-pointer select-none"
          onMouseDown={(event) => {
            dragging.current = null;
            goTo(indexAt(event));
          }}
          onMouseMove={(event) => {
            const i = indexAt(event);
            setHover(i);
            if (dragging.current !== null && event.buttons & 1) goTo(i);
          }}
          onMouseUp={() => (dragging.current = null)}
          onMouseLeave={() => {
            dragging.current = null;
            setHover(null);
          }}
        >
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={yWinrate(0.5)}
            y2={yWinrate(0.5)}
            stroke="var(--hairline)"
          />
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={yWinrate(1)}
            y2={yWinrate(1)}
            stroke="var(--divider-soft)"
          />
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={bottom}
            y2={bottom}
            stroke="var(--divider-soft)"
          />
          {axisLabels}
          {ticks(nodes).map(({ index, label: m }) => (
            <text
              key={m}
              x={x(index)}
              y={height - 4}
              fontSize={9.5}
              fill="var(--line)"
              textAnchor="middle"
            >
              {m}
            </text>
          ))}
          {bars.map(({ index, loss }) => {
            const h = Math.min(18, 3 + 1.2 * loss);
            return (
              <rect
                key={index}
                data-mistake={index}
                x={x(index) - 1}
                y={bottom - h}
                width={2}
                height={h}
                fill="var(--text-muted)"
                opacity={0.7}
              />
            );
          })}
          {leadLine}
          {winrateLine}
          {current !== null && (
            <>
              <line
                data-current
                x1={x(current)}
                x2={x(current)}
                y1={PAD.top - 4}
                y2={bottom}
                stroke="var(--text-muted)"
                strokeDasharray="3 3"
              />
              {plotted(nodes[current]) && (
                <>
                  <circle
                    cx={x(current)}
                    cy={sc(current)}
                    r={3}
                    fill="var(--score)"
                    stroke="var(--panel)"
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={x(current)}
                    cy={wr(current)}
                    r={3.2}
                    fill="var(--text)"
                    stroke="var(--panel)"
                    strokeWidth={1.5}
                  />
                </>
              )}
            </>
          )}
          {hover !== null && hovered && (
            <>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top - 4}
                y2={bottom}
                stroke="var(--text)"
                opacity={0.35}
              />
              {plotted(hovered) && (
                <>
                  <circle cx={x(hover)} cy={sc(hover)} r={2.6} fill="var(--score)" />
                  <circle cx={x(hover)} cy={wr(hover)} r={2.8} fill="var(--text)" />
                </>
              )}
            </>
          )}
        </svg>
        {hover !== null && hovered && (
          <div
            className="pointer-events-none absolute top-[18px] rounded-md border border-hairline bg-pop px-[9px] py-1.5 text-xs leading-[1.55] whitespace-nowrap text-text shadow-lg"
            style={x(hover) < W / 2 ? { left: x(hover) + 10 } : { right: W - x(hover) + 10 }}
          >
            <div>
              {hovered.mover && hovered.move
                ? t('analysis.graph.move', {
                    n: hovered.moveNumber,
                    color: t(`analysis.graph.${hovered.mover}`),
                    point: moveLabel(hovered.move, boardSize, t),
                  })
                : t('analysis.graph.moveOnly', { n: hovered.moveNumber })}
            </div>
            {plotted(hovered) ? (
              <div>
                {t('analysis.graph.winrate', {
                  winrate: formatPercent(hovered.stats!.winrate, lang),
                })}
                {' · '}
                <span className="text-score">
                  {t(
                    hovered.stats!.scoreLead >= 0
                      ? 'analysis.graph.blackLeads'
                      : 'analysis.graph.whiteLeads',
                    { points: Math.abs(hovered.stats!.scoreLead).toFixed(1) },
                  )}
                </span>
              </div>
            ) : (
              <div className="text-text-muted">{t('analysis.graph.notAnalysed')}</div>
            )}
          </div>
        )}
      </div>
      <div
        data-testid="trend-legend"
        className="flex items-center gap-3.5 border-b border-hairline px-6 pt-0.5 pb-3 text-xs text-text-muted"
      >
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-0.5 w-3.5 rounded-[1px] bg-text" />
          {t('analysis.graph.legend.winrate')}
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-0.5 w-3.5 rounded-[1px] bg-score" />
          {t('analysis.graph.legend.scoreLead')}
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-[9px] w-0.5 bg-text-muted opacity-70" />
          {t('analysis.graph.legend.mistake')}
        </span>
      </div>
    </div>
  );
}
