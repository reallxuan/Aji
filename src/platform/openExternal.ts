import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * Opens `url` in the system browser. Only `https:` links are allowed, matching the window's
 * capability (src-tauri/capabilities/default.json); anything else is refused here first, so a bad
 * link fails with a clear error instead of a permission rejection.
 */
export async function openExternal(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`not a URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`only https links open: ${url}`);
  await openUrl(parsed.href);
}
