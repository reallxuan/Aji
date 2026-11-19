import { computeFrame } from './frame';

it('matches the 1440 x 900 reference in the interface design', () => {
  expect(computeFrame(1440, 900)).toEqual({
    board: { x: 16, y: 16, size: 868 },
    panel: { x: 900, width: 540 },
  });
});
it('gives extra width to the panel, because height limits the board', () => {
  expect(computeFrame(2560, 1440)).toEqual({
    board: { x: 16, y: 16, size: 1408 },
    panel: { x: 1440, width: 1120 },
  });
});
it('shrinks the board so the panel keeps its minimum width', () => {
  expect(computeFrame(1024, 900)).toEqual({
    board: { x: 16, y: 16, size: 632 },
    panel: { x: 664, width: 360 },
  });
});
it('never returns a negative board size', () => {
  expect(computeFrame(300, 200)).toEqual({
    board: { x: 16, y: 16, size: 0 },
    panel: { x: 32, width: 268 },
  });
});
it('uses whole pixels for the board', () => {
  expect(computeFrame(1440, 900.6).board.size).toBe(868);
});
