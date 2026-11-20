import type { FakeFiles } from '../platform/fakeFiles';

/**
 * In the development scenarios, a file dragged from the desktop onto the page goes through the
 * fake files as the desktop app's drags do: over, leave, and a drop that puts the file on the
 * fake disk. A browser gives no file name before the drop.
 */
export function forwardBrowserDrops(files: FakeFiles, target: Window = window): () => void {
  let depth = 0;
  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  const enter = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth += 1;
    files.emitDrag({ kind: 'over' });
  };
  const over = (event: DragEvent) => {
    if (carriesFiles(event)) event.preventDefault();
  };
  const leave = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) files.emitDrag({ kind: 'leave' });
  };
  const drop = async (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth = 0;
    const file = event.dataTransfer?.files[0];
    if (!file) {
      files.emitDrag({ kind: 'leave' });
      return;
    }
    const path = `/拖入/${file.name}`;
    files.put(path, await file.text());
    files.emitDrag({ kind: 'drop', paths: [path] });
  };
  target.addEventListener('dragenter', enter);
  target.addEventListener('dragover', over);
  target.addEventListener('dragleave', leave);
  target.addEventListener('drop', drop);
  return () => {
    target.removeEventListener('dragenter', enter);
    target.removeEventListener('dragover', over);
    target.removeEventListener('dragleave', leave);
    target.removeEventListener('drop', drop);
  };
}
