import { type CanvasFactory, domCanvas, type OffscreenCanvasLike } from './canvasFactory';
import { grainMap, type GrainMap } from './grainMaps';
import { BOARD_STYLES, type BoardStyle, DEFAULT_GRAIN_STRENGTH } from './styles';

/** `#RRGGBB` as numbers. */
function rgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: n >> 16, g: (n >> 8) & 0xff, b: n & 0xff };
}
/**
 * The finish over a wood board (polish design 3), as a brightness factor and a sheen at `u`, `v`
 * in 0..1 from the upper left: light falls from the upper left and fades past the middle, the
 * corners darken a little, and the varnish catches a broad band of light across the upper left
 * and a faint one lower down. `sheen` is added, as a share of white.
 */
function finish(u: number, v: number): { light: number; sheen: number } {
  const t = (u + v) / 2;
  const light = t < 0.5 ? 0.07 * (1 - t / 0.5) : -0.07 * ((t - 0.5) / 0.5);
  const dx = u - 0.46;
  const dy = v - 0.45;
  const r = Math.sqrt(dx * dx + dy * dy) / 0.62;
  const edge = Math.min(1, Math.max(0, (r - 0.55) / 0.45));
  const vignette = -0.05 * edge * edge * (3 - 2 * edge);
  const band = (centre: number, width: number) => Math.exp(-(((t - centre) / width) ** 2));
  return { light: 1 + light + vignette, sheen: 0.045 * band(0.28, 0.1) + 0.02 * band(0.78, 0.08) };
}

/**
 * The finish for a board `size` device pixels square, row by row. It depends on the size alone, so
 * dragging the grain slider or switching boards reuses it; a few sizes are kept (main board,
 * sub-boards, thumbnails).
 */
const finishes = new Map<number, { light: Float32Array; sheen: Float32Array }>();
function finishFor(size: number): { light: Float32Array; sheen: Float32Array } {
  const hit = finishes.get(size);
  if (hit) return hit;
  const light = new Float32Array(size * size);
  const sheen = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const f = finish((x + 0.5) / size, (y + 0.5) / size);
      light[y * size + x] = f.light;
      sheen[y * size + x] = f.sheen;
    }
  const made = { light, sheen };
  finishes.set(size, made);
  if (finishes.size > 4) finishes.delete(finishes.keys().next().value!);
  return made;
}

/** The map's value at `u`, `v` in 0..1, interpolated between its four nearest pixels. */
function sample(map: GrainMap, u: number, v: number): number {
  const last = map.side - 1;
  const x = Math.min(last, Math.max(0, u * last));
  const y = Math.min(last, Math.max(0, v * last));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(last, x0 + 1);
  const y1 = Math.min(last, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const z = map.z;
  const top = z[y0 * map.side + x0] * (1 - fx) + z[y0 * map.side + x1] * fx;
  const bottom = z[y1 * map.side + x0] * (1 - fx) + z[y1 * map.side + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

type Texture = HTMLCanvasElement | OffscreenCanvasLike;

/** A few textures: the main board, the sub-boards and the settings' thumbnails at once. */
const CACHE_SIZE = 8;
const cache = new Map<string, { create: CanvasFactory; canvas: Texture }>();

/**
 * The texture of `style` for a board of `cssSize` CSS pixels at `dpr`, in device pixels: the base
 * colour, shaded by the photographed grain at `strength` (0 to 1) and the finish. Generated once
 * per (style, size, ratio, strength, grain loaded) and cached, since the per-pixel pass is the
 * slow part of a redraw. A wood whose grain map has not loaded yet draws plain, with its finish.
 * `create` makes the canvas: a DOM one in the app, a Skia one in the screenshot tests.
 */
export function woodTexture(
  cssSize: number,
  dpr: number,
  create: CanvasFactory = domCanvas,
  style: BoardStyle = BOARD_STYLES.honey,
  strength: number = DEFAULT_GRAIN_STRENGTH,
): Texture | null {
  const size = Math.round(cssSize * dpr);
  if (size <= 0) return null;
  const map = style.grain ? grainMap(style.grain.map) : undefined;
  const key = `${style.id}:${cssSize}@${dpr}:${strength}:${map ? 'grain' : 'plain'}`;
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

  const depth = map ? style.grain.contrast * Math.min(1, Math.max(0, strength)) : 0;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const { light, sheen: sheens } = finishFor(size);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const p = y * size + x;
      const sheen = sheens[p];
      const shade = (1 + (map && depth ? sample(map, u, v) * depth : 0)) * light[p];
      const white = 255 * sheen;
      const i = p * 4;
      data[i] = base.r * shade * (1 - sheen) + white;
      data[i + 1] = base.g * shade * (1 - sheen) + white;
      data[i + 2] = base.b * shade * (1 - sheen) + white;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  remember();
  return canvas;
}
