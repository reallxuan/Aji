import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { CATCHING_UP_FADE_MS, CATCHING_UP_OPACITY } from '../analysis/constants';
import { formatPercent } from '../analysis/format';
import { barTexts } from '../analysis/trend';
import { useShownCandidates } from '../analysis/useShownCandidates';
import { usePanelWidth } from '../layout/usePanelWidth';

/** The bar's side padding inside the panel. */
const PANEL_PADDING = 24;
/** The bar's text: 13 px semibold, as in the mockup. */
const BAR_FONT = '600 13px Inter, "LXGW WenKai", sans-serif';

function canvasMeasure(): (text: string) => number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return (text) => text.length * 8;
  ctx.font = BAR_FONT;
  return (text) => ctx.measureText(text).width;
}

/** Measures text in the bar's font with a canvas, measuring again once the fonts have loaded. */
function useMeasure(): (text: string) => number {
  const [measure, setMeasure] = useState(canvasMeasure);
  useEffect(() => {
    let active = true;
    document.fonts?.ready.then(
      () => {
        if (active) setMeasure(canvasMeasure);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);
  return measure;
}

/**
 * Black's win rate as a full-width bar (design 5.4): each side's percentage in its own segment,
 * the lead in the leader's when it fits. An empty track until the position has a result.
 * `width` and `measure` are for tests; the panel's width and a canvas measure otherwise.
 */
export function WinrateBar({
  width,
  measure,
}: {
  width?: number;
  measure?: (text: string) => number;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const panelWidth = usePanelWidth();
  const fontMeasure = useMeasure();
  const { current, fading } = useShownCandidates();
  const barWidth = width ?? panelWidth - 2 * PANEL_PADDING;

  const fade: CSSProperties = {
    opacity: fading ? CATCHING_UP_OPACITY : 1,
    transition: `opacity ${CATCHING_UP_FADE_MS}ms`,
  };
  let segments = null;
  if (current) {
    const black = current.winrate;
    const texts = barTexts(
      black,
      current.scoreLead,
      { black: barWidth * black, white: barWidth * (1 - black) },
      measure ?? fontMeasure,
      {
        percent: (x) => formatPercent(x, lang),
        lead: (points) => t('analysis.bar.lead', { points: points.toFixed(1) }),
      },
    );
    // The lead, when shown, is the inner text: second on the black side, first on the white.
    const spans = (list: string[], leadAt: number, leadClass: string) =>
      list.map((text, i) => (
        <span
          key={i}
          style={fade}
          className={list.length === 2 && i === leadAt ? `font-normal ${leadClass}` : ''}
        >
          {text}
        </span>
      ));
    const blackTexts = spans(texts.black, 1, 'text-bar-black-text/70');
    const whiteTexts = spans(texts.white, 0, 'text-bar-white-text/70');
    segments = (
      <>
        <div
          data-segment="black"
          className="flex items-center gap-[9px] overflow-hidden bg-bar-black pl-[9px] whitespace-nowrap text-bar-black-text"
          style={{ width: `${black * 100}%` }}
        >
          {blackTexts}
        </div>
        <div
          data-segment="white"
          className="flex flex-1 items-center justify-end gap-[9px] overflow-hidden bg-bar-white pr-[9px] whitespace-nowrap text-bar-white-text shadow-[inset_0_0_0_1px_var(--bar-edge)]"
        >
          {whiteTexts}
        </div>
      </>
    );
  }

  return (
    <div className="px-6 pt-4 pb-1.5">
      <div
        data-testid="winrate-bar"
        className="flex h-[26px] overflow-hidden rounded-[4px] text-[13px] font-semibold tabular-nums shadow-[inset_0_0_0_1px_var(--bar-edge)]"
      >
        {segments}
      </div>
    </div>
  );
}
