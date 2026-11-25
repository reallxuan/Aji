#!/usr/bin/env node
// Makes the wood boards' grain maps (polish design 3) from Poly Haven's CC0 diffuse photographs.
//
//   node scripts/wood-maps.mjs <folder with the 2k JPEGs>
//
// Each map keeps only the photo's grain: its luminance, as a z-score (mean 0, standard deviation
// 1), stored as grey 128 + 32 z, clipped to ±4 deviations. The board's own colour and contrast
// live in `src/board/styles.ts`. The photo's grain runs left to right; the map is turned so it
// runs top to bottom, and cropped to the middle 70%, so no edge of the photo shows on a board.
// See `src/assets/wood/SOURCE.md`.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const MAPS = [
  { board: 'honey', file: 'okoume_veneer_diff_2k.jpg' },
  { board: 'kaya', file: 'ash_veneer_diff_2k.jpg' },
  { board: 'walnut', file: 'natural_walnut_veneer_diff_2k.jpg' },
];
const CROP = 0.7;
const OFFSET = 0.1;
const SCALE = 32;
const QUALITY = 80;
/** The map's side. Boards are drawn at low grain strength, so a smooth upscale hides no detail. */
const SIDE = 1024;

const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/wood-maps.mjs <folder with the 2k JPEGs>');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'wood');

for (const { board, file } of MAPS) {
  const bytes = readFileSync(join(source, file));
  const image = await loadImage(bytes);
  const { width, height } = image;
  const read = createCanvas(width, height).getContext('2d');
  read.drawImage(image, 0, 0);
  const rgba = read.getImageData(0, 0, width, height).data;

  const side = Math.round(width * CROP);
  const x0 = Math.round(width * OFFSET);
  const y0 = Math.round(height * OFFSET);
  // Map pixel (x, y) reads the photo at (y, side - 1 - x): the grain turns to run vertically.
  const lum = new Float32Array(side * side);
  let sum = 0;
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const i = ((y0 + side - 1 - x) * width + (x0 + y)) * 4;
      const v = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      lum[y * side + x] = v;
      sum += v;
    }
  const mean = sum / lum.length;
  let squares = 0;
  for (const v of lum) squares += (v - mean) ** 2;
  const deviation = Math.sqrt(squares / lum.length);

  const canvas = createCanvas(side, side);
  const ctx = canvas.getContext('2d');
  const map = ctx.createImageData(side, side);
  for (let i = 0; i < lum.length; i++) {
    const z = Math.max(-4, Math.min(4, (lum[i] - mean) / deviation));
    const grey = Math.round(128 + SCALE * z);
    map.data[i * 4] = map.data[i * 4 + 1] = map.data[i * 4 + 2] = Math.max(0, Math.min(255, grey));
    map.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(map, 0, 0);
  const small = createCanvas(SIDE, SIDE);
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, SIDE, SIDE);
  const jpeg = await small.encode('jpeg', QUALITY);
  writeFileSync(join(out, `${board}.jpg`), jpeg);
  const sha = createHash('sha256').update(bytes).digest('hex');
  console.log(`${board}: ${file} sha256 ${sha} -> ${board}.jpg ${SIDE}px ${jpeg.length} bytes`);
}
