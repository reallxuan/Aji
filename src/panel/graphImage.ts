import { IMAGE_SCALE, pngBytes } from '../board/snapshotImage';

/** The presentation properties a serialised SVG loses with the page's CSS. */
const PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
] as const;

/**
 * A copy of `svg` whose every element carries its computed presentation as inline style, so the
 * theme's CSS variables survive serialisation.
 */
export function inlineStyles(svg: SVGSVGElement): SVGSVGElement {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((element, i) => {
    const computed = getComputedStyle(element);
    const target = to[i] as SVGElement;
    for (const property of PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  });
  return copy;
}

/**
 * The trend graph as PNG bytes at twice its size (P2 M1 design 5.9), on `background`, the panel's
 * colour in the current theme.
 */
export async function graphImage(svg: SVGSVGElement, background: string): Promise<Uint8Array> {
  const { width, height } = svg.getBoundingClientRect();
  const copy = inlineStyles(svg);
  copy.setAttribute('width', String(width));
  copy.setAttribute('height', String(height));
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * IMAGE_SCALE);
    canvas.height = Math.round(height * IMAGE_SCALE);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await pngBytes(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
