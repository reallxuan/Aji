/** The honey base tone of the board (interface design 5.1). */
export const WOOD_BASE = { r: 0xdd, g: 0xb0, b: 0x67 };
/** The darker lower edge that gives the board its thickness, in CSS pixels. */
export const LOWER_EDGE = 6;
/** The lit band along the top edge, in CSS pixels. */
const TOP_EDGE = 3;
/** Fixed, so every launch draws the same grain. */
const SEED = 0x41_6a_69;

/** mulberry32: a small, fast PRNG; good enough for texture. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1-D value noise: random values at integer knots, smoothly interpolated, in [-1, 1]. */
function valueNoise(random: () => number, knots: number): (t: number) => number {
  const values = Array.from({ length: knots + 2 }, () => random() * 2 - 1);
  return (t) => {
    const i = Math.floor(t);
    const f = t - i;
    const s = f * f * (3 - 2 * f);
    const a = values[((i % knots) + knots) % knots];
    const b = values[(((i + 1) % knots) + knots) % knots];
    return a + (b - a) * s;
  };
}

/**
 * Brightness offsets for each column of a straight vertical grain: several octaves of value noise
 * across x, from broad bands to fine fibres. Independent of the pixel size, so a board looks the
 * same at any size and ratio.
 */
function grainProfile(width: number, random: () => number): Float32Array {
  const octaves = [
    { period: 0.5, weight: 0.014 },
    { period: 0.07, weight: 0.016 },
    { period: 0.014, weight: 0.018 },
    { period: 0.004, weight: 0.012 },
  ].map(({ period, weight }) => ({ period, weight, noise: valueNoise(random, 256) }));
  const profile = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const u = x / Math.max(1, width);
    let sum = 0;
    for (const { period, weight, noise } of octaves) sum += noise(u / period) * weight;
    // Light falls from the upper left, so the board darkens slightly towards the right.
    profile[x] = sum + 0.02 - 0.045 * u;
  }
  return profile;
}

let cached: { key: string; canvas: HTMLCanvasElement } | null = null;

/**
 * The wood texture for a board of `cssSize` CSS pixels at `dpr`, in device pixels. Generated once
 * per (size, ratio) and cached, since the per-pixel pass is the slow part of a redraw.
 */
export function woodTexture(cssSize: number, dpr: number): HTMLCanvasElement | null {
  const size = Math.round(cssSize * dpr);
  if (size <= 0) return null;
  const key = `${cssSize}@${dpr}`;
  if (cached?.key === key) return cached.canvas;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const random = prng(SEED);
  const profile = grainProfile(size, random);
  // A slow drift along each fibre, so the grain is straight but not ruled.
  const drift = valueNoise(random, 64);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const top = TOP_EDGE * dpr;
  const lower = size - LOWER_EDGE * dpr;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    let edge = 0;
    if (y < top) edge = 0.06 * (1 - y / top);
    else if (y >= lower) edge = -0.16 - 0.06 * ((y - lower) / (size - lower));
    for (let x = 0; x < size; x++) {
      const shade = 1 + profile[x] + drift(x * 0.02 + v * 3) * 0.008 + edge;
      const i = (y * size + x) * 4;
      data[i] = WOOD_BASE.r * shade;
      data[i + 1] = WOOD_BASE.g * shade;
      data[i + 2] = WOOD_BASE.b * shade;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  cached = { key, canvas };
  return canvas;
}
