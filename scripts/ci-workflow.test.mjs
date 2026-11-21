import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The release job is the only one that writes. A manual run started from a tag has a tag ref
// too, so publishing must be gated on the push event, never on the ref alone.
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const release = workflow.slice(workflow.indexOf('\n  release:'));

it('only a tag push publishes a release', () => {
  const jobIf = /\n {4}if: >-\n((?: {6}.*\n)+)/.exec(release)?.[1] ?? '';
  expect(jobIf).toMatch(
    /github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)/,
  );
  const publish = release.slice(release.indexOf('- name: Publish the release'));
  const stepIf = /\n {8}if: (.*)\n/.exec(publish)?.[1] ?? '';
  expect(stepIf).toBe("github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')");
});
