import { useEffect, useSyncExternalStore } from 'react';
import honeyUrl from '../assets/wood/honey.jpg';
import kayaUrl from '../assets/wood/kaya.jpg';
import walnutUrl from '../assets/wood/walnut.jpg';
import type { GrainMapId } from './styles';

/**
 * A wood's grain (polish design 3): its light and dark as z-scores, mean 0 and deviation 1,
 * `side` by `side`, row by row, grain running top to bottom. See `src/assets/wood/SOURCE.md`.
 */
export interface GrainMap {
  side: number;
  z: Float32Array;
}

const URLS: Record<GrainMapId, string> = { honey: honeyUrl, kaya: kayaUrl, walnut: walnutUrl };
const maps = new Map<GrainMapId, GrainMap>();
const listeners = new Set<() => void>();
let version = 0;

export function grainMap(id: GrainMapId): GrainMap | undefined {
  return maps.get(id);
}

/**
 * Registers a map from one grey channel, `side` × `side`. It is renormalised here, so the stored
 * scale (and JPEG rounding) never changes the contrast a board shows.
 */
export function setGrainMap(id: GrainMapId, grey: ArrayLike<number>, side: number): void {
  const n = side * side;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += grey[i];
  const mean = sum / n;
  let squares = 0;
  for (let i = 0; i < n; i++) squares += (grey[i] - mean) ** 2;
  const deviation = Math.sqrt(squares / n) || 1;
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) z[i] = (grey[i] - mean) / deviation;
  maps.set(id, { side, z });
  version++;
  for (const listener of listeners) listener();
}

/** Every 4th byte from `offset`: one channel of RGBA pixels. */
export function channel(rgba: ArrayLike<number>, offset = 0): Uint8Array {
  const out = new Uint8Array(Math.floor(rgba.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + offset];
  return out;
}

let loading: Promise<void> | null = null;

/**
 * Decodes the bundled maps once. Until one arrives its board draws plain; a failure (no image
 * decoding, as in the unit tests) leaves the boards plain and is not retried.
 */
export function loadGrainMaps(): Promise<void> {
  if (loading) return loading;
  loading = Promise.all(
    (Object.keys(URLS) as GrainMapId[]).map(async (id) => {
      if (typeof Image === 'undefined' || typeof document === 'undefined') return;
      const image = new Image();
      image.src = URLS[id];
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx || canvas.width !== canvas.height) return;
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setGrainMap(id, channel(data), canvas.width);
    }),
  ).then(
    () => {},
    () => {},
  );
  return loading;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Starts loading the maps, and counts arrivals, so a board redraws when its grain is ready. */
export function useGrainMapsVersion(): number {
  useEffect(() => void loadGrainMaps(), []);
  return useSyncExternalStore(subscribe, () => version);
}
