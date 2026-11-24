import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPercent, formatPoints } from '../analysis/format';
import { boardLead, useBoardKomi } from '../analysis/lead';
import { barTexts } from '../analysis/trend';
import { useShownCandidates } from '../analysis/useShownCandidates';
import { useDeviceStore } from '../device/deviceStore';
import { usePanelWidth } from '../layout/usePanelWidth';
import { EstimateLine } from './EstimateLine';

/** The bar's side padding inside the panel. */
const PANEL_PADDING = 24;
/** The bar's text: 13 px semibold at 100%, as in the mockup; it follows the interface scale. */
const barFont = (scale: number) => `600 ${(13 * scale) / 100}px Inter, "LXGW WenKai", sans-serif`;

function canvasMeasure(scale: number): (text: string) => number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return (text) => (text.length * 8 * scale) / 100;
  ctx.font = barFont(scale);
  return (text) => ctx.measureText(text).width;
}

/**
 * Measures text in the bar's font with a canvas, measuring again once the fonts have loaded and
 * when the interface scale changes.
 */
function useMeasure(): (text: string) => number {
  const scale = useDeviceStore((s) => s.settings.interfaceScale);
  const [measured, setMeasured] = useState(() => ({ scale, measure: canvasMeasure(scale) }));
  if (measured.scale !== scale) setMeasured({ scale, measure: canvasMeasure(scale) });
  useEffect(() => {
    let active = true;
    document.fonts?.ready.then(
      () => {
        if (active) setMeasured({ scale, measure: canvasMeasure(scale) });
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [scale]);
  return measured.measure;
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
  const { current } = useShownCandidates();
  const boardKomi = useBoardKomi();
  const barWidth = width ?? panelWidth - 2 * PANEL_PADDING;

  let segments = null;
  if (current) {
    const black = current.winrate;
    const texts = barTexts(
      black,
      boardKomi === null ? current.scoreLead : boardLead(current.scoreLead, boardKomi, 'black'),
      { black: barWidth * black, white: barWidth * (1 - black) },
      measure ?? fontMeasure,
      {
        percent: (x) => formatPercent(x, lang),
        lead: (points) => t('analysis.bar.lead', { points: formatPoints(points, lang) }),
        even: () => t('analysis.even'),
      },
    );
    // The lead, when shown, is the inner text: second on the black side, first on the white.
    const spans = (list: string[], leadAt: number, leadClass: string) =>
      list.map((text, i) => (
        <span
          key={i}
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
    <>
      <div className="px-6 pt-4 pb-1.5">
        <div
          data-testid="winrate-bar"
          className="flex h-[26px] overflow-hidden rounded-[4px] text-[0.8125rem] font-semibold tabular-nums shadow-[inset_0_0_0_1px_var(--bar-edge)]"
        >
          {segments}
        </div>
      </div>
      <EstimateLine />
    </>
  );
}
