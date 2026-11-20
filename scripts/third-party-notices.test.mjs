import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

// Runs the generator in --check mode, so a dependency change without a regenerated notices file
// fails the test suite (and CI) instead of shipping an outdated About page.
it('the committed third-party notices match the dependency graph', () => {
  expect(() =>
    execFileSync('node', ['scripts/third-party-notices.mjs', '--check'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }),
  ).not.toThrow();
}, 120_000);
