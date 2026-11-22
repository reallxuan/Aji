import { type CanvasFactory, domCanvas, type OffscreenCanvasLike } from './canvasFactory';
import { BOARD_STYLES, type BoardStyle } from './styles';

/** `#RRGGBB` as numbers. */
function rgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: n >> 16, g: (n >> 8) & 0xff, b: n & 0xff };
}
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
function grainProfile(
  width: number,
  random: () => number,
  { density, amplitude }: { density: number; amplitude: number },
): Float32Array {
  const octaves = [
    { period: 0.5, weight: 0.014 },
    { period: 0.07, weight: 0.016 },
    { period: 0.014, weight: 0.018 },
    { period: 0.004, weight: 0.012 },
  ].map(({ period, weight }) => ({
    period: period / density,
    weight: weight * amplitude,
    noise: valueNoise(random, 256),
  }));
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

type Texture = HTMLCanvasElement | OffscreenCanvasLike;

/** A few textures: the main board, the sub-boards and the settings' thumbnails at once. */
const CACHE_SIZE = 8;
const cache = new Map<string, { create: CanvasFactory; canvas: Texture }>();

/**
 * The texture of `style` for a board of `cssSize` CSS pixels at `dpr`, in device pixels.
 * Generated once per (style, size, ratio) and cached, since the per-pixel pass is the slow part
 * of a redraw. `create` makes the canvas: a DOM one in the app, a Skia one in the screenshot tests.
 */
export function woodTexture(
  cssSize: number,
  dpr: number,
  create: CanvasFactory = domCanvas,
  style: BoardStyle = BOARD_STYLES.honey,
): Texture | null {
  const size = Math.round(cssSize * dpr);
  if (size <= 0) return null;
  const key = `${style.id}:${cssSize}@${dpr}`;
  const hit = cache.get(key);
  if (hit && hit.create === create) {
    // Most recently used last, so the oldest is the one dropped.
    cache.delete(key);
    cache.set(key, hit);
    return hit.canvas;
  }

  const canvas = create(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const base = rgb(style.base);
  const remember = () => {
    cache.set(key, { create, canvas });
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  };
  if (!style.grain) {
    ctx.fillStyle = style.base;
    ctx.fillRect(0, 0, size, size);
    remember();
    return canvas;
  }

  const random = prng(SEED);
  const profile = grainProfile(size, random, style.grain);
  // A slow drift along each fibre, so the grain is straight but not ruled.
  const drift = valueNoise(random, 64);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  // A flat surface: no lit or dark strip along the edges (M7 design 13.5).
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const shade = 1 + profile[x] + drift(x * 0.02 + v * 3) * 0.008 * style.grain.amplitude;
      const i = (y * size + x) * 4;
      data[i] = base.r * shade;
      data[i + 1] = base.g * shade;
      data[i + 2] = base.b * shade;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  remember();
  return canvas;
}
