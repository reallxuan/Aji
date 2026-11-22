import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useDeviceStore } from '../device/deviceStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { candidate, KEY, play, subBoardHarness } from './subBoardTesting';
import { useShownCandidates } from './useShownCandidates';
import { resetViewStore } from './viewStore';

afterEach(() => {
  resetGameStore();
  resetViewStore();
});

function Probe() {
  const { shown } = useShownCandidates();
  return <output>{shown.map((c) => `${c.winrate.toFixed(2)} ${c.scoreLead.toFixed(1)}`)}</output>;
}

function mount() {
  const h = subBoardHarness();
  act(() =>
    useGameStore
      .getState()
      .apply(makeSnapshot({ revision: 2, positionKey: KEY, nextColor: 'white' })),
  );
  render(
    <h.wrapper>
      <Probe />
    </h.wrapper>,
  );
  // Black's 70% and +4.0 (KataGo reports Black's numbers).
  h.analyse([candidate(0, 0.7, [play(3)])]);
}

it('discs_show_the_side_to_move_with_white_to_play', () => {
  // The legend's toggle stays on Black: it is the graph's, not the discs'.
  expect(useDeviceStore.getState().settings.perspective).toBe('black');
  mount();
  expect(screen.getByRole('status')).toHaveTextContent('0.30 -4.0');
});

it('the score option shows the side to move’s board count', () => {
  useDeviceStore.getState().update({ scoreWithKomi: false });
  mount();
  // White's −4.0 with komi is −11.5 on the board under Chinese rules (komi 7.5).
  expect(screen.getByRole('status')).toHaveTextContent('0.30 -11.5');
});
