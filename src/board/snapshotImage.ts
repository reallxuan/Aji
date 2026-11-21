import { asImage, type CanvasFactory, domCanvas } from './canvasFactory';

/** Screenshots are drawn at twice the CSS size (P2 M1 design 5.9). */
export const IMAGE_SCALE = 2;

/** A canvas's pixels as PNG bytes. */
export function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('the canvas made no image'));
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, 'image/png'),
  );
}

/**
 * The board as it is shown, as PNG bytes (P2 M1 design 5.9): the layers of the `BoardCanvas`
 * under `host` (wood and grid, stones, then discs or a shown line's numbers), composited at
 * twice the CSS size. `make` is for tests.
 */
export async function boardImage(
  host: HTMLElement,
  make: CanvasFactory = domCanvas,
): Promise<Uint8Array> {
  const layers = [...host.querySelectorAll('canvas')];
  const css = parseFloat(layers[0]?.style.width ?? '0');
  if (!(css > 0)) throw new Error('no board to capture');
  const side = Math.round(css * IMAGE_SCALE);
  const out = make(side, side) as HTMLCanvasElement;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  for (const layer of layers) ctx.drawImage(asImage(layer), 0, 0, side, side);
  return pngBytes(out);
}
