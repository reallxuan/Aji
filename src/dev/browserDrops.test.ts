import { expect, it } from 'vitest';
import { createFakeFiles } from '../platform/fakeFiles';
import type { DragEvent as AjiDrag } from '../platform/files';
import { forwardBrowserDrops } from './browserDrops';

function drag(type: string, file?: File) {
  const event = new Event(type, { cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files: file ? [file] : [] },
  });
  return event;
}

it('forwards a browser drag and drop to the fake files', async () => {
  const files = createFakeFiles();
  const seen: AjiDrag[] = [];
  files.onDrag((event) => seen.push(event));
  const target = new EventTarget() as unknown as Window;
  const stop = forwardBrowserDrops(files, target);

  target.dispatchEvent(drag('dragenter'));
  target.dispatchEvent(drag('dragenter'));
  target.dispatchEvent(drag('dragleave'));
  expect(seen).toEqual([{ kind: 'over' }, { kind: 'over' }]);
  target.dispatchEvent(drag('drop', new File(['(;GM[1])'], 'a.sgf')));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(seen.at(-1)).toEqual({ kind: 'drop', paths: ['/拖入/a.sgf'] });
  await expect(files.openPath('/拖入/a.sgf')).resolves.toMatchObject({ name: 'a.sgf' });
  stop();
});
