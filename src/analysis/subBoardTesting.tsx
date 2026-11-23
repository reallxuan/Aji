import { act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createEngineStore, EngineStoreProvider } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { createI18n } from '../i18n/createI18n';
import { createFakeFiles } from '../platform/fakeFiles';
import { PlatformProvider } from '../platform/PlatformProvider';
import { createFakeTransport } from '../transport/fake';
import type { Candidate } from '../transport/generated/Candidate';
import type { Move } from '../transport/generated/Move';
import type { Request } from '../transport/generated/Request';
import type { Response } from '../transport/generated/Response';
import { TransportProvider } from '../transport/TransportProvider';

export const KEY = 'abababababababab';
export const play = (x: number, y = 3): Move => ({ type: 'play', x, y });

/** A candidate of `order` whose line is `pv` (its first move is the candidate's). */
export function candidate(order: number, winrate: number, pv: Move[]): Candidate {
  return {
    move: pv[0],
    order,
    visits: 1200 - order * 200,
    winrate,
    scoreLead: (winrate - 0.5) * 20,
    prior: 0.1,
    pv,
  };
}

/**
 * Providers for the sub-board: a transport that answers previews (and counts them), an engine
 * store that analyses, and a game at `KEY` with Black to move.
 */
export function subBoardHarness(answer?: (request: Request) => Response | undefined) {
  const requests: Request[] = [];
  const transport = createFakeTransport((request): Response => {
    requests.push(request);
    const answered = answer?.(request);
    if (answered) return answered;
    if (request.type === 'gamePreview')
      return {
        type: 'gamePreview',
        preview: {
          stones: Array.from({ length: 361 }, () => null),
          captured: request.moves.map(() => []),
          illegalAt: null,
        },
      };
    if (request.type === 'appInfo')
      return { type: 'appInfo', version: '0.1.0', os: 'macos', arch: 'aarch64' };
    return { type: 'ok' };
  });
  const engine = createEngineStore();
  engine
    .getState()
    .applyEvent({ type: 'engineState', engine: { state: 'analysing', version: '1' } });
  useGameStore.getState().bindEngine(engine);
  useGameStore.getState().apply(makeSnapshot({ revision: 1, positionKey: KEY }));
  const i18n = createI18n('zh-CN');
  const files = createFakeFiles();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <TransportProvider transport={transport}>
        <EngineStoreProvider store={engine}>
          <PlatformProvider files={files}>{children}</PlatformProvider>
        </EngineStoreProvider>
      </TransportProvider>
    </I18nextProvider>
  );
  const analyse = (candidates: Candidate[], position = KEY) =>
    act(() =>
      engine.getState().applyEvent({
        type: 'analysisUpdate',
        analysis: {
          position,
          boardSize: 19,
          rootVisits: 3000,
          winrate: candidates[0]?.winrate ?? 0.5,
          scoreLead: 0,
          isFinal: false,
          candidates,
          previousVisits: 0,
          ownership: null,
          next: null,
        },
      }),
    );
  const previews = () => requests.filter((r) => r.type === 'gamePreview');
  return { requests, wrapper, analyse, previews, engine, transport };
}
