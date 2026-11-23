import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it } from 'vitest';
import { useDeviceStore } from '../device/deviceStore';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { createI18n } from '../i18n/createI18n';
import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';
import type { EngineState } from '../transport/generated/EngineState';
import { WinrateBar } from './WinrateBar';

afterEach(() => resetGameStore());

const KEY = 'abababababababab';

function analysis(overrides: Partial<AnalysisUpdate> = {}): AnalysisUpdate {
  return {
    position: KEY,
    boardSize: 19,
    rootVisits: 3104,
    winrate: 0.69,
    scoreLead: 3.5,
    isFinal: false,
    candidates: [],
    previousVisits: 0,
    ownership: null,
    ...overrides,
  };
}

function mount(
  update: AnalysisUpdate | null,
  width = 492,
  measure = (t: string) => t.length * 7,
  state: EngineState = { state: 'analysing', version: '1.18.2' },
  lang: 'zh-CN' | 'en' = 'zh-CN',
) {
  const engine = createEngineStore();
  engine.getState().applyEvent({ type: 'engineState', engine: state });
  useGameStore.getState().bindEngine(engine);
  useGameStore.getState().apply(makeSnapshot({ revision: 1, positionKey: KEY }));
  if (update) engine.getState().applyEvent({ type: 'analysisUpdate', analysis: update });
  render(
    <I18nextProvider i18n={createI18n(lang)}>
      <EngineStoreProvider store={engine}>
        <WinrateBar width={width} measure={measure} />
      </EngineStoreProvider>
    </I18nextProvider>,
  );
  return engine;
}

const segment = (side: 'black' | 'white') =>
  document.querySelector<HTMLElement>(`[data-segment="${side}"]`)!;

it('puts the lead in the leader’s segment', () => {
  mount(analysis());
  expect(segment('black')).toHaveStyle({ width: '69%' });
  expect(segment('black')).toHaveTextContent('69.0%领先 3.5 目');
  expect(segment('white')).toHaveTextContent(/^31\.0%$/);
});

it('puts White’s lead in White’s segment', () => {
  mount(analysis({ winrate: 0.382, scoreLead: -2.1 }));
  expect(segment('white')).toHaveTextContent('领先 2.1 目61.8%');
  expect(segment('black')).toHaveTextContent(/^38\.2%$/);
});

it('hides the lead when the segment is too narrow', () => {
  // A 360 px panel leaves a 311 px bar; 55% of it cannot hold both texts at 12 px a character.
  mount(analysis({ winrate: 0.55 }), 311, (t) => t.length * 12);
  expect(segment('black')).toHaveTextContent(/^55\.0%$/);
  expect(screen.queryByText(/领先/)).toBeNull();
});

it('shows an empty track before any result', () => {
  mount(null);
  expect(document.querySelector('[data-segment]')).toBeNull();
  expect(screen.getByTestId('winrate-bar')).toBeInTheDocument();
  expect(screen.queryByText(/%/)).toBeNull();
});

it('fades the numbers while a new search catches up', () => {
  const engine = mount(analysis({ rootVisits: 640, previousVisits: 1000 }));
  for (const text of document.querySelectorAll<HTMLElement>('[data-segment] span'))
    expect(text).toHaveStyle({ opacity: '0.6' });
  act(() =>
    engine.getState().applyEvent({
      type: 'analysisUpdate',
      analysis: analysis({ rootVisits: 1100, previousVisits: 1000 }),
    }),
  );
  for (const text of document.querySelectorAll<HTMLElement>('[data-segment] span'))
    expect(text).toHaveStyle({ opacity: '1' });
});

it('the bar is not faded while paused', () => {
  mount(analysis({ rootVisits: 640, previousVisits: 1000 }), 492, undefined, {
    state: 'paused',
    version: '1.18.2',
  });
  for (const text of document.querySelectorAll<HTMLElement>('[data-segment] span'))
    expect(text).toHaveStyle({ opacity: '1' });
});

it('even_lead_reads_even_in_both_languages', () => {
  mount(analysis({ winrate: 0.52, scoreLead: 0.04 }));
  // The even lead goes to the side ahead on win rate.
  expect(segment('black')).toHaveTextContent('52.0%均势');
  cleanup();
  resetGameStore();
  mount(analysis({ winrate: 0.48, scoreLead: -0.02 }), 492, undefined, undefined, 'en');
  expect(segment('white')).toHaveTextContent('Even52.0%');
});

it('the bar’s lead is the board count with the score option', () => {
  useDeviceStore.getState().update({ scoreWithKomi: false });
  // White leads by 3 with komi; on the board Black is 4.5 ahead (komi 7.5).
  mount(analysis({ winrate: 0.4, scoreLead: -3 }));
  expect(segment('black')).toHaveTextContent('40.0%领先 4.5 目');
  expect(segment('white')).toHaveTextContent(/^60\.0%$/);
});
