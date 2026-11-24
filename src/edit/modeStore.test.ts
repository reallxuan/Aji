import { createI18n } from '../i18n/createI18n';
import { afterEach, expect, it } from 'vitest';
import { useGameStore, resetGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { useModeStore } from './modeStore';

afterEach(() => {
  resetGameStore();
  useModeStore.getState().setMode('normal');
});

it('markup and setup cannot start during try-out, including a try-out rooted at node zero', () => {
  const modes = useModeStore.getState();
  modes.toggle('markup');
  expect(useModeStore.getState().mode).toBe('markup');
  modes.toggle('setup');
  expect(useModeStore.getState().mode).toBe('setup');
  useGameStore.getState().apply(makeSnapshot({ tryout: 0 }));
  expect(useModeStore.getState().mode).toBe('normal');
  modes.setMode('markup');
  modes.toggle('setup');
  expect(useModeStore.getState().mode).toBe('normal');
  useGameStore.getState().apply(makeSnapshot({ revision: 2 }));
  modes.toggle('setup');
  modes.toggle('setup');
  expect(useModeStore.getState().mode).toBe('normal');
});

it('final scoring closes the active edit mode and prevents re-entry while counting', async () => {
  const { useScoringStore } = await import('../scoring/scoringStore');
  const { createEngineStore } = await import('../engine/engineStore');
  const { createFakeTransport } = await import('../transport/fake');
  const transport = createFakeTransport(() => {
    throw new Error('score unavailable');
  });
  useModeStore.getState().setMode('setup');
  await useScoringStore
    .getState()
    .start({ transport, engine: createEngineStore(), t: createI18n('en').t });
  expect(useModeStore.getState().mode).toBe('normal');
  useModeStore.getState().toggle('markup');
  expect(useModeStore.getState().mode).toBe('normal');
  await useScoringStore.getState().exit(transport);
});
