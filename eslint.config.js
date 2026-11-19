import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', 'target', 'src-tauri', '.superpowers']),
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  {
    // Every user-visible string goes through i18next (CLAUDE.md, Internationalisation).
    files: ['src/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    plugins: { i18next },
    // jsx-only also catches {'text'}, template literals and attributes such as aria-label.
    rules: {
      'i18next/no-literal-string': [
        'error',
        { mode: 'jsx-only', 'should-validate-template': true },
      ],
    },
  },
]);
