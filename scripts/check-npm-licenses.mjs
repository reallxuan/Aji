#!/usr/bin/env node
// Fails when a production npm dependency carries a licence that is not on the allow-list of
// licences compatible with AGPL-3.0-or-later (CLAUDE.md, License). Dev dependencies are not
// distributed with Aji, so only `--prod` dependencies are checked.

import { execFileSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'MPL-2.0',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'OFL-1.1',
]);

/** An SPDX `OR` expression is fine if any alternative is allowed; anything with `AND` must match whole. */
function isAllowed(expression) {
  return expression
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/)
    .some((alternative) => ALLOWED.has(alternative.trim()));
}

const report = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { encoding: 'utf8' }),
);

const rejected = [];
for (const [licence, packages] of Object.entries(report)) {
  if (isAllowed(licence)) continue;
  for (const pkg of packages) rejected.push(`${pkg.name}@${pkg.versions.join(',')} (${licence})`);
}

if (rejected.length > 0) {
  console.error('Production dependencies with licences outside the allow-list:');
  for (const line of rejected) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`npm licences ok (${Object.keys(report).join(', ')})`);
