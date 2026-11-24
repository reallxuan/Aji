import { expect, it } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import { COMMANDS } from './registry';

it('every command has a label in both languages', () => {
  for (const language of ['zh-CN', 'en'] as const) {
    const i18n = createI18n(language);
    for (const command of COMMANDS.values()) expect(i18n.exists(command.labelKey)).toBe(true);
  }
});

it('t toggles the estimate', async () => {
  const { defaultKeymap } = await import('./keymap');
  const { useEstimateStore } = await import('../analysis/estimateStore');
  const { runCommand, setCommandContext } = await import('./registry');
  for (const os of ['macos', 'windows', null] as const) {
    const keymap = defaultKeymap(os);
    expect(keymap.get('T'), String(os)).toBe('estimate.toggle');
    // ⌘⇧A belongs to the macOS menu bar; no other system has a key for it.
    expect([...keymap.values()]).not.toContain('analysis.game');
  }
  setCommandContext({} as Parameters<typeof setCommandContext>[0]);
  expect(useEstimateStore.getState().on).toBe(false);
  runCommand('estimate.toggle');
  expect(useEstimateStore.getState().on).toBe(true);
  runCommand('estimate.toggle');
  expect(useEstimateStore.getState().on).toBe(false);
  setCommandContext(null);
});

it('recognises editing, export and view commands in a device keymap', async () => {
  const { resolveKeymap } = await import('./keymap');
  const ids = [
    'edit.tryout',
    'file.save',
    'file.saveBranch',
    'file.saveClean',
    'view.moveNumbers',
    'view.rotateCw',
    'view.rotateCcw',
    'view.flipH',
    'view.flipV',
    'view.resetOrientation',
    'replay.toggle',
  ];
  for (const id of ids) {
    expect(resolveKeymap('windows', { J: id }).get('J')).toBe(id);
    for (const lang of ['en', 'zh-CN'] as const)
      expect(createI18n(lang).exists(`commands.${id}`)).toBe(true);
  }
});
