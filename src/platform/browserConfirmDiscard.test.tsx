import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import { createFakeFiles } from './fakeFiles';
import type { DiscardChoice } from './files';

it.each([
  ['Save', 'save'],
  ['Don’t Save', 'discard'],
  ['Cancel', 'cancel'],
] as const)('the browser prompt returns %s', async (label, expected) => {
  createI18n('en');
  const files = createFakeFiles();
  let result!: Promise<DiscardChoice>;
  await act(async () => {
    result = files.confirmDiscard();
  });
  expect(await screen.findByRole('dialog', { name: 'Save changes to this game?' })).toBeVisible();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: label })));
  await expect(result).resolves.toBe(expected);
  expect(screen.queryByRole('dialog')).toBeNull();
});
