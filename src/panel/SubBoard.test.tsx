import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { moveKey } from '../analysis/candidates';
import { candidate, play, subBoardHarness } from '../analysis/subBoardTesting';
import { resetViewStore, useViewStore } from '../analysis/viewStore';
import { useDeviceStore } from '../device/deviceStore';
import { resetGameStore } from '../game/gameStore';
import { LayoutFrame } from '../layout/LayoutFrame';
import { presetLayout } from '../layout/presets';
import { PanelSizeContext } from '../layout/usePanelWidth';
import { SubBoard } from './SubBoard';

afterEach(() => {
  resetGameStore();
  resetViewStore();
});
beforeEach(() => Object.assign(window, { innerWidth: 1440, innerHeight: 900 }));

const settle = () => act(async () => {});
const line = (n: number) => Array.from({ length: n }, (_, i) => play(3 + i, 3 + (i % 2)));
const SECOND = [play(16, 3), play(16, 4), play(15, 3)];

function mount(rank: 1 | 2 | 3) {
  const h = subBoardHarness();
  render(
    <h.wrapper>
      <PanelSizeContext.Provider value={{ width: 300, height: 360 }}>
        <SubBoard rank={rank} />
      </PanelSizeContext.Provider>
    </h.wrapper>,
  );
  return h;
}
const sub = (rank = 1) => document.querySelector(`[data-subboard="${rank}"]`) as HTMLElement;

it('rank 3 without a third candidate shows the position', async () => {
  const { analyse } = mount(3);
  analyse([candidate(0, 0.55, line(3)), candidate(1, 0.52, SECOND)]);
  await settle();
  expect(screen.getByText('无候选')).toBeInTheDocument();
  expect(sub(3).querySelector('canvas')).not.toBeNull();
  expect(sub(3).dataset.lineMove).toBeUndefined();
});

it('the wheel over the sub-board steps its line and does not navigate the game', async () => {
  const { analyse, requests } = mount(1);
  analyse([candidate(0, 0.55, line(4))]);
  await settle();
  expect(sub().dataset.step).toBe('4');
  const board = sub().querySelector('[data-subboard-board]')!;
  fireEvent.wheel(board, { deltaY: -100, deltaMode: 0 });
  expect(sub().dataset.step).toBe('3');
  fireEvent.wheel(board, { deltaY: 100, deltaMode: 0 });
  expect(sub().dataset.step).toBe('4');
  expect(requests.filter((r) => r.type === 'gameNavigate')).toEqual([]);
});

it('with the candidates hidden, the label gives nothing away', async () => {
  const { analyse } = mount(1);
  analyse([candidate(0, 0.55, line(3))]);
  await settle();
  expect(screen.getByRole('button', { name: /D16/ })).toBeInTheDocument();
  for (const hide of [
    { hidden: true, held: false },
    { hidden: false, held: true },
  ]) {
    act(() => useViewStore.setState(hide));
    // Design 5.6: no point, win rate or lead while F or Z hides the answer.
    expect(screen.queryByRole('button', { name: /D16/ })).toBeNull();
    expect(sub().textContent).not.toMatch(/55\.0%/);
    act(() => useViewStore.setState({ hidden: false, held: false }));
  }
});

it('its label shows the line on the main board, as a hover does', async () => {
  const { analyse } = mount(2);
  analyse([candidate(0, 0.55, line(3)), candidate(1, 0.52, SECOND)]);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: /R16/ }));
  expect(useViewStore.getState().hover?.move).toEqual(SECOND[0]);
});

it('in Thinking the hovered line goes to the sub-board and the main board keeps its discs', async () => {
  useDeviceStore.getState().update({ layout: presetLayout('thinking') });
  const h = subBoardHarness();
  render(
    <h.wrapper>
      <LayoutFrame />
    </h.wrapper>,
  );
  h.analyse([candidate(0, 0.55, line(3)), candidate(1, 0.52, SECOND)]);
  await settle();
  expect(sub().dataset.lineMove).toBe(moveKey(line(3)[0]));
  act(() => useViewStore.getState().setHover({ move: SECOND[0], source: 'table' }));
  await settle();
  expect(sub().dataset.lineMove).toBe(moveKey(SECOND[0]));
  const main = document.querySelector('[data-board]') as HTMLElement;
  expect(main.dataset.line).toBeUndefined();
  // Elsewhere the hovered line is the main board's.
  act(() => useDeviceStore.getState().update({ layout: presetLayout('default') }));
  await settle();
  expect(main.dataset.line).toBe('shown');
});

it('names its rank only when the layout has more than one sub-board', async () => {
  // Classic has one sub-board, always the best line, so its label needs no 1 (owner, 2026-11-22).
  useDeviceStore.getState().update({ layout: presetLayout('classic') });
  const { analyse } = mount(1);
  analyse([candidate(0, 0.55, line(3)), candidate(1, 0.52, SECOND)]);
  await settle();
  const label = () => screen.getByRole('button', { name: /D16/ });
  expect(label().querySelector('i')).toBeNull();
  act(() => useDeviceStore.getState().update({ layout: presetLayout('four') }));
  await settle();
  expect(label().querySelector('i')).toHaveTextContent('1');
});
