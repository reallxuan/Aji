import en from '../locales/en.json';
import zh from '../locales/zh-CN.json';
import type { ErrorCode } from '../transport/generated/ErrorCode';
import type { FailureCode } from '../transport/generated/FailureCode';

// Record<Union, true> fails type checking when a code generated from Rust is missing, so these
// lists stay complete.
const ERROR_CODES: Record<ErrorCode, true> = {
  internal: true,
  engineNotConfigured: true,
  engineNotRunning: true,
  setupUnknownEngine: true,
  setupBusy: true,
  setupUnknownNetwork: true,
  setupImportFailed: true,
  setupInvalidSource: true,
  engineBusy: true,
  invalidPosition: true,
  sgfNotAGame: true,
  sgfNotGo: true,
  sgfUnsupportedSize: true,
  sgfTooLarge: true,
  gameEmpty: true,
  fileReadFailed: true,
  fileWriteFailed: true,
  fileNotSgf: true,
  fileMissing: true,
};

const FAILURE_CODES: Record<FailureCode, true> = {
  downloadFailed: true,
  checksumMismatch: true,
  notEnoughSpace: true,
  unpackFailed: true,
  missingLibrary: true,
  gpuDriverTooOld: true,
  gpuError: true,
  outOfMemory: true,
  openclNoDevice: true,
  licenceNotAccepted: true,
  timedOut: true,
  crashed: true,
  diskError: true,
};

type Tree = { [key: string]: unknown };

function lookup(tree: Tree, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree);
}

const locales = { en, 'zh-CN': zh } as Record<string, Tree>;

it('every error code has text in both locales', () => {
  for (const [lang, tree] of Object.entries(locales)) {
    for (const code of Object.keys(ERROR_CODES)) {
      expect(typeof lookup(tree, `errors.${code}`), `${lang}: errors.${code}`).toBe('string');
    }
  }
});

it('every failure code has text in both locales', () => {
  for (const [lang, tree] of Object.entries(locales)) {
    for (const code of Object.keys(FAILURE_CODES)) {
      const key = `setup.failure.${code}`;
      expect(typeof lookup(tree, key), `${lang}: ${key}`).toBe('string');
    }
  }
});
