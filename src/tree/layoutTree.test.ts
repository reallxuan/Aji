import { expect, it } from 'vitest';
import { record } from './testing';
import { layoutTree, visibleCells, visibleEdges } from './layoutTree';

it('layout puts the main line in lane 0, nests forks and reuses lanes beyond a finished variation', () => {
  // Main line 0–6, late fork 7, earlier fork 8–9 with nested fork 10, third child 11.
  const tree = record([null, 0, 1, 2, 3, 4, 5, 5, 1, 8, 8, 1]);
  tree.nodes[8] = { ...tree.nodes[8], color: null, mv: null, flags: 5 };
  const layout = layoutTree(tree);
  expect(layout.cells.map((c) => c.lane)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 3]);
  expect(layout.cells[8]).toMatchObject({
    id: 8,
    parent: 1,
    depth: 2,
    moveNumber: 1,
    flags: 5,
    color: null,
  });
  expect(layout.cells[9].moveNumber).toBe(2);
  const window = { from: 1, to: 1, laneFrom: 2, laneTo: 2 };
  expect(visibleCells(layout, window)).toEqual([]);
  expect(visibleEdges(layout, window).map((c) => c.id)).toContain(11);
});

it('layout_of_ten_thousand_nodes_is_fast', () => {
  const parents: (number | null)[] = [null];
  for (let i = 1; i < 9500; i++) parents.push(i - 1);
  for (let i = 0; i < 500; i++) parents.push(9498 - i * 19);
  const tree = record(parents);
  const start = performance.now();
  const layout = layoutTree(tree);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(50);
  expect(layout.cells).toHaveLength(10000);
  expect(layout.lanes).toBe(2);
  expect(visibleCells(layout, { from: 340, to: 350, laneFrom: 0, laneTo: 0 })).toHaveLength(11);
});

it('returns just the visible siblings and bent connectors in a deep lane window', () => {
  // Each root child has two continuations. The elbow from lane 2 to lane 3
  // crosses depth 1 even though its endpoint lies at depth 2.
  const layout = layoutTree(record([null, 0, 1, 1, 0, 4, 4, 0, 7, 7]));
  const w = { from: 1, to: 1, laneFrom: 3, laneTo: 3 };
  expect(visibleCells(layout, w).map((c) => c.id)).toEqual([]);
  expect(visibleEdges(layout, w).map((c) => c.id)).toEqual([6]);
  expect(visibleCells(layout, { ...w, from: 2, to: 2 }).map((c) => c.id)).toEqual([6]);
});
