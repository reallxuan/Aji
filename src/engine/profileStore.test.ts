import { act, renderHook, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { resetEstimateStore, useEstimateStore } from '../analysis/estimateStore';
import { COMMANDS, type CommandContext } from '../commands/registry';
import type { ActionContext } from '../game/actions';
import { resetJobStore, useJobStore } from '../job/jobStore';
import { createFakeFiles } from '../platform/fakeFiles';
import { createFakeTransport } from '../transport/fake';
import { TransportProvider } from '../transport/TransportProvider';
import type { JobProgress } from '../transport/generated/JobProgress';
import type { ProfileSummary } from '../transport/generated/ProfileSummary';
import type { Request } from '../transport/generated/Request';
import type { ScoreView } from '../transport/generated/ScoreView';
import {
  resetProfileStore,
  switchProfileAsking,
  useProfileStore,
  useProfileSync,
  useSwitchQuestion,
} from './profileStore';

afterEach(() => {
  resetProfileStore();
  resetJobStore();
  resetEstimateStore();
});

const managed = (id: string, current: boolean): ProfileSummary => ({
  id,
  name: id,
  current,
  source: {
    kind: 'managed',
    engine: 'eng',
    version: '1.18.2',
    backend: 'metal',
    network: id,
    networkName: id,
    threads: 16,
    visitsPerSecond: null,
  },
});

/** A backend with three profiles that records what it is asked. */
function backend() {
  let current = 'a';
  const sent: Request[] = [];
  const transport = createFakeTransport((request) => {
    sent.push(request);
    switch (request.type) {
      case 'engineProfiles':
        return {
          type: 'engineProfiles',
          profiles: ['a', 'b', 'c'].map((id) => managed(id, id === current)),
          devOverride: false,
        };
      case 'engineProfileSwitch':
        current = request.id;
        return { type: 'ok' };
      default:
        return { type: 'ok' };
    }
  });
  const ctx: ActionContext = {
    transport,
    files: createFakeFiles(),
    t: ((key: string) => key) as unknown as TFunction,
  };
  return {
    transport,
    sent,
    ctx,
    switched: () => sent.filter((r) => r.type === 'engineProfileSwitch'),
  };
}

const running: JobProgress = {
  state: 'running',
  done: 64,
  total: 213,
  boostDone: 0,
  boostTotal: 0,
  working: null,
  queued: [],
  etaSeconds: null,
};

it('loads the profiles and whether the development engine overrides them', async () => {
  const { transport } = backend();
  await useProfileStore.getState().load(transport);
  expect(useProfileStore.getState().profiles.map((p) => [p.id, p.current])).toEqual([
    ['a', true],
    ['b', false],
    ['c', false],
  ]);
  expect(useProfileStore.getState().devOverride).toBe(false);
});

it('switches at once when no job runs, and drops the old network estimate', async () => {
  const { ctx, switched } = backend();
  useEstimateStore.setState({ on: true, score: { suggestedDead: [] } as unknown as ScoreView });
  await switchProfileAsking(ctx, 'b');
  expect(switched()).toEqual([{ type: 'engineProfileSwitch', id: 'b' }]);
  expect(useSwitchQuestion.getState().pending).toBeNull();
  // The estimate stays on, and is counted again from the new network's ownership.
  expect(useEstimateStore.getState()).toMatchObject({ on: true, score: null });
  expect(useProfileStore.getState().profiles.find((p) => p.current)?.id).toBe('b');
});

it('asks first while a whole-game job runs, and switches only on yes', async () => {
  const { ctx, switched } = backend();
  await useProfileStore.getState().load(ctx.transport);
  useJobStore.getState().apply(running);
  await switchProfileAsking(ctx, 'c');
  expect(switched()).toEqual([]);
  expect(useSwitchQuestion.getState().pending).toMatchObject({
    id: 'c',
    name: 'c',
    done: 64,
    total: 213,
  });

  await useSwitchQuestion.getState().answer(false);
  expect(switched()).toEqual([]);
  expect(useSwitchQuestion.getState().pending).toBeNull();

  await switchProfileAsking(ctx, 'c');
  await useSwitchQuestion.getState().answer(true);
  expect(switched()).toEqual([{ type: 'engineProfileSwitch', id: 'c' }]);
  expect(useSwitchQuestion.getState().pending).toBeNull();
});

it('leaves the profile already running alone, without asking', async () => {
  // The chip's menu reports a choice of its checked entry too.
  const { ctx, switched } = backend();
  await useProfileStore.getState().load(ctx.transport);
  useJobStore.getState().apply(running);
  await switchProfileAsking(ctx, 'a');
  expect(switched()).toEqual([]);
  expect(useSwitchQuestion.getState().pending).toBeNull();
});

it('steps to the next and previous profile, wrapping around', async () => {
  const { ctx, switched } = backend();
  await useProfileStore.getState().load(ctx.transport);
  const command = { actions: ctx } as unknown as CommandContext;
  COMMANDS.get('engine.profile.previous')!.run(command, 'down');
  await waitFor(() => expect(switched()).toEqual([{ type: 'engineProfileSwitch', id: 'c' }]));
  COMMANDS.get('engine.profile.next')!.run(command, 'down');
  await waitFor(() => expect(switched().at(-1)).toEqual({ type: 'engineProfileSwitch', id: 'a' }));
});

it('reloads on start and after an install job ends', async () => {
  const { transport, sent } = backend();
  renderHook(() => useProfileSync(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(TransportProvider, { transport, children }),
  });
  const loads = () => sent.filter((r) => r.type === 'engineProfiles').length;
  await waitFor(() => expect(loads()).toBe(1));
  const job = {
    id: 1,
    engine: 'eng',
    backend: 'metal' as const,
    network: 'n',
    tasks: [],
    outcome: null,
    measures: false,
    benchmark: null,
  };
  act(() => transport.emit({ type: 'setupProgress', job }));
  expect(loads()).toBe(1);
  act(() =>
    transport.emit({ type: 'setupProgress', job: { ...job, outcome: { outcome: 'installed' } } }),
  );
  await waitFor(() => expect(loads()).toBe(2));
});
