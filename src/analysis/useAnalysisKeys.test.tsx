import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createEngineStore, EngineStoreProvider, type EngineStore } from '../engine/engineStore';
import { createFakeTransport } from '../transport/fake';
import type { EngineState } from '../transport/generated/EngineState';
import type { Request } from '../transport/generated/Request';
import { TransportProvider } from '../transport/TransportProvider';
import { useAnalysisKeys } from './useAnalysisKeys';
import { resetViewStore, useViewStore } from './viewStore';

afterEach(() => resetViewStore());

function Keys() {
  useAnalysisKeys();
  return <input aria-label="field" />;
}

function mount() {
  const requests: Request[] = [];
  const transport = createFakeTransport((request) => {
    requests.push(request);
    return { type: 'ok' };
  });
  const engine: EngineStore = createEngineStore();
  render(
    <TransportProvider transport={transport}>
      <EngineStoreProvider store={engine}>
        <Keys />
      </EngineStoreProvider>
    </TransportProvider>,
  );
  const set = (state: EngineState) =>
    act(() => engine.getState().applyEvent({ type: 'engineState', engine: state }));
  return { requests, set };
}

const space = (target: Window | Element = window) =>
  fireEvent.keyDown(target, { key: ' ', code: 'Space' });

it('Space pauses, resumes and continues', () => {
  const { requests, set } = mount();
  set({ state: 'analysing', version: '1' });
  space();
  set({ state: 'paused', version: '1' });
  space();
  set({ state: 'ready', version: '1', limitReached: true });
  space();
  set({ state: 'ready', version: '1', limitReached: false });
  space();
  expect(requests.map((r) => r.type)).toEqual([
    'analysisPause',
    'analysisResume',
    'analysisContinue',
  ]);
});

it('Space in a text field types', () => {
  const { requests, set } = mount();
  set({ state: 'analysing', version: '1' });
  space(screen.getByRole('textbox', { name: 'field' }));
  expect(requests).toEqual([]);
});

it('F toggles the candidates, ignoring a held key', () => {
  mount();
  fireEvent.keyDown(window, { key: 'f' });
  expect(useViewStore.getState().hidden).toBe(true);
  fireEvent.keyDown(window, { key: 'f', repeat: true });
  expect(useViewStore.getState().hidden).toBe(true);
  fireEvent.keyDown(window, { key: 'F' });
  expect(useViewStore.getState().hidden).toBe(false);
  fireEvent.keyDown(window, { key: 'f', metaKey: true });
  expect(useViewStore.getState().hidden).toBe(false);
});

it('Z hides the candidates while held', () => {
  mount();
  fireEvent.keyDown(window, { key: 'z' });
  expect(useViewStore.getState().held).toBe(true);
  fireEvent.keyUp(window, { key: 'z' });
  expect(useViewStore.getState().held).toBe(false);
  fireEvent.keyDown(window, { key: 'z' });
  // Leaving the window lets go too, so the candidates never stay hidden.
  fireEvent.blur(window);
  expect(useViewStore.getState().held).toBe(false);
  // ⌘Z is undo, not Z.
  fireEvent.keyDown(window, { key: 'z', metaKey: true });
  expect(useViewStore.getState().held).toBe(false);
});
