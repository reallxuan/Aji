// Number formats for the analysis: visits as 1.2k, leads and differences with a true minus.

const MINUS = '−';

function fixed1(n: number, lang: string): string {
  return new Intl.NumberFormat(lang, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  }).format(n);
}

/** `840`, `1.2k`, `3.4M`. */
export function formatVisits(n: number, lang: string): string {
  if (n < 1000) return String(Math.round(n));
  if (Math.round(n / 100) < 10_000) return `${fixed1(n / 1000, lang)}k`;
  return `${fixed1(n / 1_000_000, lang)}M`;
}

/** One decimal, signed, with U+2212 for minus; a value that rounds to zero is `0.0`. */
function signed(n: number, lang: string): string {
  // Intl rounds half away from zero on the magnitude, so −0.95 reads −1.0 as +0.95 reads +1.0.
  const magnitude = fixed1(Math.abs(n), lang);
  if (magnitude === fixed1(0, lang)) return magnitude;
  return `${n > 0 ? '+' : MINUS}${magnitude}`;
}

/** A magnitude with one decimal in the locale's format: `3.5`, or `3,5` in German. */
export function formatPoints(n: number, lang: string): string {
  return fixed1(n, lang);
}

/** A lead that rounds to 0.0 reads 均势 / Even where it is said in words (M7 minor 12). */
export function isEvenLead(n: number): boolean {
  return Math.round(Math.abs(n) * 10) === 0;
}

/** A score lead: `+3.5`, `−1.0`, `0.0`. */
export function formatLead(n: number, lang: string): string {
  return signed(n, lang);
}

/** A fraction as a percentage figure with one decimal and no sign: `37.2`, as on a disc. */
export function formatPercentFigure(x: number, lang: string): string {
  return fixed1(x * 100, lang);
}

/** A fraction as a percentage with one decimal: `37.2%`, or signed: `−1.8%`. */
export function formatPercent(x: number, lang: string, withSign = false): string {
  const points = x * 100;
  return `${withSign ? signed(points, lang) : fixed1(points, lang)}%`;
}
