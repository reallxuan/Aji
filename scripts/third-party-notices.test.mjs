import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { chooseLicence, fallbackText } from './third-party-notices.mjs';

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

it('an OR expression prints MIT when MIT is offered', () => {
  expect(chooseLicence('Zlib OR Apache-2.0 OR MIT')).toEqual(['MIT']);
  expect(chooseLicence('Apache-2.0/MIT')).toEqual(['MIT']);
  expect(chooseLicence('MIT OR Apache-2.0 OR LGPL-2.1-or-later')).toEqual(['MIT']);
  expect(chooseLicence('MPL-2.0')).toEqual(['MPL-2.0']);
});

it('an AND expression prints every part', () => {
  expect(chooseLicence('MIT AND BSD-3-Clause')).toEqual(['MIT', 'BSD-3-Clause']);
});

it('MIT text names the authors as copyright holders', () => {
  const text = fallbackText({
    name: 'block2',
    licence: 'MIT',
    authors: ['Mads Marquart <m@example.org>'],
  });
  expect(text).toMatch(/^Copyright \(c\) Mads Marquart$/m);
  expect(text).toContain('Permission is hereby granted, free of charge');
});

it('a package with no authors is credited to its authors by name', () => {
  expect(fallbackText({ name: 'dlopen2', licence: 'MIT', authors: [] })).toMatch(
    /^Copyright \(c\) the dlopen2 authors$/m,
  );
});

it('a licence with no vendored text fails with the package name', () => {
  expect(() => fallbackText({ name: 'x', licence: 'EUPL-1.2', authors: [] })).toThrow(
    /x.*EUPL-1\.2/,
  );
});

it('the committed notices have no placeholder entries', () => {
  expect(readFileSync('src/assets/notices/third-party.txt', 'utf8')).not.toContain(
    '(no licence file;',
  );
});
