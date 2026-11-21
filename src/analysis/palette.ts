// The candidate disc and chip palette of interface design 5.3: the one place outside the theme
// tokens that names colours. Discs sit on the wood in both themes, so the palette has no dark
// variant.
import type { Tier } from './candidates';

export interface TierStyle {
  fill: string;
  fillAlpha: number;
  ring: string;
  ringAlpha: number;
  /** In pixels at the board's 19×19 scale. */
  ringWidth: number;
  text: string;
  bold: boolean;
  shadow: boolean;
}

export const TIER_STYLE: Record<Tier, TierStyle> = {
  best: {
    fill: '#FDF6E3',
    fillAlpha: 1,
    ring: '#B8321F',
    ringAlpha: 1,
    ringWidth: 3.5,
    text: '#2B1D0E',
    bold: true,
    shadow: true,
  },
  close: {
    fill: '#FBF1D9',
    fillAlpha: 1,
    ring: '#B8321F',
    ringAlpha: 1,
    ringWidth: 1.5,
    text: '#2B1D0E',
    bold: false,
    shadow: false,
  },
  doubtful: {
    fill: '#FBF1D9',
    fillAlpha: 0.85,
    ring: '#8A6A32',
    ringAlpha: 1,
    ringWidth: 1.5,
    text: '#4A3410',
    bold: false,
    shadow: false,
  },
  poor: {
    fill: '#FBF1D9',
    fillAlpha: 0.5,
    ring: '#8A6A32',
    ringAlpha: 0.6,
    ringWidth: 1,
    text: '#4A3410',
    bold: false,
    shadow: false,
  },
};

/** The outer ring of the move actually played next. */
export const PLAYED_RING = { color: '#2B1D0E', width: 2.5 };

/**
 * Chip fills off the board: the solid colour each translucent fill shows over the wood
 * (`#DDB067`), so a chip on the panel does not turn grey.
 */
export const CHIP_FILL: Record<Tier, string> = {
  best: '#FDF6E3',
  close: '#FBF1D9',
  doubtful: '#F8EAC9',
  poor: '#ECD0A0',
};

/** The best chip's ring is thinner than the best disc's: the chip is a 21 px circle. */
export const CHIP_BEST_RING_WIDTH = 2.5;

/** `#RRGGBB` at `alpha`, as an `rgba()` colour. */
export function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
