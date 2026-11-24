import { create } from 'zustand';

/** Coordinates measured in grid spacings from the upper left intersection. */
export type Point2 = { x: number; y: number };
export const useFreehandStore = create<{
  strokes: Point2[][];
  add(stroke: Point2[]): void;
  clear(): void;
}>()((set) => ({
  strokes: [],
  add: (stroke) => set(({ strokes }) => ({ strokes: [...strokes, stroke] })),
  clear: () => set({ strokes: [] }),
}));
