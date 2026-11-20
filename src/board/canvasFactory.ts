/** The part of a canvas the board's drawing code uses, so tests can pass a Skia canvas. */
export interface OffscreenCanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

/** Makes a scratch canvas of `width × height` device pixels. */
export type CanvasFactory = (
  width: number,
  height: number,
) => HTMLCanvasElement | OffscreenCanvasLike;

/** A DOM canvas: what the app draws with. */
export const domCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** `canvas` as something `drawImage` takes. A Skia canvas is one too, though its type says not. */
export function asImage(canvas: HTMLCanvasElement | OffscreenCanvasLike): CanvasImageSource {
  return canvas as CanvasImageSource;
}
