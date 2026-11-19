import { getAppInfo } from './api';
import { createFakeTransport } from './fake';
import type { Response } from './generated/Response';

it('rejects an unexpected response type', async () => {
  const t = createFakeTransport(() => ({ type: 'somethingElse' }) as unknown as Response);
  await expect(getAppInfo(t)).rejects.toMatchObject({ code: 'internal' });
});
