import { expect, it } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import { COMMANDS } from './registry';

it('every command has a label in both languages', () => {
  for (const language of ['zh-CN', 'en'] as const) {
    const i18n = createI18n(language);
    for (const command of COMMANDS.values()) expect(i18n.exists(command.labelKey)).toBe(true);
  }
});
