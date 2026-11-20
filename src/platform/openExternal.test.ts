import { beforeEach, describe, expect, it, vi } from 'vitest';

const openUrl = vi.fn<(url: string) => Promise<void>>(async () => {});
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (url: string) => openUrl(url) }));

const { openExternal } = await import('./openExternal');

describe('openExternal', () => {
  beforeEach(() => openUrl.mockClear());

  it('opens an https link in the system browser', async () => {
    await openExternal('https://katagotraining.org/');
    expect(openUrl).toHaveBeenCalledWith('https://katagotraining.org/');
  });

  it.each(['http://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url'])(
    'refuses %s',
    async (url) => {
      await expect(openExternal(url)).rejects.toThrow();
      expect(openUrl).not.toHaveBeenCalled();
    },
  );
});
