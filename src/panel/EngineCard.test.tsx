import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it } from 'vitest';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { createI18n } from '../i18n/createI18n';
import { useSettingsStore } from '../settings/settingsStore';
import { createFakeTransport } from '../transport/fake';
import type { EngineState } from '../transport/generated/EngineState';
import type { Request } from '../transport/generated/Request';
import type { RunningEngine } from '../transport/generated/RunningEngine';
import { TransportProvider } from '../transport/TransportProvider';
import { EngineCard } from './EngineCard';

afterEach(() => {
  resetGameStore();
  useSettingsStore.setState({ settings: null });
});

const KEY = 'abababababababab';
const METAL: RunningEngine = {
  backend: 'metal',
  networkName: 'kata1-b28c512nbt-s9584861952-d4960414494',
};

function mount(
  engine: EngineState,
  options: { running?: RunningEngine | null; visits?: number; speed?: [number, number][] } = {},
) {
  const requests: Request[] = [];
  const running = options.running === undefined ? METAL : options.running;
  const transport = createFakeTransport((request) => {
    requests.push(request);
    return {
      type: 'engineStatus',
      engine,
      position: KEY,
      analysis: null,
      rejected: null,
      running,
    };
  });
  let now = 0;
  const store = createEngineStore(() => now);
  useGameStore.getState().bindEngine(store);
  useGameStore.getState().apply(makeSnapshot({ revision: 1, positionKey: KEY }));
  useSettingsStore.setState({
    settings: {
      language: 'system',
      theme: 'system',
      discLines: ['winrate', 'scoreLead'],
      visitLimit: 10_000,
      defaultRules: { kind: 'chinese' },
      showCoordinates: true,
      perspective: 'black',
    },
  });
  store.getState().applyEvent({ type: 'engineState', engine });
  for (const [at, visits] of options.speed ?? [[0, options.visits ?? 3104]]) {
    now = at;
    store.getState().applyEvent({
      type: 'analysisUpdate',
      analysis: {
        position: KEY,
        boardSize: 19,
        rootVisits: visits,
        winrate: 0.5,
        scoreLead: 0,
        isFinal: false,
        candidates: [],
        previousVisits: 0,
      },
    });
  }
  render(
    <I18nextProvider i18n={createI18n('zh-CN')}>
      <TransportProvider transport={transport}>
        <EngineStoreProvider store={store}>
          <EngineCard />
        </EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>,
  );
  return requests;
}

const row = (label: string) => screen.getByText(label).parentElement!;

it('shows the speed, visits, engine, network and the pause hint while analysing', async () => {
  mount(
    { state: 'analysing', version: '1.18.2' },
    {
      speed: [
        [0, 1864],
        [1000, 3104],
      ],
    },
  );
  expect(screen.getByText('分析中')).toBeInTheDocument();
  expect(row('速度')).toHaveTextContent('1,240 次/秒');
  expect(row('计算量')).toHaveTextContent('3,104');
  await waitFor(() => expect(row('引擎')).toHaveTextContent('KataGo 1.18.2 · Metal'));
  // Truncated in the middle to 24 characters.
  expect(row('网络')).toHaveTextContent('kata1-b28c51…d4960414494');
  expect(screen.getByText('点击暂停')).toBeInTheDocument();
});

it('shows the continue hint with the limit when stopped at it', async () => {
  mount({ state: 'ready', version: '1.18.2', limitReached: true }, { visits: 10_000 });
  expect(screen.getByText('已达到每步上限')).toBeInTheDocument();
  expect(row('计算量')).toHaveTextContent('10,000 / 10,000');
  expect(screen.queryByText('速度')).toBeNull();
  expect(screen.getByText('点击继续计算 10,000 次')).toBeInTheDocument();
});

it('names a development engine without a backend', async () => {
  mount(
    { state: 'paused', version: '1.18.2' },
    { running: { backend: null, networkName: 'b18c384nbt.bin.gz' } },
  );
  await waitFor(() => expect(row('网络')).toHaveTextContent('b18c384nbt.bin.gz'));
  expect(row('引擎')).toHaveTextContent(/^引擎KataGo 1\.18\.2$/);
  expect(screen.getByText('已暂停')).toBeInTheDocument();
  expect(screen.getByText('点击继续')).toBeInTheDocument();
});

it('asks for the engine status when it opens', async () => {
  const requests = mount({ state: 'analysing', version: '1.18.2' });
  await waitFor(() => expect(requests).toEqual([{ type: 'engineStatus' }]));
});
