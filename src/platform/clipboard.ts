/**
 * Copies PNG bytes to the clipboard (P2 M1 design 5.9); `false` when the webview cannot. The
 * clipboard item is made at once, around a promise of the bytes: WebKit accepts a write only
 * while the click that asked for it is still being handled, and drawing the image takes longer.
 */
export async function copyImage(bytes: Promise<Uint8Array>): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard?.write || typeof ClipboardItem === 'undefined') {
    bytes.catch(() => {});
    return false;
  }
  try {
    const blob = bytes.then((b) => new Blob([b as BlobPart], { type: 'image/png' }));
    await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
