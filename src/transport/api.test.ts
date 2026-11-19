import { getAppInfo, getEngineStatus, pauseAnalysis, restartEngine, resumeAnalysis } from './api';
import { createFakeTransport } from './fake';
import type { Response } from './generated/Response';

it('rejects an unexpected response type', async () => {
  const t = createFakeTransport(() => ({ type: 'somethingElse' }) as unknown as Response);
  await expect(getAppInfo(t)).rejects.toMatchObject({ code: 'internal' });
});

it('sends each engine request and checks the response type', async () => {
  const sent: unknown[] = [];
  const t = createFakeTransport((request) => {
    sent.push(request);
    return request.type === 'engineStatus'
      ? { type: 'engineStatus', engine: { state: 'starting' } }
      : { type: 'ok' };
  });
  await expect(getEngineStatus(t)).resolves.toEqual({ state: 'starting' });
  await pauseAnalysis(t);
  await resumeAnalysis(t);
  await restartEngine(t);
  expect(sent).toEqual([
    { type: 'engineStatus' },
    { type: 'analysisPause' },
    { type: 'analysisResume' },
    { type: 'engineRestart' },
  ]);
});

it('rejects an unexpected engine response type', async () => {
  const t = createFakeTransport(() => ({ type: 'appInfo' }) as unknown as Response);
  await expect(getEngineStatus(t)).rejects.toMatchObject({ code: 'internal' });
  await expect(pauseAnalysis(t)).rejects.toMatchObject({ code: 'internal' });
});
